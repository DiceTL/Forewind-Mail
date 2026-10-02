import { expect, test } from "@playwright/test";
import {
  createRlsClient,
  getUserIdForEmail,
  mintSessionForEmail,
  requireE2EEnv,
} from "../helpers/e2eAuth";
import {
  deleteReminder,
  getReminderAsAdmin,
  seedReminderForUser,
} from "../helpers/seedReminder";

/**
 * M5 auth & isolation contract (planning-frozen).
 *
 * Env (RLS cases): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, E2E_USER_A_EMAIL, E2E_USER_B_EMAIL.
 *
 * Sign-in is Admin generateLink + verifyOtp (no Google UI). Reminders are
 * seeded via service role. Read/edit/complete isolation is asserted under
 * each user's JWT via PostgREST (RLS) — does not require M6 reminder UI.
 *
 * Unauthenticated /reminders → /login requires T5.2 middleware. As of M6
 * (T6.8), `/` is a public marketing page — that redirect lives in
 * tests/e2e/landing.spec.ts, not here.
 * RLS cases fail closed when E2E env is missing (no silent skip).
 */

test.describe("user isolation", () => {
  test("unauthenticated request to /reminders redirects to /login", async ({
    page,
  }) => {
    await page.goto("/reminders");
    await expect(page).toHaveURL(/\/login/);
  });

  test.describe("RLS between seeded users", () => {
    let reminderId: string | undefined;
    let reminderTitle: string;

    test.beforeAll(() => {
      requireE2EEnv();
    });

    test.beforeEach(async () => {
      const env = requireE2EEnv();
      const userAId = await getUserIdForEmail(env.userAEmail);
      reminderTitle = `isolation-${Date.now()}`;
      const seeded = await seedReminderForUser(userAId, {
        title: reminderTitle,
      });
      reminderId = seeded.id;
    });

    test.afterEach(async () => {
      if (reminderId) {
        await deleteReminder(reminderId);
        reminderId = undefined;
      }
    });

    test("owner can read their reminder", async () => {
      const env = requireE2EEnv();
      const { session } = await mintSessionForEmail(env.userAEmail);
      const client = await createRlsClient(session);

      const { data, error } = await client
        .from("reminders")
        .select("id, title, status")
        .eq("id", reminderId!);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].title).toBe(reminderTitle);
      expect(data![0].status).toBe("active");
    });

    test("peer cannot read owner's reminder", async () => {
      const env = requireE2EEnv();
      const { session } = await mintSessionForEmail(env.userBEmail);
      const client = await createRlsClient(session);

      const { data, error } = await client
        .from("reminders")
        .select("id, title")
        .eq("id", reminderId!);

      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const { data: list } = await client.from("reminders").select("id, title");
      expect((list ?? []).some((row) => row.title === reminderTitle)).toBe(
        false,
      );
      expect((list ?? []).some((row) => row.id === reminderId)).toBe(false);
    });

    test("peer cannot edit owner's reminder", async () => {
      const env = requireE2EEnv();
      const { session } = await mintSessionForEmail(env.userBEmail);
      const client = await createRlsClient(session);

      const { data: updated, error } = await client
        .from("reminders")
        .update({ title: "hijacked-by-peer" })
        .eq("id", reminderId!)
        .select("id, title");

      expect(error).toBeNull();
      expect(updated ?? []).toHaveLength(0);

      const row = await getReminderAsAdmin(reminderId!);
      expect(row).not.toBeNull();
      expect(row!.title).toBe(reminderTitle);
    });

    test("peer cannot complete owner's reminder", async () => {
      const env = requireE2EEnv();
      const { session } = await mintSessionForEmail(env.userBEmail);
      const client = await createRlsClient(session);

      const { data: updated, error } = await client
        .from("reminders")
        .update({ status: "done" })
        .eq("id", reminderId!)
        .select("id, status");

      expect(error).toBeNull();
      expect(updated ?? []).toHaveLength(0);

      const row = await getReminderAsAdmin(reminderId!);
      expect(row).not.toBeNull();
      expect(row!.status).toBe("active");
    });
  });
});
