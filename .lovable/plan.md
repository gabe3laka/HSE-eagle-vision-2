## Live HSE Alignment — YOLO continuous + event-driven Qwen

Stop requesting backend pose in default Live HSE, hide raw backend-pose counts, clarify Qwen's event-driven status, keep risk-coloring tied only to linkable worker `scene_risks`, and disable Build-mode backend-wrist fallback. No worker / Cloudflare / Build / Plan logic changes beyond what's listed. No secrets added.

### 1. Stop requesting pose by default
File: `src/lib/detection/hseDetectProfile.ts`
- Add `const HSE_REQUEST_POSE = (import.meta.env.VITE_HSE_REQUEST_POSE ?? "false").toLowerCase() === "true"`.
- In `buildHseDetectRequest`, filter `spec.tasks` to drop `"pose"` unless the flag is true, then merge with the canonical `["detect","track","risk","scene_reasoning"]` set.
- Document the flag in `.env.example` and `src/build-env.d.ts`.

### 2. Hide raw backend pose count in default HSE UI
Files: `src/pages/Live.tsx`, `src/components/live/CameraView.tsx` (and any chip that reads raw pose count).
- Replace the "Detected poses: N" chip in default HSE with "Risk-linked poses: N" sourced from `hseRiskViewModel.overlayPoses.length`.
- Keep raw count only when an existing debug flag (`hseFlags.debug` / dev probe) is on.

### 3. Keep risk-coloring worker-driven
Verify only — no behavior change. Confirm `CameraView` in HSE mode still uses `hseRiskViewModel.overlayEntities/Poses` and `overlayMode="hse-risk-only"`. Note in plan; no edits unless drift found.

### 4. Event-driven Qwen status surface
Files: `src/components/live/ReasonerContractProbe.tsx`, `src/components/live/SceneRiskPanel.tsx`, `src/lib/detection/hseLiveRiskViewModel.ts`.
- Extend reasoner-status normalization to map to one of: `ready | running | queued | rules_only | unavailable | timeout | disabled`. "ready" only for explicit `ready/ok/done/completed/success` (already enforced) — extend to also recognize `queued`, `running`, `timeout`, `disabled`, `rules_only`.
- SceneRiskPanel: when `scene_risks` empty, show "No active scene risks." (or "No worker scene_risks returned for latest frame." when reasoner is `ready`).
- Probe: add rows for `perception backend`, `model`, `detector objects`, `risk-linked boxes`, `reasoner_status`, `scene_risks count`, `qwen contribution`, `visible alert source: worker_scene_risks`, `local alerts enabled`.

### 5. Build mode — disable backend-wrist fallback by default
Files: `src/features/build-mode/hooks/useBuildHandTracking.ts` (and/or `lib/handTracking.ts`, `components/HandPointerLayer.tsx`), `src/pages/Live.tsx`, `src/build-env.d.ts`, `.env.example`.
- Add `VITE_BUILD_BACKEND_WRIST_FALLBACK=false`.
- When false: skip ingesting backend pose keypoints into hand pointers; do not render backend wrist dots; do not allow them to trigger pinch/hold/extract.
- When true: retain existing strict-validation path.

### 6. Debug-only raw pose overlay
Files: `src/pages/Live.tsx`, `src/components/live/BackendPoseOverlay.tsx` mounting sites.
- Ensure `BackendPoseOverlay` / skeleton layers only mount when `appMode === "hse" && hseFlags.debug` (or explicit backend debug). Hide in Build/Plan/default-HSE.

### 7. Live HSE readiness/probe summary
Already covered by §4 probe rows — pull `perception_backend` / `model` from latest `/detect` response (store on `ParsedDetectRisk` or response meta if not already exposed; read via existing raw-response fallback used in the probe).

### 8. Tests
New / updated:
- `src/__tests__/hseDetectProfile.test.ts` (new): default tasks exclude `pose`; with `VITE_HSE_REQUEST_POSE=true`, `pose` included.
- `src/__tests__/reasonerProbe.test.ts`: add cases for `queued`/`running` → no fake risks; `ready` only on explicit tokens; backend/model surfaced.
- `src/__tests__/hseLiveRiskViewModel.test.ts`: no `scene_risks` ⇒ 0 risk-linked boxes; unlinked risk doesn't color; linked risk colors only its entity (extend existing).
- `src/__tests__/buildHandTracking.test.ts`: backend `left_wrist` ignored when fallback flag false; MediaPipe landmarks still produce pointers.
- Live UI test (light) asserting raw "Detected poses" chip absent in default HSE.

### Out of scope
Cloudflare worker, RunPod worker repo, secret management, Build/Plan reasoning logic, request-body shape beyond `tasks` filtering.

### Files to change
- `src/lib/detection/hseDetectProfile.ts`
- `src/build-env.d.ts`, `.env.example`
- `src/pages/Live.tsx`
- `src/components/live/CameraView.tsx`
- `src/components/live/ReasonerContractProbe.tsx`
- `src/components/live/SceneRiskPanel.tsx`
- `src/lib/detection/hseLiveRiskViewModel.ts`
- `src/features/build-mode/hooks/useBuildHandTracking.ts` (+ HandPointerLayer if needed)
- Tests listed above
