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
 * M6 /stats contract (planning-frozen).
 *
 * Env: same as M5 isolation — NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * E2E_USER_A_EMAIL, E2E_USER_B_EMAIL.
 *
 * Seeds reminder + offset + occurrence rows via service role, then asserts
 * the authenticated stats UI. Counts are checked as visible text inside
 * named articles so the implementer can style freely.
 *
 * Accessible contract the implementer must satisfy (T6.10):
 * - Route: /stats (auth required; unauthenticated → /login)
 * - Page heading: role="heading" named /stats|statistics/i
 * - Empty state: role="status" named /no reminders yet/i when the user
 *   has zero reminders
 * - Populated grid cards (role="article"), each named exactly:
 *     "Total reminders", "Active reminders", "Done reminders",
 *     "Emails sent", "Emails failed", "Emails pending",
 *     "On-time delivery rate", "Most-used lead time"
 * - Each article exposes its metric as visible text (e.g. "2", "50%",
 *   "60 min") so getByRole('article', { name }).getByText(value) works
 * - "Reminders created per week" region is present (chart or list);
 *   exact series values are not asserted beyond visibility
 *
 * Expect red until T6.10 lands. Does not depend on profiles.onboarded
 * (T6.9 / M8 middleware) — /stats is a normal authenticated route under
 * the T6.8 two-tier guard.
 */

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

/**
 * Seed a reminder plus one offset and one occurrence for stats counts.
 */
async function seedStatsFixture(
  userId: string,
  options: {
    title: string;
    status: "active" | "done";
    offsetMinutes: number;
    occurrence: {
      status: "pending" | "sent" | "failed" | "cancelled";
      sendAt: DateTime;
      sentAt?: DateTime | null;
    };
  },
): Promise<string> {
  const admin = createE2EAdminClient();
  const sendAtIso = options.occurrence.sendAt.toUTC().toISO();
  if (!sendAtIso) {
    throw new Error("seedStatsFixture: invalid sendAt");
  }
  const sentAtIso = options.occurrence.sentAt
    ? options.occurrence.sentAt.toUTC().toISO()
    : null;

  const { data: reminder, error: reminderError } = await admin
    .from("reminders")
    .insert({
      user_id: userId,
      title: options.title,
      status: options.status,
      repeat_enabled: false,
    })
    .select("id")
    .single();
  if (reminderError || !reminder) {
    throw new Error(
      `seedStatsFixture reminder: ${reminderError?.message ?? "no row"}`,
    );
  }

  const { error: offsetError } = await admin.from("reminder_offsets").insert({
    reminder_id: reminder.id,
    offset_minutes: options.offsetMinutes,
  });
  if (offsetError) {
    throw new Error(`seedStatsFixture offset: ${offsetError.message}`);
  }

  const { error: occurrenceError } = await admin
    .from("reminder_occurrences")
    .insert({
      reminder_id: reminder.id,
      send_at: sendAtIso,
      status: options.occurrence.status,
      sent_at: sentAtIso,
    });
  if (occurrenceError) {
    throw new Error(`seedStatsFixture occurrence: ${occurrenceError.message}`);
  }

  return reminder.id;
}

async function deleteAllRemindersForUser(userId: string): Promise<void> {
  const admin = createE2EAdminClient();
  const { data, error } = await admin
    .from("reminders")
    .select("id")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`deleteAllRemindersForUser: ${error.message}`);
  }
  for (const row of data ?? []) {
    await deleteReminder(row.id);
  }
}

test.describe("stats page", () => {
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

  test("unauthenticated /stats redirects to /login", async ({ page }) => {
    await page.goto("/stats");
    await expect(page).toHaveURL(/\/login/);
  });

  test("empty state when the user has no reminders", async ({ page }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;

    await deleteAllRemindersForUser(signedIn.userId);

    await page.goto("/stats");
    await expect(page).toHaveURL(/\/stats\/?$/);
    await expect(
      page.getByRole("heading", { name: /stats|statistics/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: /no reminders yet/i }),
    ).toBeVisible();
  });

  test("populated grid shows accurate counts for seeded data", async ({
    page,
  }) => {
    const signedIn = await signInUserA(page);
    userIdForRestore = signedIn.userId;
    priorProfile = signedIn.priorProfile;
    const { userId } = signedIn;

    await deleteAllRemindersForUser(userId);

    const now = DateTime.utc();
    const sendAt = now.minus({ hours: 1 });

    // Active + pending, lead time 60 (mode candidate).
    createdIds.push(
      await seedStatsFixture(userId, {
        title: `stats-active-${Date.now()}`,
        status: "active",
        offsetMinutes: 60,
        occurrence: { status: "pending", sendAt: now.plus({ hours: 2 }) },
      }),
    );

    // Done + on-time sent (sent_at within 2 minutes of send_at), lead 60.
    createdIds.push(
      await seedStatsFixture(userId, {
        title: `stats-sent-${Date.now()}`,
        status: "done",
        offsetMinutes: 60,
        occurrence: {
          status: "sent",
          sendAt,
          sentAt: sendAt.plus({ minutes: 1 }),
        },
      }),
    );

    // Active + failed, lead 30 (not the mode).
    createdIds.push(
      await seedStatsFixture(userId, {
        title: `stats-failed-${Date.now()}`,
        status: "active",
        offsetMinutes: 30,
        occurrence: {
          status: "failed",
          sendAt: now.minus({ hours: 3 }),
        },
      }),
    );

    await page.goto("/stats");
    await expect(page).toHaveURL(/\/stats\/?$/);

    await expect(
      page.getByRole("article", { name: /^total reminders$/i }),
    ).toContainText("3");
    await expect(
      page.getByRole("article", { name: /^active reminders$/i }),
    ).toContainText("2");
    await expect(
      page.getByRole("article", { name: /^done reminders$/i }),
    ).toContainText("1");
    await expect(
      page.getByRole("article", { name: /^emails sent$/i }),
    ).toContainText("1");
    await expect(
      page.getByRole("article", { name: /^emails failed$/i }),
    ).toContainText("1");
    await expect(
      page.getByRole("article", { name: /^emails pending$/i }),
    ).toContainText("1");

    // One sent occurrence, on time → 100%.
    await expect(
      page.getByRole("article", { name: /^on-time delivery rate$/i }),
    ).toContainText(/100\s*%/);

    // Mode of offset_minutes across three rows: 60 appears twice.
    await expect(
      page.getByRole("article", { name: /^most-used lead time$/i }),
    ).toContainText(/60/);

    await expect(
      page.getByRole("region", { name: /reminders created per week/i }),
    ).toBeVisible();
  });
});
