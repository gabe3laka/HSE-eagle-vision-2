# Fix CI Lint Failure via Auto-Format

The CI `Lint` step is failing because ESLint's `prettier/prettier` rule reports 24 errors / 3 warnings across many files. No app behavior needs to change — only formatting.

## Steps

1. Run `bun run format` (Prettier `--write .`) to reformat the whole repo per `.prettierrc` / `.prettierignore`.
2. Run `bun run lint -- --fix` to apply ESLint auto-fixes for any non-formatting rules that are auto-fixable.
3. Run `bun run lint` to confirm zero errors. If residual non-auto-fixable issues remain (e.g. unused vars, hook deps), fix them surgically file-by-file without changing behavior.
4. Run `bunx tsc --noEmit --pretty false` and `bun run test` to confirm no regressions were introduced by reformatting.

## Scope / Guardrails

- Only formatting + safe ESLint auto-fixes. No logic, no API, no UI changes.
- No changes to `.eslintrc`, `.prettierrc`, `.prettierignore`, or `package.json` scripts.
- No new dependencies (skipping husky/lint-staged unless you ask for it).
- `.github/workflows/ci.yml` stays as-is.

## Expected outcome

CI `Lint` step passes; Typecheck/Test/Build unaffected. Diff will touch many files but only whitespace / quote style / trailing commas / import ordering as dictated by existing Prettier + ESLint config.

## Optional follow-up (only if you want it)

Add husky + lint-staged pre-commit hook so future commits auto-format. Not included by default — say the word and I'll add it as a separate step.
