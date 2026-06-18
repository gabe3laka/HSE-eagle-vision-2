// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { UserConfig } from "vite";

// Build timestamp baked into the bundle so the running app can show which build
// it is (see src/lib/buildInfo.ts). Read in-app via a typeof guard.
const BUILD_TIME = new Date().toISOString();

const isTest =
  process.env.VITEST === "true" || process.env.NODE_ENV === "test";

/**
 * Export an async config factory. We avoid importing
 * @lovable.dev/vite-tanstack-config at top-level so vitest doesn't cause Node
 * to attempt a require() on an ESM-only module and throw ERR_REQUIRE_ESM.
 */
export default async (
  env: { command: "build" | "serve"; mode: string; isSsrBuild?: boolean; isPreview?: boolean } = {
    command: "serve",
    mode: "development",
  },
): Promise<UserConfig> => {
  if (isTest) {
    // Minimal config for vitest — skips the full plugin chain to avoid
    // ESM/CJS interop issues inside the test runner.
    return {
      define: {
        __BUILD_TIME__: JSON.stringify(BUILD_TIME),
      },
    } as UserConfig;
  }

  const { defineConfig } = await import("@lovable.dev/vite-tanstack-config");

  const config = defineConfig({
    tanstackStart: {
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
    },
    vite: {
      define: {
        __BUILD_TIME__: JSON.stringify(BUILD_TIME),
      },
    },
  });

  // defineConfig may return a config object, a promise, or a function — resolve it.
  const resolved =
    typeof config === "function"
      ? await (config as (e: typeof env) => UserConfig | Promise<UserConfig>)(env)
      : await config;
  return resolved as UserConfig;
};
