import { expect, test } from "@playwright/test";
import {
  createE2EAdminClient,
  getProfile,
  getUserIdForEmail,
  requireE2EEnv,
  restoreProfile,
  signInAs,
  upsertProfile,
} from "../helpers/e2eAuth";

/**
 * M6 settings contract (planning-frozen).
 *
 * Env: same as M5 isolation — NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * E2E_USER_A_EMAIL, E2E_USER_B_EMAIL.
 *
 * Pause / timezone use seeded user A and restore the prior profile snapshot.
 * Delete spins up an ephemeral auth user so A/B accounts stay intact.
 *
 * Accessible contract the implementer must satisfy (T6.5):
 * - Route: /settings
 * - Labels: Time zone (native <select> of IANA zones)
 * - Switch: Pause emails (role=switch)
 * - Buttons: Delete account, Confirm delete
 * - Delete calls POST /api/account/delete then lands on /login
 *
 * Expect red until M6 settings UI + delete route land.
 */

test.describe("settings", () => {
  test.beforeAll(() => {
    requireE2EEnv();
  });

  test("time zone selector updates profiles.timezone", async ({ page }) => {
    const env = requireE2EEnv();
    const userId = await getUserIdForEmail(env.userAEmail);
    const priorProfile = await upsertProfile(userId, {
      timezone: "UTC",
      paused: false,
    });

    try {
      await signInAs(page, env.userAEmail);
      await page.goto("/settings");

      const timezone = page.getByLabel(/^time zone$/i);
      await expect(timezone).toBeVisible();
      await timezone.selectOption("America/New_York");

      await expect
        .poll(async () => (await getProfile(userId))?.timezone, {
          timeout: 10_000,
        })
        .toBe("America/New_York");
    } finally {
      await restoreProfile(userId, priorProfile);
    }
  });

  test("pause toggle sets profiles.paused immediately", async ({ page }) => {
    const env = requireE2EEnv();
    const userId = await getUserIdForEmail(env.userAEmail);
    const existing = await getProfile(userId);
    const priorProfile = await upsertProfile(userId, {
      timezone: existing?.timezone ?? "UTC",
      paused: false,
    });

    try {
      await signInAs(page, env.userAEmail);
      await page.goto("/settings");
      const pause = page.getByRole("switch", { name: /pause emails/i });
      await expect(pause).toBeVisible();
      await expect(pause).toHaveAttribute("aria-checked", "false");

      await pause.click();
      await expect
        .poll(async () => (await getProfile(userId))?.paused, {
          timeout: 10_000,
        })
        .toBe(true);

      await expect(pause).toHaveAttribute("aria-checked", "true");
    } finally {
      await restoreProfile(userId, priorProfile);
    }
  });

  test("delete account removes the auth user and signs out", async ({ page }) => {
    const admin = createE2EAdminClient();
    const email = `e2e-delete-${Date.now()}@forewind.test`;
    const password = `Delete-${Date.now()}-Aa1!`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`create ephemeral user: ${createError?.message ?? "no user"}`);
    }
    const userId = created.user.id;
    await upsertProfile(userId, { timezone: "UTC", paused: false });

    let deleted = false;
    try {
      await signInAs(page, email);
      await page.goto("/settings");

      await page.getByRole("button", { name: /^delete account$/i }).click();
      await page.getByRole("button", { name: /^confirm delete$/i }).click();

      await expect(page).toHaveURL(/\/login/);

      await expect
        .poll(
          async () => {
            const { data, error } = await admin.auth.admin.getUserById(userId);
            if (error || !data.user) {
              return "gone";
            }
            return "present";
          },
          { timeout: 15_000 },
        )
        .toBe("gone");
      deleted = true;

      // Session must no longer open protected routes.
      await page.goto("/reminders");
      await expect(page).toHaveURL(/\/login/);
    } finally {
      if (!deleted) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  });
});
