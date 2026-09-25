import { expect, test } from "@playwright/test";

test("homepage has the expected title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Forewind Mail/);
});
