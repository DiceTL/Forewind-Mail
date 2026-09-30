import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";
import {
  createE2EAdminClient,
  getUserIdForEmail,
  requireE2EEnv,
  restoreProfile,
  signInAs,
  upsertProfile,
  type ProfileSnapshot,
} from "../helpers/e2eAuth";
import { deleteReminder } from "../helpers/seedReminder";

/**
 * M6 reminder CRUD contract (planning-frozen).
 *
 * Env: same as M5 isolation — NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * E2E_USER_A_EMAIL, E2E_USER_B_EMAIL.
 *
 * Sign-in uses Admin generateLink + cookie injection (no Google UI).
 * Create drives the real form. Edit / mark-done / reopen seed schedule
 * rows via service role, then assert UI actions via PostgREST.
 *
 * Timezone contract: playwright.config sets timezoneId + webServer TZ to
 * UTC; tests pin profiles.timezone to UTC for the suite and restore it.
 * Deadline fills and expected send_at math both use DateTime.utc().
 *
 * Accessible contract the implementer must satisfy (T6.1–T6.4):
 * - Routes: /reminders, /reminders/new, /reminders/[id]/edit
 * - Labels: Title, Deadline, Lead time (minutes)
 * - Buttons: Create reminder, Save reminder, Mark done, Reopen
 * - List cards: role="article" named by the reminder title
 * - Status: role="status" with accessible name "Active" or "Done"
 * - Past-at-creation lead times surface role="alert" and do not insert
 *
 * Expect red until M6 reminder UI + server actions land.
 */

async function findReminderIdByTitle(userId: string, title: string): Promise<string | null> {
  const admin = createE2EAdminClient();
  const { data, error } = await admin
    .from("reminders")
    .select("id")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();
  if (error) {
    throw new Error(`findReminderIdByTitle: ${error.message}`);
  }
  return data?.id ?? null;
}

async function listOccurrences(reminderId: string) {
  const admin = createE2EAdminClient();
  const { data, error } = await admin
    .from("reminder_occurrences")
    .select("id, send_at, status")
    .eq("reminder_id", reminderId)
    .order("send_at", { ascending: true });
  if (error) {
    throw new Error(`listOccurrences: ${error.message}`);
  }
  return data ?? [];
}

async function listOffsets(reminderId: string) {
  const admin = createE2EAdminClient();
  const { data, error } = await admin
    .from("reminder_offsets")
    .select("id, offset_minutes")
    .eq("reminder_id", reminderId);
  if (error) {
    throw new Error(`listOffsets: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Seed an active reminder with one offset and one pending occurrence.
 * Used by edit / mark-done / reopen so those cases do not depend on create.
 */
async function seedScheduledReminder(
  userId: string,
  options: {
    title: string;
    deadline: DateTime;
    offsetMinutes: number;
    sendAt: DateTime;
  },
): Promise<{ reminderId: string; occurrenceId: string }> {
  const admin = createE2EAdminClient();
  const deadlineIso = options.deadline.toUTC().toISO();
  const sendAtIso = options.sendAt.toUTC().toISO();
  if (!deadlineIso || !sendAtIso) {
    throw new Error("seedScheduledReminder: invalid DateTime");
  }

  const { data: reminder, error: reminderError } = await admin
    .from("reminders")
    .insert({
      user_id: userId,
      title: options.title,
      deadline: deadlineIso,
      status: "active",
      repeat_enabled: false,
    })
    .select("id")
    .single();
  if (reminderError || !reminder) {
    throw new Error(`seedScheduledReminder reminder: ${reminderError?.message ?? "no row"}`);
  }

  const { error: offsetError } = await admin.from("reminder_offsets").insert({
    reminder_id: reminder.id,
    offset_minutes: options.offsetMinutes,
  });
  if (offsetError) {
    throw new Error(`seedScheduledReminder offset: ${offsetError.message}`);
  }

  const { data: occurrence, error: occurrenceError } = await admin
    .from("reminder_occurrences")
    .insert({
      reminder_id: reminder.id,
      send_at: sendAtIso,
      status: "pending",
    })
    .select("id")
    .single();
  if (occurrenceError || !occurrence) {
    throw new Error(`seedScheduledReminder occurrence: ${occurrenceError?.message ?? "no row"}`);
  }

  return { reminderId: reminder.id, occurrenceId: occurrence.id };
}

async function signInUserA(page: Page): Promise<{
  userId: string;
  priorProfile: ProfileSnapshot | null;
}> {
  const env = requireE2EEnv();
  const userId = await getUserIdForEmail(env.userAEmail);
  const priorProfile = await upsertProfile(userId, {
    timezone: "UTC",
    paused: false,
  });
  await signInAs(page, env.userAEmail);
  return { userId, priorProfile };
}

test.describe("reminder CRUD", () => {
  const createdIds: string[] = [];
  let userIdForRestore: string | undefined;
  let priorProfile: ProfileSnapshot | null = null;

  test.beforeAll(() => {
    requireE2EEnv();
  });

  test.afterEach(async () => {
    while (createdIds.length > 0) {
      const id = createdIds.pop()!;
      await deleteReminder(id);
    }
    if (userIdForRestore) {
      await restoreProfile(userIdForRestore, priorProfile);
      userIdForRestore = undefined;
      priorProfile = null;
    }
  });

  test("create reminder inserts reminder, offset, and pending occurrence", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;
    const title = `create-${Date.now()}`;
    const deadlineUtc = DateTime.utc().plus({ days: 2 }).startOf("minute");

    await page.goto("/reminders/new");
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByLabel(/^deadline$/i).fill(deadlineUtc.toFormat("yyyy-MM-dd'T'HH:mm"));
    await page.getByLabel(/lead time \(minutes\)/i).fill("60");
    await page.getByRole("button", { name: /create reminder/i }).click();

    await expect(page).toHaveURL(/\/reminders\/?$/);
    await expect(page.getByText(title)).toBeVisible();

    const reminderId = await findReminderIdByTitle(userId, title);
    expect(reminderId).not.toBeNull();
    createdIds.push(reminderId!);

    const offsets = await listOffsets(reminderId!);
    expect(offsets).toHaveLength(1);
    expect(offsets[0].offset_minutes).toBe(60);

    const occurrences = await listOccurrences(reminderId!);
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(occurrences.every((row) => row.status === "pending")).toBe(true);

    const expectedSend = deadlineUtc.minus({ minutes: 60 });
    const pendingSendAts = occurrences.map((row) => DateTime.fromISO(row.send_at, { zone: "utc" }));
    expect(
      pendingSendAts.some((sendAt) => Math.abs(sendAt.diff(expectedSend).as("seconds")) < 60),
    ).toBe(true);
  });

  test("past-at-creation lead time shows inline error and does not insert", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;
    const title = `past-offset-${Date.now()}`;
    // Deadline in 30 minutes with a 60-minute lead time → already past at creation.
    const deadlineUtc = DateTime.utc().plus({ minutes: 30 }).startOf("minute");

    await page.goto("/reminders/new");
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByLabel(/^deadline$/i).fill(deadlineUtc.toFormat("yyyy-MM-dd'T'HH:mm"));
    await page.getByLabel(/lead time \(minutes\)/i).fill("60");
    await page.getByRole("button", { name: /create reminder/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/reminders\/new/);

    const reminderId = await findReminderIdByTitle(userId, title);
    expect(reminderId).toBeNull();
  });

  test("editing the deadline re-arms pending occurrences", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;
    const title = `edit-rearm-${Date.now()}`;
    const originalDeadline = DateTime.utc().plus({ days: 2 }).startOf("minute");
    const offsetMinutes = 60;
    const originalSendAt = originalDeadline.minus({ minutes: offsetMinutes });

    const { reminderId, occurrenceId } = await seedScheduledReminder(userId, {
      title,
      deadline: originalDeadline,
      offsetMinutes,
      sendAt: originalSendAt,
    });
    createdIds.push(reminderId);

    const newDeadlineUtc = DateTime.utc().plus({ days: 5 }).startOf("minute");
    const expectedSend = newDeadlineUtc.minus({ minutes: offsetMinutes });

    await page.goto(`/reminders/${reminderId}/edit`);
    await page.getByLabel(/^deadline$/i).fill(newDeadlineUtc.toFormat("yyyy-MM-dd'T'HH:mm"));
    await page.getByRole("button", { name: /save reminder/i }).click();

    await expect(page).toHaveURL(/\/reminders\/?$/);

    const occurrences = await listOccurrences(reminderId);
    const target = occurrences.find((row) => row.id === occurrenceId);
    expect(target).toBeDefined();
    expect(target!.status).toBe("pending");

    const sendAt = DateTime.fromISO(target!.send_at, { zone: "utc" });
    expect(Math.abs(sendAt.diff(expectedSend).as("seconds"))).toBeLessThan(60);
  });

  test("editing deadline cancels overdue lead times instead of burst-sending", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;
    const title = `edit-cancel-overdue-${Date.now()}`;
    const originalDeadline = DateTime.utc().plus({ days: 2 }).startOf("minute");
    const offsetMinutes = 120;
    const originalSendAt = originalDeadline.minus({ minutes: offsetMinutes });

    const { reminderId, occurrenceId } = await seedScheduledReminder(userId, {
      title,
      deadline: originalDeadline,
      offsetMinutes,
      sendAt: originalSendAt,
    });
    createdIds.push(reminderId);

    // New deadline is only 30 minutes out — 120-minute lead is already overdue.
    const newDeadlineUtc = DateTime.utc().plus({ minutes: 30 }).startOf("minute");

    await page.goto(`/reminders/${reminderId}/edit`);
    await page.getByLabel(/^deadline$/i).fill(newDeadlineUtc.toFormat("yyyy-MM-dd'T'HH:mm"));
    await page.getByRole("button", { name: /save reminder/i }).click();

    await expect(page).toHaveURL(/\/reminders\/?$/);

    const occurrences = await listOccurrences(reminderId);
    const target = occurrences.find((row) => row.id === occurrenceId);
    expect(target).toBeDefined();
    expect(target!.status).toBe("cancelled");
  });

  test("mark done cancels all pending occurrences", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;
    const title = `mark-done-${Date.now()}`;
    const deadline = DateTime.utc().plus({ days: 3 }).startOf("minute");
    const offsetMinutes = 60;
    const sendAt = deadline.minus({ minutes: offsetMinutes });

    const { reminderId } = await seedScheduledReminder(userId, {
      title,
      deadline,
      offsetMinutes,
      sendAt,
    });
    createdIds.push(reminderId);

    await page.goto("/reminders");
    const card = page.getByRole("article", { name: title });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /mark done/i }).click();

    await expect(card.getByRole("status", { name: /^done$/i })).toBeVisible();

    const admin = createE2EAdminClient();
    const { data: reminder, error } = await admin
      .from("reminders")
      .select("status")
      .eq("id", reminderId)
      .single();
    expect(error).toBeNull();
    expect(reminder!.status).toBe("done");

    const occurrences = await listOccurrences(reminderId);
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(occurrences.every((row) => row.status !== "pending")).toBe(true);
    expect(occurrences.some((row) => row.status === "cancelled")).toBe(true);
  });

  test("reopen sets reminder active without recomputing occurrences", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;
    const title = `reopen-${Date.now()}`;
    const deadline = DateTime.utc().plus({ days: 3 }).startOf("minute");
    const offsetMinutes = 60;
    const sendAt = deadline.minus({ minutes: offsetMinutes });

    const { reminderId, occurrenceId } = await seedScheduledReminder(userId, {
      title,
      deadline,
      offsetMinutes,
      sendAt,
    });
    createdIds.push(reminderId);

    await page.goto("/reminders");
    const card = page.getByRole("article", { name: title });
    await card.getByRole("button", { name: /mark done/i }).click();
    await expect(card.getByRole("status", { name: /^done$/i })).toBeVisible();

    await card.getByRole("button", { name: /^reopen$/i }).click();
    await expect(card.getByRole("status", { name: /^active$/i })).toBeVisible();

    const admin = createE2EAdminClient();
    const { data: reminder, error } = await admin
      .from("reminders")
      .select("status")
      .eq("id", reminderId)
      .single();
    expect(error).toBeNull();
    expect(reminder!.status).toBe("active");

    const occurrences = await listOccurrences(reminderId);
    const target = occurrences.find((row) => row.id === occurrenceId);
    expect(target).toBeDefined();
    // WORKFLOW open assumption: reopen does not recompute — cancelled stays cancelled.
    expect(target!.status).toBe("cancelled");
  });
});
