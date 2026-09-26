import { DateTime } from "luxon";
import { RRule } from "rrule";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeSendTime } from "@/lib/scheduling/computeSendTime";
import { computeNextOccurrence } from "@/lib/scheduling/computeNextOccurrence";
import { cancelOccurrences } from "@/lib/scheduling/cancelOccurrences";
import {
  recomputeOnDeadlineEdit,
  type OccurrenceUpdate,
} from "@/lib/scheduling/recomputeOnDeadlineEdit";
import {
  validateOffset,
  type ValidationResult,
} from "@/lib/scheduling/validateOffset";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

const mockedCreateClient = vi.mocked(createClient);

type OffsetRow = {
  id: string;
  reminder_id: string;
  offset_minutes: number;
};

type OccurrenceRow = {
  id: string;
  reminder_id: string;
  send_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
};

type UpdateCall = {
  table: string;
  values: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
};

/**
 * Minimal chainable Supabase mock for scheduling unit tests.
 * Supports: from().select().eq()... and from().update().eq()... (thenable).
 */
function createSupabaseMock(seed: {
  offsets: OffsetRow[];
  occurrences: OccurrenceRow[];
}) {
  const updateCalls: UpdateCall[] = [];

  function filterRows<T extends Record<string, unknown>>(
    rows: T[],
    filters: { column: string; value: unknown }[],
  ): T[] {
    return rows.filter((row) =>
      filters.every((f) => row[f.column] === f.value),
    );
  }

  function makeSelectBuilder(table: "reminder_offsets" | "reminder_occurrences") {
    const filters: { column: string; value: unknown }[] = [];
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
          const rows =
            table === "reminder_offsets" ? seed.offsets : seed.occurrences;
          const data = filterRows(
            rows as unknown as Record<string, unknown>[],
            filters,
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
    client: {
      from(table: string) {
        if (table === "reminder_offsets" || table === "reminder_occurrences") {
          return {
            select: () => makeSelectBuilder(table),
            ...makeUpdateBuilder(table),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

describe("computeSendTime", () => {
  it("subtracts a normal 30-minute offset from the deadline", () => {
    const deadline = DateTime.fromISO("2026-06-15T18:00:00.000Z", {
      zone: "utc",
    });
    const result = computeSendTime(deadline, 30);
    expect(result.toUTC().toISO()).toBe("2026-06-15T17:30:00.000Z");
  });

  it("subtracts a 24-hour offset from the deadline", () => {
    const deadline = DateTime.fromISO("2026-06-15T18:00:00.000Z", {
      zone: "utc",
    });
    const result = computeSendTime(deadline, 24 * 60);
    expect(result.toUTC().toISO()).toBe("2026-06-14T18:00:00.000Z");
  });

  it("subtracts the exact 5-minute minimum offset", () => {
    const deadline = DateTime.fromISO("2026-06-15T12:00:00.000Z", {
      zone: "utc",
    });
    const result = computeSendTime(deadline, 5);
    expect(result.toUTC().toISO()).toBe("2026-06-15T11:55:00.000Z");
  });

  it("uses absolute minutes for a zoned Los Angeles deadline", () => {
    const deadline = DateTime.fromObject(
      { year: 2026, month: 6, day: 15, hour: 12, minute: 0 },
      { zone: "America/Los_Angeles" },
    );
    const result = computeSendTime(deadline, 90);
    expect(result.toUTC().toISO()).toBe(deadline.minus({ minutes: 90 }).toUTC().toISO());
  });

  it("keeps absolute-minute math across US Eastern spring-forward", () => {
    // 2026-03-08: clocks spring forward 02:00 → 03:00 in America/New_York
    const deadline = DateTime.fromObject(
      { year: 2026, month: 3, day: 8, hour: 14, minute: 0 },
      { zone: "America/New_York" },
    );
    const result = computeSendTime(deadline, 60);
    expect(result.toUTC().toISO()).toBe(deadline.minus({ minutes: 60 }).toUTC().toISO());
    expect(result.toUTC().toISO()).toBe("2026-03-08T17:00:00.000Z");
  });

  it("keeps absolute-minute math across US Eastern fall-back", () => {
    // 2026-11-01: clocks fall back 02:00 → 01:00 in America/New_York
    const deadline = DateTime.fromObject(
      { year: 2026, month: 11, day: 1, hour: 14, minute: 0 },
      { zone: "America/New_York" },
    );
    const result = computeSendTime(deadline, 180);
    expect(result.toUTC().toISO()).toBe(deadline.minus({ minutes: 180 }).toUTC().toISO());
    expect(result.toUTC().toISO()).toBe("2026-11-01T16:00:00.000Z");
  });
});

describe("validateOffset", () => {
  const now = DateTime.fromISO("2026-06-15T12:00:00.000Z", { zone: "utc" });

  it("accepts the exact 5-minute minimum", () => {
    const deadline = now.plus({ hours: 1 });
    const result: ValidationResult = validateOffset(5, deadline, now);
    expect(result).toEqual({ ok: true });
  });

  it("rejects offsets below 5 minutes as too_small", () => {
    const deadline = now.plus({ hours: 1 });
    expect(validateOffset(4, deadline, now)).toEqual({
      ok: false,
      reason: "too_small",
    });
    expect(validateOffset(0, deadline, now)).toEqual({
      ok: false,
      reason: "too_small",
    });
    expect(validateOffset(-5, deadline, now)).toEqual({
      ok: false,
      reason: "too_small",
    });
  });

  it("rejects non-multiples of 5 as not_multiple_of_five", () => {
    const deadline = now.plus({ hours: 1 });
    expect(validateOffset(7, deadline, now)).toEqual({
      ok: false,
      reason: "not_multiple_of_five",
    });
  });

  it("rejects a lead time that would already be past at creation", () => {
    const deadline = now.plus({ minutes: 10 });
    expect(validateOffset(15, deadline, now)).toEqual({
      ok: false,
      reason: "already_past",
    });
  });

  it("allows an offset equal to the time remaining", () => {
    const deadline = now.plus({ minutes: 30 });
    expect(validateOffset(30, deadline, now)).toEqual({ ok: true });
  });

  it("rejects an offset longer than the time remaining", () => {
    const deadline = now.plus({ minutes: 20 });
    expect(validateOffset(25, deadline, now)).toEqual({
      ok: false,
      reason: "already_past",
    });
  });

  it("with a null deadline only enforces increment rules (no past check)", () => {
    expect(validateOffset(5, null, now)).toEqual({ ok: true });
    expect(validateOffset(3, null, now)).toEqual({
      ok: false,
      reason: "too_small",
    });
    expect(validateOffset(7, null, now)).toEqual({
      ok: false,
      reason: "not_multiple_of_five",
    });
  });
});

describe("computeNextOccurrence", () => {
  it("returns the next daily occurrence after a known instant", () => {
    const after = DateTime.fromISO("2026-06-15T09:00:00.000Z", { zone: "utc" });
    const rule = new RRule({
      freq: RRule.DAILY,
      dtstart: DateTime.fromISO("2026-06-15T09:00:00.000Z", {
        zone: "utc",
      }).toJSDate(),
    });
    const next = computeNextOccurrence(rule, after);
    expect(next).not.toBeNull();
    expect(next!.toUTC().toISO()).toBe("2026-06-16T09:00:00.000Z");
  });

  it("returns the next weekly occurrence on chosen days (Mon/Wed)", () => {
    // 2026-06-15 is a Monday
    const after = DateTime.fromISO("2026-06-15T10:00:00.000Z", { zone: "utc" });
    const rule = new RRule({
      freq: RRule.WEEKLY,
      byweekday: [RRule.MO, RRule.WE],
      dtstart: DateTime.fromISO("2026-06-15T10:00:00.000Z", {
        zone: "utc",
      }).toJSDate(),
    });
    const next = computeNextOccurrence(rule, after);
    expect(next).not.toBeNull();
    expect(next!.toUTC().toISO()).toBe("2026-06-17T10:00:00.000Z");
  });

  it("returns the next monthly occurrence on the same day-of-month", () => {
    const after = DateTime.fromISO("2026-01-15T12:00:00.000Z", { zone: "utc" });
    const rule = new RRule({
      freq: RRule.MONTHLY,
      dtstart: DateTime.fromISO("2026-01-15T12:00:00.000Z", {
        zone: "utc",
      }).toJSDate(),
    });
    const next = computeNextOccurrence(rule, after);
    expect(next).not.toBeNull();
    expect(next!.toUTC().toISO()).toBe("2026-02-15T12:00:00.000Z");
  });

  it("with no until/count still returns a next occurrence (open-ended series)", () => {
    const after = DateTime.fromISO("2026-06-15T08:00:00.000Z", { zone: "utc" });
    const rule = new RRule({
      freq: RRule.DAILY,
      dtstart: DateTime.fromISO("2026-01-01T08:00:00.000Z", {
        zone: "utc",
      }).toJSDate(),
      // no until, no count
    });
    const next = computeNextOccurrence(rule, after);
    expect(next).not.toBeNull();
    expect(next!.toUTC().toISO()).toBe("2026-06-16T08:00:00.000Z");
  });
});

describe("recomputeOnDeadlineEdit", () => {
  const reminderId = "reminder-1";
  const now = DateTime.fromISO("2026-06-15T12:00:00.000Z", { zone: "utc" });

  beforeEach(() => {
    mockedCreateClient.mockReset();
  });

  it("reschedules pending occurrences when the deadline moves later", async () => {
    const mock = createSupabaseMock({
      offsets: [
        {
          id: "offset-30",
          reminder_id: reminderId,
          offset_minutes: 30,
        },
      ],
      occurrences: [
        {
          id: "occ-pending",
          reminder_id: reminderId,
          send_at: "2026-06-15T11:30:00.000Z",
          status: "pending",
        },
        {
          id: "occ-sent",
          reminder_id: reminderId,
          send_at: "2026-06-14T12:00:00.000Z",
          status: "sent",
        },
      ],
    });
    mockedCreateClient.mockResolvedValue(
      mock.client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const newDeadline = now.plus({ hours: 3 });
    const updates: OccurrenceUpdate[] = await Promise.resolve(
      recomputeOnDeadlineEdit(reminderId, newDeadline, now),
    );

    expect(updates).toEqual([
      {
        type: "reschedule",
        occurrenceId: "occ-pending",
        sendAt: expect.any(DateTime),
      },
    ]);
    const reschedule = updates[0];
    expect(reschedule.type).toBe("reschedule");
    if (reschedule.type === "reschedule") {
      expect(reschedule.sendAt.toUTC().toISO()).toBe(
        computeSendTime(newDeadline, 30).toUTC().toISO(),
      );
    }
    expect(updates.some((u) => u.occurrenceId === "occ-sent")).toBe(false);
  });

  it("cancels overdue lead times instead of burst-sending them", async () => {
    // Pairing (no offset_id on occurrences): sort offsets by offset_minutes
    // ascending and pending by send_at descending (larger lead → earlier send).
    // Here occ-30 ↔ 30m, occ-120 ↔ 120m.
    const mock = createSupabaseMock({
      offsets: [
        {
          id: "offset-30",
          reminder_id: reminderId,
          offset_minutes: 30,
        },
        {
          id: "offset-120",
          reminder_id: reminderId,
          offset_minutes: 120,
        },
      ],
      occurrences: [
        {
          id: "occ-30",
          reminder_id: reminderId,
          // prior send_at; will be recomputed from new deadline
          send_at: "2026-06-15T11:30:00.000Z",
          status: "pending",
        },
        {
          id: "occ-120",
          reminder_id: reminderId,
          send_at: "2026-06-15T10:00:00.000Z",
          status: "pending",
        },
      ],
    });
    mockedCreateClient.mockResolvedValue(
      mock.client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    // newDeadline is only 60 minutes out: 30m lead is still future, 120m lead is overdue
    const newDeadline = now.plus({ minutes: 60 });
    const updates: OccurrenceUpdate[] = await Promise.resolve(
      recomputeOnDeadlineEdit(reminderId, newDeadline, now),
    );

    const byId = Object.fromEntries(
      updates.map((u) => [u.occurrenceId, u]),
    ) as Record<string, OccurrenceUpdate>;

    expect(byId["occ-30"]).toMatchObject({ type: "reschedule" });
    if (byId["occ-30"].type === "reschedule") {
      expect(byId["occ-30"].sendAt.toUTC().toISO()).toBe(
        computeSendTime(newDeadline, 30).toUTC().toISO(),
      );
      expect(byId["occ-30"].sendAt > now).toBe(true);
    }

    expect(byId["occ-120"]).toEqual({
      type: "cancel",
      occurrenceId: "occ-120",
    });

    // Guard: never burst-send by rescheduling into the past or to now-as-sent
    for (const update of updates) {
      if (update.type === "reschedule") {
        expect(update.sendAt > now).toBe(true);
      }
    }
    expect(
      mock.updateCalls.some((c) => c.values.status === "sent"),
    ).toBe(false);
  });
});

describe("cancelOccurrences", () => {
  beforeEach(() => {
    mockedCreateClient.mockReset();
  });

  it("marks all pending occurrences for a reminder as cancelled (done cancels the series)", async () => {
    const reminderId = "reminder-done";
    const otherReminderId = "reminder-other";
    const mock = createSupabaseMock({
      offsets: [],
      occurrences: [
        {
          id: "occ-a",
          reminder_id: reminderId,
          send_at: "2026-06-16T10:00:00.000Z",
          status: "pending",
        },
        {
          id: "occ-b",
          reminder_id: reminderId,
          send_at: "2026-06-17T10:00:00.000Z",
          status: "pending",
        },
        {
          id: "occ-sent",
          reminder_id: reminderId,
          send_at: "2026-06-15T10:00:00.000Z",
          status: "sent",
        },
        {
          id: "occ-other",
          reminder_id: otherReminderId,
          send_at: "2026-06-16T11:00:00.000Z",
          status: "pending",
        },
      ],
    });
    mockedCreateClient.mockResolvedValue(
      mock.client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await Promise.resolve(cancelOccurrences(reminderId));

    expect(mock.updateCalls.length).toBeGreaterThanOrEqual(1);
    const cancelUpdate = mock.updateCalls.find(
      (c) =>
        c.table === "reminder_occurrences" &&
        c.values.status === "cancelled",
    );
    expect(cancelUpdate).toBeDefined();
    expect(cancelUpdate!.filters).toEqual(
      expect.arrayContaining([
        { column: "reminder_id", value: reminderId },
        { column: "status", value: "pending" },
      ]),
    );
    // Must scope to pending only — sent rows and other reminders stay untouched
    expect(
      cancelUpdate!.filters.some(
        (f) => f.column === "status" && f.value === "pending",
      ),
    ).toBe(true);
    expect(
      cancelUpdate!.filters.some(
        (f) => f.column === "reminder_id" && f.value === reminderId,
      ),
    ).toBe(true);
    expect(
      cancelUpdate!.filters.some(
        (f) => f.column === "reminder_id" && f.value === otherReminderId,
      ),
    ).toBe(false);
  });
});
