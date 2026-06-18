# Fix CI Node.js 20 deprecation warnings

The screenshot shows two `Node.js 20 is deprecated` warnings from GitHub Actions:
- `actions/checkout@v4` (used in both `build-and-test` and `gitleaks` jobs)
- `gitleaks/gitleaks-action@v2`

GitHub-hosted runners are forcing these onto Node 24. Both action versions still pin Node 20 internally, so the warning persists until we move to versions that ship a Node-24 runtime.

## Plan

Update `.github/workflows/ci.yml`:
- `actions/checkout@v4` → `actions/checkout@v5` (Node 24 runtime, drop-in replacement, same inputs).
- `oven-sh/setup-bun@v2` — already Node-24 compatible, no change.
- `gitleaks/gitleaks-action@v2` → `gitleaks/gitleaks-action@v2.3.9` pin. The `@v2` tag still resolves to the Node-20 release; the latest `v2.x` published with Node-24 support is `v2.3.9`. If that release is not yet Node-24, fall back to keeping `@v2` and the warning is benign (non-blocking). The `build-and-test` exit-code-1 error was the stale tests, already fixed in the previous turn — this plan only addresses the deprecation warnings.

No application code, no test changes.

## Files changed

- `.github/workflows/ci.yml`
