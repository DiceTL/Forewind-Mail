import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4 delivery-pipeline contract (planning-frozen).
 *
 * Env contracts used by the cron route:
 * - CRON_SECRET — Bearer token required on POST /api/cron/send-due
 * - MAX_SEND_ATTEMPTS — optional; default 3
 *
 * Pipeline (not sendEmail itself) calls buildEmailContent then sendEmail({ to, subject, text }).
 * Paused profiles: skip send, leave occurrence status = 'pending' (do not fail, do not increment attempts).
 * Retry: each claim increments attempt_count and sets last_attempted_at; on send failure,
 * leave pending while attempt_count < MAX_SEND_ATTEMPTS; at/above max set status = 'failed'.
 */

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/mailer/sendEmail", () => ({
  sendEmail: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/mailer/sendEmail";
import { buildEmailContent } from "@/lib/mailer/buildEmailContent";
import { POST } from "@/app/api/cron/send-due/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedSendEmail = vi.mocked(sendEmail);

const CRON_SECRET = "test-cron-secret";

type ProfileRow = {
  user_id: string;
  timezone: string;
  paused: boolean;
};

type ReminderRow = {
  id: string;
  user_id: string;
  title: string;
  deadline: string | null;
};

type OccurrenceRow = {
  id: string;
  reminder_id: string;
  send_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  attempt_count: number;
  last_attempted_at: string | null;
  sent_at: string | null;
};

type AuthUser = {
  id: string;
  email: string;
};

type UpdateCall = {
  table: string;
  values: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
};

type Seed = {
  profiles: ProfileRow[];
  reminders: ReminderRow[];
  occurrences: OccurrenceRow[];
  users: AuthUser[];
};

/**
 * Chainable admin-client mock for cron unit tests.
 * Supports select/eq/lte/in/update (thenable) and auth.admin.getUserById.
 */
function createAdminMock(seed: Seed) {
  const updateCalls: UpdateCall[] = [];
  const occurrences = seed.occurrences.map((o) => ({ ...o }));

  function makeSelectBuilder(table: string) {
    const filters: { column: string; op: "eq" | "lte"; value: unknown }[] = [];
    const builder = {
      eq(column: string, value: unknown) {
        filters.push({ column, op: "eq", value });
        return builder;
      },
      lte(column: string, value: unknown) {
        filters.push({ column, op: "lte", value });
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push({
          column,
          op: "eq",
          // handled specially below via sentinel
          value: { __in: values },
        });
        return builder;
      },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        try {
          let rows: Record<string, unknown>[] = [];
          if (table === "reminder_occurrences") {
            rows = occurrences as unknown as Record<string, unknown>[];
          } else if (table === "reminders") {
            rows = seed.reminders as unknown as Record<string, unknown>[];
          } else if (table === "profiles") {
            rows = seed.profiles as unknown as Record<string, unknown>[];
          }

          const data = rows.filter((row) =>
            filters.every((f) => {
              const cell = row[f.column];
              if (
                f.value &&
                typeof f.value === "object" &&
                f.value !== null &&
                "__in" in (f.value as object)
              ) {
                return (f.value as { __in: unknown[] }).__in.includes(cell);
              }
              if (f.op === "eq") return cell === f.value;
              if (f.op === "lte") return String(cell) <= String(f.value);
              return false;
            }),
          );

          return Promise.resolve({ data, error: null }).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };
    return builder;
  }

  function makeUpdateBuilder(table: string) {
    const filters: { column: string; value: unknown }[] = [];
    let values: Record<string, unknown> = {};
    const builder = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return builder;
      },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        try {
          updateCalls.push({ table, values, filters: [...filters] });
          if (table === "reminder_occurrences") {
            for (const row of occurrences) {
              const matches = filters.every(
                (f) => (row as Record<string, unknown>)[f.column] === f.value,
              );
              if (matches) {
                Object.assign(row, values);
              }
            }
          }
          return Promise.resolve({ data: null, error: null }).then(
            resolve,
            reject,
          );
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };
    return {
      update(v: Record<string, unknown>) {
        values = v;
        return builder;
      },
    };
  }

  return {
    updateCalls,
    occurrences,
    client: {
      from(table: string) {
        return {
          select: (_cols?: string) => makeSelectBuilder(table),
          ...makeUpdateBuilder(table),
        };
      },
      auth: {
        admin: {
          getUserById: async (id: string) => {
            const user = seed.users.find((u) => u.id === id);
            if (!user) {
              return { data: { user: null }, error: { message: "not found" } };
            }
            return { data: { user }, error: null };
          },
        },
      },
    },
  };
}

function cronRequest(authHeader: string | null): Request {
  const headers = new Headers();
  if (authHeader !== null) {
    headers.set("Authorization", authHeader);
  }
  return new Request("http://localhost/api/cron/send-due", {
    method: "POST",
    headers,
  });
}

describe("buildEmailContent", () => {
  it("returns subject and text that include the reminder title", () => {
    const result = buildEmailContent({
      title: "Submit tax forms",
      deadline: DateTime.fromISO("2026-06-15T18:00:00.000Z", { zone: "utc" }),
      offsetMinutes: 30,
      timezone: "UTC",
    });
    expect(result.subject).toContain("Submit tax forms");
    expect(result.text).toContain("Submit tax forms");
  });

  it("formats the deadline in the user's local time zone", () => {
    const deadline = DateTime.fromISO("2026-06-15T18:00:00.000Z", {
      zone: "utc",
    });
    const result = buildEmailContent({
      title: "Dentist",
      deadline,
      offsetMinutes: 60,
      timezone: "America/Los_Angeles",
    });
    const local = deadline.setZone("America/Los_Angeles");
    // Body must reflect local wall time (hour and/or zone abbreviation), not only the UTC ISO.
    expect(result.text).toMatch(
      new RegExp(`${local.toFormat("h:mm")}|${local.toFormat("HH:mm")}|PDT|PST`),
    );
  });

  it("includes the lead time (offset) in the body", () => {
    const result = buildEmailContent({
      title: "Class",
      deadline: DateTime.fromISO("2026-06-15T18:00:00.000Z", { zone: "utc" }),
      offsetMinutes: 45,
      timezone: "UTC",
    });
    expect(result.text).toMatch(/45/);
  });

  it("supports a null deadline (no-deadline reminder)", () => {
    const result = buildEmailContent({
      title: "Buy milk",
      deadline: null,
      offsetMinutes: 5,
      timezone: "UTC",
    });
    expect(result.subject).toContain("Buy milk");
    expect(result.text).toContain("Buy milk");
    expect(typeof result.subject).toBe("string");
    expect(typeof result.text).toBe("string");
  });

  it("contains no URLs or click-to-complete links", () => {
    const result = buildEmailContent({
      title: "Ship package",
      deadline: DateTime.fromISO("2026-06-15T18:00:00.000Z", { zone: "utc" }),
      offsetMinutes: 30,
      timezone: "UTC",
    });
    const combined = `${result.subject}\n${result.text}`;
    expect(combined).not.toMatch(/https?:\/\//i);
    expect(combined).not.toMatch(/\bwww\./i);
    expect(combined).not.toMatch(/\bclick\b.*\b(here|link|complete)\b/i);
  });
});

describe("POST /api/cron/send-due", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("MAX_SEND_ATTEMPTS", "3");
    mockedSendEmail.mockResolvedValue(undefined);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const mock = createAdminMock({
      profiles: [],
      reminders: [],
      occurrences: [],
      users: [],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(cronRequest(null));
    expect(res.status).toBe(401);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 when the Bearer token does not match CRON_SECRET", async () => {
    const mock = createAdminMock({
      profiles: [],
      reminders: [],
      occurrences: [],
      users: [],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(cronRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("returns 200 and sends email for a due pending occurrence", async () => {
    const userId = "user-1";
    const reminderId = "reminder-1";
    const occurrenceId = "occ-1";
    const nowIso = "2026-06-15T12:00:00.000Z";

    const mock = createAdminMock({
      profiles: [
        { user_id: userId, timezone: "UTC", paused: false },
      ],
      reminders: [
        {
          id: reminderId,
          user_id: userId,
          title: "Pay rent",
          deadline: "2026-06-15T18:00:00.000Z",
        },
      ],
      occurrences: [
        {
          id: occurrenceId,
          reminder_id: reminderId,
          send_at: "2026-06-15T11:30:00.000Z",
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
          sent_at: null,
        },
        {
          id: "occ-future",
          reminder_id: reminderId,
          send_at: "2026-06-15T17:00:00.000Z",
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
          sent_at: null,
        },
      ],
      users: [{ id: userId, email: "user1@example.com" }],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );

    // Freeze "now" for the route via a due send_at in the past relative to wall clock
    // is already satisfied by seed; route should use server now. Stub Date if needed.
    vi.setSystemTime(new Date(nowIso));

    const res = await POST(cronRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user1@example.com",
        subject: expect.any(String),
        text: expect.any(String),
      }),
    );

    const sentUpdate = mock.updateCalls.find(
      (c) =>
        c.table === "reminder_occurrences" && c.values.status === "sent",
    );
    expect(sentUpdate).toBeDefined();
    expect(sentUpdate!.filters).toEqual(
      expect.arrayContaining([{ column: "id", value: occurrenceId }]),
    );

    // Future occurrence must not be sent on this run
    expect(
      mock.occurrences.find((o) => o.id === "occ-future")?.status,
    ).toBe("pending");

    vi.useRealTimers();
  });

  it("skips paused users and leaves their occurrences pending (not failed)", async () => {
    const userId = "user-paused";
    const reminderId = "reminder-paused";
    const occurrenceId = "occ-paused";
    const nowIso = "2026-06-15T12:00:00.000Z";

    const mock = createAdminMock({
      profiles: [
        { user_id: userId, timezone: "UTC", paused: true },
      ],
      reminders: [
        {
          id: reminderId,
          user_id: userId,
          title: "Paused reminder",
          deadline: "2026-06-15T18:00:00.000Z",
        },
      ],
      occurrences: [
        {
          id: occurrenceId,
          reminder_id: reminderId,
          send_at: "2026-06-15T11:00:00.000Z",
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
          sent_at: null,
        },
      ],
      users: [{ id: userId, email: "paused@example.com" }],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.setSystemTime(new Date(nowIso));

    const res = await POST(cronRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(mockedSendEmail).not.toHaveBeenCalled();

    const row = mock.occurrences.find((o) => o.id === occurrenceId)!;
    expect(row.status).toBe("pending");
    expect(row.attempt_count).toBe(0);

    expect(
      mock.updateCalls.some((c) => c.values.status === "failed"),
    ).toBe(false);
    expect(
      mock.updateCalls.some((c) => c.values.status === "sent"),
    ).toBe(false);

    vi.useRealTimers();
  });

  it("increments attempt_count and updates last_attempted_at on each send attempt", async () => {
    const userId = "user-1";
    const reminderId = "reminder-1";
    const occurrenceId = "occ-retry";
    const nowIso = "2026-06-15T12:00:00.000Z";

    const mock = createAdminMock({
      profiles: [
        { user_id: userId, timezone: "UTC", paused: false },
      ],
      reminders: [
        {
          id: reminderId,
          user_id: userId,
          title: "Flaky send",
          deadline: "2026-06-15T18:00:00.000Z",
        },
      ],
      occurrences: [
        {
          id: occurrenceId,
          reminder_id: reminderId,
          send_at: "2026-06-15T11:00:00.000Z",
          status: "pending",
          attempt_count: 0,
          last_attempted_at: null,
          sent_at: null,
        },
      ],
      users: [{ id: userId, email: "user1@example.com" }],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockedSendEmail.mockRejectedValueOnce(new Error("SMTP temporary failure"));
    vi.setSystemTime(new Date(nowIso));

    const res = await POST(cronRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);

    const attemptUpdate = mock.updateCalls.find(
      (c) =>
        c.table === "reminder_occurrences" &&
        typeof c.values.attempt_count === "number" &&
        (c.values.attempt_count as number) >= 1,
    );
    expect(attemptUpdate).toBeDefined();
    expect(attemptUpdate!.values.last_attempted_at).toBeTruthy();

    const row = mock.occurrences.find((o) => o.id === occurrenceId)!;
    expect(row.attempt_count).toBeGreaterThanOrEqual(1);
    // Below max: stays pending for a later cron run
    expect(row.status).toBe("pending");

    vi.useRealTimers();
  });

  it("marks the occurrence failed permanently once MAX_SEND_ATTEMPTS is reached", async () => {
    const userId = "user-1";
    const reminderId = "reminder-1";
    const occurrenceId = "occ-exhausted";
    const nowIso = "2026-06-15T12:00:00.000Z";

    const mock = createAdminMock({
      profiles: [
        { user_id: userId, timezone: "UTC", paused: false },
      ],
      reminders: [
        {
          id: reminderId,
          user_id: userId,
          title: "Give up",
          deadline: "2026-06-15T18:00:00.000Z",
        },
      ],
      occurrences: [
        {
          id: occurrenceId,
          reminder_id: reminderId,
          send_at: "2026-06-15T11:00:00.000Z",
          status: "pending",
          // Already attempted twice; this run is the 3rd (MAX=3)
          attempt_count: 2,
          last_attempted_at: "2026-06-15T11:55:00.000Z",
          sent_at: null,
        },
      ],
      users: [{ id: userId, email: "user1@example.com" }],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockedSendEmail.mockRejectedValueOnce(new Error("SMTP auth failure"));
    vi.setSystemTime(new Date(nowIso));

    const res = await POST(cronRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);

    const failedUpdate = mock.updateCalls.find(
      (c) =>
        c.table === "reminder_occurrences" && c.values.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate!.filters).toEqual(
      expect.arrayContaining([{ column: "id", value: occurrenceId }]),
    );

    const row = mock.occurrences.find((o) => o.id === occurrenceId)!;
    expect(row.status).toBe("failed");
    expect(row.attempt_count).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
  });

  it("does not retry an occurrence that is already failed", async () => {
    const userId = "user-1";
    const reminderId = "reminder-1";
    const occurrenceId = "occ-failed";
    const nowIso = "2026-06-15T12:00:00.000Z";

    const mock = createAdminMock({
      profiles: [
        { user_id: userId, timezone: "UTC", paused: false },
      ],
      reminders: [
        {
          id: reminderId,
          user_id: userId,
          title: "Already failed",
          deadline: "2026-06-15T18:00:00.000Z",
        },
      ],
      occurrences: [
        {
          id: occurrenceId,
          reminder_id: reminderId,
          send_at: "2026-06-15T11:00:00.000Z",
          status: "failed",
          attempt_count: 3,
          last_attempted_at: "2026-06-15T11:50:00.000Z",
          sent_at: null,
        },
      ],
      users: [{ id: userId, email: "user1@example.com" }],
    });
    mockedCreateAdminClient.mockReturnValue(
      mock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.setSystemTime(new Date(nowIso));

    const res = await POST(cronRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(mockedSendEmail).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
