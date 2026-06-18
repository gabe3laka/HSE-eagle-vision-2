## Final Hardening — Normalize reasoner_status + broaden probe

Scoped to the app only. No Cloudflare, RunPod, Build mode, or Plan mode changes. No new Vite env vars. Live HSE request body, Test Detect Frame HSE-awareness, and the Reasoner Contract Probe placement stay as-is.

### 1. Add `normalizeReasonerStatus` helper

**`src/lib/detection/riskTypes.ts`** — widen the type and export the helper:

```ts
reasoner_status?: string | { state?: unknown; status?: unknown; reasoner_status?: unknown; [k: string]: unknown };

export function normalizeReasonerStatus(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    const s = r.state ?? r.status ?? r.reasoner_status;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}
```

Also add an optional `reasonerStatusRaw?: Record<string, unknown>` field to `ParsedDetectRisk` so the probe can still display the structured object verbatim.

### 2. Use the helper in `parseDetectRiskFields`

**`src/lib/detection/backendVisionHttpDetector.ts`** (~line 260): replace the string-only branch with:

```ts
const normalized = normalizeReasonerStatus(r.reasoner_status);
if (normalized) out.reasonerStatus = normalized;
if (r.reasoner_status && typeof r.reasoner_status === "object") {
  out.reasonerStatusRaw = r.reasoner_status as Record<string, unknown>;
}
```

### 3. Broaden `hasRiskAwareData`

Same file (lines 211–228). Add to the key list so the probe surfaces reasoner-only responses:

```
"highest_risk_level", "temporal_reasoning", "scene_context", "semantic_corrections"
```

Add `highest_risk_level?: string` to `RiskAwareFields` so the key list stays type-safe. It is not parsed into a dedicated field (callers derive highest level from `risk_summary` / `scene_risks`); it only matters for presence detection.

### 4. Probe reads raw fallback fields when `parsedRisk` is null

**`src/components/live/ReasonerContractProbe.tsx`**:
- Accept `rawResp` already (kept). When `parsedRisk` is `null` AND `rawResp` is an object containing any of `reasoner_status`, `scene_context`, `semantic_corrections`, `temporal_reasoning`, `risk_summary`, `highest_risk_level`, render those rows directly from `rawResp` using `normalizeReasonerStatus` and simple presence checks.
- Strictly diagnostic: never construct fake risks, never feed `useHseMonitoring`.
- Keep the "End-to-end working" verdict gated on real `scene_risks` (unchanged); add "Qwen contribution: detected" when `normalizeReasonerStatus(rawResp.reasoner_status)` is in the ready/running/queued set AND any of `scene_context` / `semantic_corrections` is present, even without `parsedRisk`.

`summarizeDetectResponse` already pulls `reasonerStatus` from `parsed`; extend it to fall back to `normalizeReasonerStatus(r.reasoner_status)` on the raw response when `parsed` is null, and to read `sceneContextPresent`, `semanticCorrections`, `temporalReasoningPresent`, `highestLevel` from raw fallback fields.

### 5. Strict Qwen badge in `hseLiveRiskViewModel.ts`

`reasonerStatusBadge(parsedRisk)` (~line 456) already gates "Qwen: ready" to explicit ready/ok/done/completed/success tokens. Confirm and keep:
- Unknown object that normalizes to an unrecognized string → `Qwen: unavailable — using rules only`.
- Object normalizing to `running`/`processing`/`in_progress` → `Qwen: running`.
- No change required beyond consuming the now-already-normalized `parsedRisk.reasonerStatus`.

Also update `buildReasonerProbe` Qwen-from-context gate to use the same ready/running set explicitly (already does — keep).

### 6. Tests

**`src/__tests__/riskAware.test.ts`** — add:
- `reasoner_status: "ready"` → `hasRiskAwareData` true; parsed `reasonerStatus === "ready"`.
- `reasoner_status: { enabled: true, mode: "qwen_vl", state: "ready" }` → parsed `reasonerStatus === "ready"`, `reasonerStatusRaw.mode === "qwen_vl"`.
- `reasoner_status: { foo: "bar" }` → parsed `reasonerStatus` is `undefined`/null; `reasonerStatusBadge` resolves to `Qwen: unavailable — using rules only` (import from view model).
- Response with only `scene_context` → `hasRiskAwareData` true.
- Response with only `semantic_corrections: [{...}]` → `hasRiskAwareData` true.
- Response with only `temporal_reasoning: {...}` → `hasRiskAwareData` true.
- Response with only `highest_risk_level: "RED"` → `hasRiskAwareData` true.

**`src/__tests__/hseLiveRiskViewModel.test.ts`** — add: `buildReasonerProbe` returns `qwenDetected: true` when `parsedRisk` has `reasonerStatusRaw: { state: "ready" }` and `sceneContext` present, even with zero scene_risks.

### Files changed
- `src/lib/detection/riskTypes.ts`
- `src/lib/detection/backendVisionHttpDetector.ts`
- `src/components/live/ReasonerContractProbe.tsx`
- `src/lib/detection/hseLiveRiskViewModel.ts` (minor — consume normalized status; no behavior change to badge logic)
- `src/__tests__/riskAware.test.ts`
- `src/__tests__/hseLiveRiskViewModel.test.ts`

### Out of scope (unchanged)
`supabase/functions/*`, Cloudflare worker, RunPod worker, Build mode (`src/features/build-mode/**`), Plan mode (`src/features/build-mode/lib/planReasoning.ts` and related), Vite env, Live HSE request body, Test Detect Frame HSE metadata path.
