import { expect, test } from "@playwright/test";
import {
  getUserIdForEmail,
  requireE2EEnv,
  restoreProfile,
  signInAs,
  upsertProfile,
  type ProfileSnapshot,
} from "../helpers/e2eAuth";

/**
 * M6 landing-page contract (planning-frozen).
 *
 * Env (signed-in case only): NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * E2E_USER_A_EMAIL, E2E_USER_B_EMAIL.
 *
 * Unauthenticated cases need no secrets. Signed-in redirect uses the same
 * Admin generateLink + cookie injection as M5/M6 CRUD specs.
 *
 * Accessible contract the implementer must satisfy (T6.7–T6.8):
 * - `/` is public (middleware allowlist includes "/"); no session → 200
 * - Brand heading: role="heading" level 1 named "Forewind Mail"
 * - Supporting copy that mentions email reminders (product explanation)
 * - Primary CTA: link named /sign in/i → /login
 * - Wordmark asset served at /assets/wordmark.svg (T6.7)
 * - Signed-in GET / → redirect to /reminders
 *
 * Expect red until T6.7–T6.8 land. Companion change: isolation.spec.ts now
 * asserts unauthenticated /reminders → /login (not /), so it stays green
 * when / becomes public.
 */

test.describe("landing page", () => {
  test("unauthenticated / stays on the marketing page", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /forewind mail/i }),
    ).toBeVisible();
    await expect(page.getByText(/email reminder/i)).toBeVisible();
  });

  test("primary CTA links to /login", async ({ page }) => {
    await page.goto("/");
    const signIn = page.getByRole("link", { name: /sign in/i });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", /\/login/);
  });

  test("wordmark asset is served at /assets/wordmark.svg", async ({
    request,
  }) => {
    const response = await request.get("/assets/wordmark.svg");
    expect(response.ok()).toBe(true);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toMatch(/svg|xml/i);
  });

  test("signed-in user hitting / is redirected to /reminders", async ({
    page,
  }) => {
    const env = requireE2EEnv();
    const userId = await getUserIdForEmail(env.userAEmail);
    let priorProfile: ProfileSnapshot | null = null;

    try {
      priorProfile = await upsertProfile(userId, {
        timezone: "UTC",
        paused: false,
      });
      await signInAs(page, env.userAEmail);
      await page.goto("/");
      await expect(page).toHaveURL(/\/reminders\/?$/);
    } finally {
      await restoreProfile(userId, priorProfile);
    }
  });
});
