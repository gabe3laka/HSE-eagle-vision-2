## Force Hive Mode always-on

Replace the three flag-read call sites so Hive Mode and Hive Debug cannot be turned off by any build env — they become unconditionally `true`.

### Changes

1. **`src/pages/Live.tsx`** (~line 359): replace
   `readFlag("VITE_SHARED_VISION_ENABLED", safeEnv(), true)` → `true`
2. **`src/pages/Live.tsx`** (~line 480): replace
   `readFlag("VITE_HIVE_DEBUG", safeEnv(), true)` → `true`
3. **`src/features/organizations/components/OrganizationsCard.tsx`** (~line 59): replace
   `readFlag("VITE_SHARED_VISION_ENABLED", safeEnv(), true)` → `true`

Remove any now-unused `readFlag` / `safeEnv` imports in those two files.

### Verify

- `bunx prettier --write` on the edited files
- `bun run build`
- `bunx vitest run`

### Then publish

Publish the project so the new build ships to `safelenshse.lovable.app`.
