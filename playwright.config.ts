import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests only (see e2e/). Run locally against the dev server:
 *
 *   npx playwright test            # starts vite automatically
 *   E2E_EMAIL=… E2E_PASSWORD=…  npx playwright test   # unlocks auth flows
 *
 * Spec (a) needs no credentials; (b)/(c) skip cleanly when E2E_EMAIL /
 * E2E_PASSWORD are unset. Not wired into CI on purpose — no secrets in repo.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    // Sandboxes with a pre-provisioned Chromium (no `playwright install`):
    // point E2E_CHROMIUM_PATH at the binary. Unset → normal resolution.
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite dev --host 127.0.0.1 --port 8080",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
