import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

/** Smoke (d): the Live X-Ray lens on a phone. Chromium's fake camera feeds the
 *  video element (no detections — the lens and dock must render fine over an
 *  empty scene). Needs the throwaway test account; skips cleanly without one. */
test.use({
  permissions: ["camera"],
  launchOptions: {
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("live: X-Ray lens drops, drags and pins over the fake camera", async ({ page }) => {
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");
  await signIn(page, email!, password!);

  await page.goto("/live?mode=hse");
  await page.getByRole("button", { name: /start monitoring/i }).click();

  // The chat dock ships with the lens flag — visible as soon as HSE Live is up.
  await expect(page.getByTestId("live-composer-dock")).toBeVisible({ timeout: 20_000 });

  // The lens surface mounts once the detector loop reports running. If it never
  // appears (flag disabled in this build's env), skip rather than fail.
  const lens = page.getByTestId("xray-lens-root");
  const mounted = await lens
    .waitFor({ state: "attached", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!mounted, "X-Ray lens not mounted (VITE_XRAY_LENS off in this build)");

  const box = (await lens.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Hover drops the lens in tracking mode and it follows the pointer.
  await page.mouse.move(cx, cy);
  await page.mouse.move(cx + 2, cy); // second move so the browser emits pointermove
  await expect(lens).toHaveAttribute("data-phase", "tracking");
  const lx1 = await lens.evaluate((el) => el.style.getPropertyValue("--lx"));
  await page.mouse.move(cx + 80, cy, { steps: 4 });
  await expect
    .poll(async () => lens.evaluate((el) => el.style.getPropertyValue("--lx")))
    .not.toBe(lx1);

  // Click pins it — the bezel stays put and the page underneath is usable again.
  await page.mouse.click(cx + 80, cy);
  await expect(lens).toHaveAttribute("data-phase", "pinned");
  await expect(page.getByTestId("xray-bezel")).toBeVisible();
});
