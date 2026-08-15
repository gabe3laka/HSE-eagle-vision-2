import { expect, test } from "@playwright/test";

/** Smoke (a): the public front door renders for a signed-out visitor —
 *  hero + composer visible, no crash, no auth wall. */
test("landing loads with the composer visible when logged out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /what happened on/i })).toBeVisible();
  await expect(page.locator("textarea")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  // The mic stays visibly present but disabled ("coming soon" — fixed decision).
  await expect(page.getByRole("button", { name: /voice memo/i })).toBeDisabled();
});
