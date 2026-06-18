# Pin Bun + Add CI Debug Step

## Problem

`build-and-test` is failing with exit code 1, but the YAML itself is valid. The job uses `bun-version: latest`, so any breaking Bun release on the runner can fail Typecheck / Test / Build without any code change in the repo. The `gitleaks` / Node 20 messages in the screenshot are deprecation warnings, not the failure.

## Changes (single file: `.github/workflows/ci.yml`)

1. **Pin Bun to a known-good version** in the `Setup Bun` step:
   - Replace `bun-version: latest` with a fixed version (proposed: `1.1.38` — the most recent stable line we've been using; can be swapped to whatever your last green run shows).

2. **Add a non-invasive debug step** right after `Setup Bun` so failing runs show environment info up front:
   ```yaml
   - name: Debug environment
     run: |
       echo "Runner: $RUNNER_OS"
       bun --version || true
       node --version || true
       bunx --version || true
   ```

3. **Make Typecheck output easier to read in CI logs**:
   - Change `bunx tsc --noEmit` → `bunx tsc --noEmit --pretty false`.

No other steps, jobs, scripts, or app code are touched. Lint / Test / Build commands and the `gitleaks` job stay exactly as they are.

## Out of scope

- No application code changes.
- No changes to test files, package.json scripts, or `HSE_PRIORITY_RISK_LIMIT`.
- No removal of the audit step or gitleaks job.

## Confirm before I build

Do you want me to pin Bun to **`1.1.38`**, or do you have a specific version from your last green run you'd rather pin to?
