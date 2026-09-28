import { expect, test } from "@playwright/test";

test("app shell exposes Forewind Mail title", async ({ page }) => {
  // Follows redirects (e.g. / → /login once T5.2 auth middleware lands).
  await page.goto("/");
  await expect(page).toHaveTitle(/Forewind Mail/);
});
