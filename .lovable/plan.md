## Goal
Stop recurring CI failures caused by `prettier/prettier` ESLint errors by auto-formatting code before it ever reaches CI.

## Root cause
`eslint-plugin-prettier` makes every formatting drift a hard CI error. The Lovable agent (and humans) write files without running Prettier, so any whitespace/wrap difference fails `bun run lint` in GitHub Actions.

## Fix strategy: defense in depth

### 1. Pre-push safety net in CI workflow (primary fix)
Add a "Format check + auto-fix suggestion" step that runs `prettier --write` then fails with a clear diff if anything changed. More importantly, add a **pre-lint format step locally**: change the `lint` script so contributors get auto-fix.

Actually better — keep CI strict but make it self-healing for the agent:

**Add an `agents/format` step** that runs automatically as part of the existing pre-PR flow. Concretely:
- Update `package.json` scripts:
  - `"lint": "eslint ."` (unchanged — CI guardrail stays strict)
  - `"lint:fix": "eslint . --fix"` (new)
  - `"format": "prettier --write ."` (already exists)
  - `"preflight": "bun run format && bun run lint:fix && bun run lint"` (new — one command before commit)

### 2. Add Lovable agent instruction memory
Save a `mem://` rule so the agent always runs `bunx prettier --write` on any file it edits **before finishing the turn**. This is the most reliable fix given the agent is the main author. Memory entry:
- `mem://preferences/formatting` — "Always run `bunx prettier --write <changed files>` after editing TS/TSX/JS/JSON/MD. Never finish a turn with unformatted files."
- Add a one-liner to Core in `mem://index.md`.

### 3. Optional: Husky + lint-staged (only if user wants local enforcement)
For human contributors editing outside Lovable. Adds `.husky/pre-commit` that runs `lint-staged` → prettier+eslint on staged files. Skip if user only edits via Lovable.

### 4. Fix the 7 pre-existing warnings (optional cleanup)
- `react-refresh/only-export-components` in `CameraView.tsx`, `ReasonerContractProbe.tsx`, `AuthContext.tsx` — move non-component exports (constants, helpers, types) into sibling `*.helpers.ts` files.
- `react-hooks/exhaustive-deps` in `useMediaPipeHands.ts` — copy `videoRef.current` into a local before cleanup.

These are warnings, not blockers. Recommend leaving them unless user wants a clean log.

## Proposed deliverable (minimum to stop recurrence)
1. Update `package.json` to add `lint:fix` and `preflight` scripts.
2. Save persistent agent memory rules so Lovable auto-formats on every edit.
3. (Skip Husky and warning cleanup unless you ask.)

## Questions
- Do you want **(A)** just the memory rule + script additions (lightweight, fixes the agent's behavior going forward), or **(B)** also add Husky + lint-staged for local commits, or **(C)** also clean up the 7 pre-existing warnings?
