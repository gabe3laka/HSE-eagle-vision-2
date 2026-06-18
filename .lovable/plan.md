## Fix ESLint/Prettier formatting violations

Run the auto-fixer to resolve the 16 formatting issues currently failing CI (runs #33–#36), then verify the lint passes cleanly.

### Steps

1. Run `bun run lint --fix` to auto-format all files (Prettier will rewrite whitespace, wrap long lines, fix spacing).
2. Run `bun run lint` to confirm zero remaining errors.
3. If any non-auto-fixable issues remain (e.g. unused exports), manually patch them in:
   - `src/__tests__/hseMonitoring.test.ts`
   - `src/components/live/ReasonerContractProbe.tsx`
   - `src/features/build-mode/hooks/useBuildHandTracking.ts`
   - `src/lib/detection/backendVisionHttpDetector.ts`
   - `src/lib/detection/hseDetectProfile.ts`
4. Re-run the test suite (`bunx vitest run`) to confirm the formatting pass did not break behavior — all 432 tests should still pass.

### Guardrails (per standing instructions)

- No changes to Cloudflare config, the RunPod worker repo, Build mode logic, or Plan mode logic.
- No changes to secrets, `.env`, or auto-generated files (`routeTree.gen.ts`, Supabase integration files).
- Pure formatting-only diff — no behavior changes, no new features, no removed features.
- HSE pose-gating, Qwen scene-risk-only coloring, and Build wrist-fallback flag remain intact.

### Deliverable

A formatting-only commit that turns CI green. Final response will list files touched by Prettier, confirm lint + tests pass, and confirm no functional code paths changed.
