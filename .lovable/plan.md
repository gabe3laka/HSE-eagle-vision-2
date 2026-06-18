## Fix CI Test step: ERR_REQUIRE_ESM in vite.config.ts

**Problem:** Vitest startup fails because `vite.config.ts` top-level imports `@lovable.dev/vite-tanstack-config`, which Node tries to `require()` as CJS but it's ESM-only.

**Fix:** Rewrite `vite.config.ts` to:
1. Detect test runs via `process.env.VITEST === "true"` or `NODE_ENV === "test"`.
2. Under tests, return a minimal `UserConfig` with just the `__BUILD_TIME__` define — no plugin chain.
3. Otherwise, dynamically `await import("@lovable.dev/vite-tanstack-config")` and return `defineConfig(...)` with the same `tanstackStart.server.entry` and `vite.define` as today.

**Scope:** Only `vite.config.ts`. No changes to CI workflow, package.json, plugins, or app code. Dev/build behavior is preserved (same dynamic-loaded config); only vitest gets a slimmed config to avoid the ESM/CJS interop crash.

**Verify:** After the edit, the CI Test step should no longer throw ERR_REQUIRE_ESM. If a test relies on a plugin from the full config, we'll add only the minimal required plugin to the test branch.
