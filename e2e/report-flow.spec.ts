import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

/** Smoke (b): sign in → describe a hazard → agent drafts → review screen.
 *  Needs a throwaway test account (E2E_EMAIL / E2E_PASSWORD); skips cleanly
 *  without one. */
test("sign in, send a text report, land on the review screen", async ({ page }) => {
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");
  await signIn(page, email!, password!);

  await page.goto("/");
  const composer = page.locator("textarea");
  await expect(composer).toBeVisible();
  await composer.fill("E2E smoke: worker nearly slipped on an unmarked wet floor near bay 2.");
  await page.getByRole("button", { name: /draft report/i }).click();

  // Drafting can take a few seconds (edge function); the review screen is the
  // human gate — nothing was filed yet.
  await page.waitForURL(/\/report\//, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /review report/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
});
