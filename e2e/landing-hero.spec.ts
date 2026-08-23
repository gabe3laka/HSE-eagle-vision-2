import { expect, test } from "@playwright/test";

/** Smoke (e): the landing X-Ray hero. Needs NO test account — "/" is public.
 *  A signed-out visitor gets a draggable lens over the illustrated scene, and
 *  the composer underneath must stay fully usable (the regression that
 *  matters: the scene stealing pointer events from the input). */
test("landing hero: lens mounts, drags, reveals risk tiles, composer still works", async ({
  page,
}) => {
  await page.goto("/");

  const scene = page.getByTestId("hero-scene");
  await expect(scene).toBeVisible();
  // The honesty caption must accompany the illustration.
  await expect(page.getByText(/illustrated example/i)).toBeVisible();

  // Take control of the lens (stops the auto-sweep), then drag 120px.
  const box = (await scene.boundingBox())!;
  const x0 = box.x + box.width * 0.3;
  const y0 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.move(x0 + 2, y0);
  const lx1 = await scene.evaluate((el) => el.style.getPropertyValue("--lx"));
  await page.mouse.move(x0 + 120, y0, { steps: 5 });
  await expect
    .poll(async () => scene.evaluate((el) => el.style.getPropertyValue("--lx")))
    .not.toBe(lx1);

  // The reveal layer shows the authored S×L risk tiles inside the lens.
  const reveal = page.getByTestId("hero-reveal");
  await expect(reveal).toBeAttached();
  expect(await reveal.locator('[data-testid="hero-risk-tile"]').count()).toBeGreaterThan(0);

  // And the composer underneath is still focusable and typable.
  const composer = page.locator("textarea");
  await composer.click();
  await expect(composer).toBeFocused();
  await composer.fill("Forklift nearly hit a worker");
  await expect(composer).toHaveValue("Forklift nearly hit a worker");
});
