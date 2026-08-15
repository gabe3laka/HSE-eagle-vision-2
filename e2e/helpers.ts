import { expect, type Page } from "@playwright/test";

/** Sign in through the real /auth form (no API shortcuts — the login UI is
 *  part of what the smoke run verifies). */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Landing back on Home with the app shell proves the session is live.
  await page.waitForURL(/\/$/, { timeout: 20_000 });
  await expect(page.locator("textarea")).toBeVisible();
}
