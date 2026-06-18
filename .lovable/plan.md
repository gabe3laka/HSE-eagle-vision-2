## Plan: HSE status overlay — one box per detection, GREEN by default, risk colors when linked

### Goal
In HSE mode, render exactly one box per Ultralytics-detected object. Default color = GREEN (safe/observed). Upgrade to YELLOW/ORANGE/RED only when the worker links a scene risk to that object. Detector labels (cup, laptop, …) are preserved. Priority Scene Risks remain YELLOW+ only. Clearly diagnose whether detection works vs. Qwen is unavailable/queued/ready-with-no-risks.

### Files to change
- `src/lib/detection/hseLiveRiskViewModel.ts` — overlay builder + label + counts + new `"hse-status"` mode
- `src/pages/Live.tsx` — switch HSE overlay mode to `"hse-status"`; expose raw detector count chip separately; new wording for chips
- `src/components/live/CameraView.tsx` — accept `"hse-status"` in `HseOverlayMode` prop type; pass through to overlay/label code
- `src/components/live/BackendEntityOverlay.tsx` — accept and treat `"hse-status"` identically to `"hse-risk-only"` for label/color resolution (single overlay source, no duplicate boxes)
- `src/components/live/ReasonerContractProbe.tsx` — show "Detection route: working" + Qwen status + scene_context/scene_risks/warnings; explicit detection-vs-Qwen diagnostic messages
- `src/__tests__/hseLiveRiskViewModel.test.ts` — new tests for status overlay, counts, priority filtering
- `src/__tests__/reasonerProbe.test.ts` — diagnostic-wording tests (detection-working + qwen-unavailable / queued / ready-no-risks)

No Cloudflare files, no Supabase edge functions, no worker repo changes. No secrets.

### Part 1 — Add `"hse-status"` overlay mode
- Extend the union:
  ```ts
  export type HseOverlayMode = "normal" | "hse-status" | "hse-risk-only" | "debug";
  ```
- `Live.tsx` passes `overlayMode="hse-status"` and the single entity source `backendEntities={hseRiskViewModel.overlayEntities}` to `CameraView` in HSE mode. No second raw-entity overlay is rendered.

### Part 2 — Build `overlayEntities` from all detector entities (GREEN by default, upgrade on link)
Rewrite the overlay-building block in `buildHseLiveRiskViewModel`:

1. Replace `entityWithRisk` with `entityWithSafetyStatus(entity, level, risk?)` that always sets `risk_level` and `risk_color = level` (so GREEN is also stamped), copies `risk_score / risk_reason / recommended_action / produced_by / linked_risk_id` only when a `risk` is provided.
2. Add stable `entityOverlayKey(e)` (track_id → id → entity_id → detection_id → label+bbox composite) to dedupe.
3. Seed `overlayMap` with every detector entity at GREEN.
4. Upgrade for every linked scene risk (priority + weak-edge linked) using `effectiveRiskLevel`; only overwrite when the new level rank is `>=` existing.
5. Honor entity-level worker risk levels (>= YELLOW) as an upgrade pass.
6. `overlayEntities = [...overlayMap.values()]` — one box per detected object.

Acceptance: 5 detected + 0 risks → 5 GREEN; 5 detected + 1 YELLOW link → 4 GREEN + 1 YELLOW; RED overrides; ORANGE entity-level overrides default GREEN.

### Part 3 — Keep Priority Risks YELLOW+
`visibleGrouped` filter already enforces `>= YELLOW`. Verify GREEN never produces a grouped row, never feeds haptics/alerts/incidents. Add a regression test: empty risks → `priorityRisks.length === 0` and HUD still shows GREEN boxes.

### Part 4 — Preserve detector labels
Update `boxLabelForEntity` so `"hse-status"` returns `itemNameForEntity(e)` (same as `"hse-risk-only"`). Never emit risk words / GREEN / safe / stale.

### Part 5 — One overlay system in HSE
In `Live.tsx`, when HSE is active, the only entity overlay source rendered is `hseRiskViewModel.overlayEntities`. Raw `backendEntities` are not passed to any overlay component in HSE mode — they're only kept for the chip count via `rawBackendEntityCount`.

### Part 6 — Chip wording + new counts
Add to `HseLiveRiskViewModel`:
```ts
statusEntityCount: number;     // overlayEntities.length
activeRiskEntityCount: number; // count where level >= YELLOW
safeEntityCount: number;       // count where level === GREEN
// backward compat:
riskLinkedEntityCount = activeRiskEntityCount;
```
`Live.tsx` chips render:
- "Detected objects: N" (raw backend entity count)
- "Safety-status boxes: N" (`statusEntityCount`)
- "Active risk boxes: N" (`activeRiskEntityCount`)
- "Risk-linked poses: N" (existing `riskLinkedPoseCount`)

### Part 7 — Diagnostic wording in `ReasonerContractProbe`
Display:
- "Detection route: working" if entities exist or last `/detect` succeeded; otherwise "Detection route: error/unavailable".
- "AI/Qwen route: queued | unavailable | disabled | error | ready" from `reasonerBadge.state`.
- `scene_context: yes/no`, `scene_risks: N`, `warnings: qwen_unavailable` when present.
- Summary line, exactly one of:
  - detection ok + qwen unavailable → "Detection is working. Qwen reasoning is not available from the worker response."
  - detection ok + qwen queued → "Detection is working. Qwen reasoning is queued/throttled and no current scene_risks were returned."
  - detection ok + qwen ready + 0 risks → "Detection and Qwen responded. Qwen returned no active scene risks for the latest frame."

### Part 8 — Manual Test Detect Frame
Leave the existing manual-test `requestReason: "manual-test"` body with `force_reason: true` and the full `reasoning_preferences` block unchanged. Confirm live loop does NOT set `force_reason` per frame (already event-driven).

### Part 9 — Tests
Extend `hseLiveRiskViewModel.test.ts`:
- 3 entities, 0 risks → 3 overlay, all GREEN, labels preserved, unique keys
- 3 entities, 1 linked YELLOW → 1 YELLOW + 2 GREEN
- linked RED overrides existing GREEN/YELLOW
- entity-level ORANGE upgrades GREEN
- `statusEntityCount / activeRiskEntityCount / safeEntityCount` and back-compat `riskLinkedEntityCount === activeRiskEntityCount`
- 0 active → `priorityRisks.length === 0`

Extend `reasonerProbe.test.ts`:
- detection-working + qwen unavailable → expected wording
- detection-working + qwen queued → expected wording
- ready + 0 risks → expected wording

Run `bunx vitest run` + `bun run lint` afterwards.

### Out of scope / unchanged
- Cloudflare worker, RunPod worker repo
- Supabase edge functions / DB schema
- Auth, secrets, env
- Build / Plan mode behavior
- `src/integrations/supabase/*` auto-gen files

### Acceptance checklist (mirrors prompt)
- One box per detected object in HSE mode (GREEN default, YELLOW/ORANGE/RED when linked)
- Detector labels preserved
- No duplicate boxes (single overlay source)
- GREEN excluded from Priority Scene Risks, haptics, alerts, incidents
- Diagnostic wording distinguishes detection-vs-Qwen state
- Manual Test Detect Frame still sends `force_reason` payload
- Cloudflare + worker repo + secrets unchanged