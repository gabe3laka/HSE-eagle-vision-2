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

/** Mobile ergonomics (runs on every project; the assertions hold on desktop
 *  too): no horizontal scroll, thumb-sized composer targets, unclipped hero. */
test("landing is phone-usable: no h-scroll, ≥44px targets, unclipped hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("textarea")).toBeVisible();

  // 1) The page body must never scroll horizontally.
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

  // 2) Composer input + send button are visible, thumb-sized tap targets.
  const composer = page.locator("textarea");
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox!.height).toBeGreaterThanOrEqual(44);

  const send = page.getByRole("button", { name: /draft report/i });
  await expect(send).toBeVisible();
  const sendBox = await send.boundingBox();
  expect(sendBox!.width).toBeGreaterThanOrEqual(44);
  expect(sendBox!.height).toBeGreaterThanOrEqual(44);

  // 3) The hero heading isn't clipped by its container or the viewport edge.
  const hero = page.getByRole("heading", { name: /what happened on/i });
  const heroBox = await hero.boundingBox();
  expect(heroBox!.x).toBeGreaterThanOrEqual(0);
  expect(heroBox!.x + heroBox!.width).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerWidth)) + 1,
  );
  // Horizontal overflow is what truncates text. Vertical scrollHeight is NOT
  // checked: tight display line-height (1.08) makes descenders overflow the
  // line box by a couple px while remaining fully painted (overflow: visible)
  // — measured 71 vs 69 on iPhone 14 Pro with pixel-perfect rendering.
  const clippedX = await hero.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clippedX).toBe(false);
});
