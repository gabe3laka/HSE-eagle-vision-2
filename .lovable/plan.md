# Plan — Strengthen Qwen Risk-Anchor Memory

## Goal

Today a Qwen-linked risk only stays painted while exact `track_id` / `linked_entity_id` matches survive frame-to-frame. When YOLO re-ids a track or briefly drops/regains an object, the colored box can flicker even though the same physical object is clearly visible. We need a **risk-anchor memory** that survives track_id churn, always paints the **current YOLO bbox**, fades dashed/stale on loss, and explains itself in diagnostics.

Scope: app repo only (`src/features/hse-monitoring/*`, `src/lib/detection/hseLiveRiskViewModel.ts`, overlay color/style, Live diagnostics panel). Worker/Cloudflare/RunPod, Build mode and Plan mode are untouched. No secrets.

## Current state (audit)

- `linkedEntitiesForRisk` already does **id → spatial (IoU≥0.2 or center<0.12)** fallback. Good baseline; we keep and reuse it.
- `useHseLiveRiskViewModel` has stickiness keyed by `HseGroupedRisk.key`. Hard caps: YELLOW 2500 ms, RED 5000 ms, MIN 1000 ms.
- **Gap 1**: when YOLO emits a new `track_id` for the same physical object, `groupKey()` changes → the previous sticky entry expires and a new one starts; no anchor carries the Qwen link across.
- **Gap 2**: when the risk has no live link this frame but a compatible YOLO entity exists near the previous anchor with a similar label, we don't re-attach.
- **Gap 3**: sticky-carried entries replay the **previous** entity's bbox instead of the **current** YOLO bbox of the closest match.
- **Gap 4**: overlay does not render a dashed/stale style for carried-but-unmatched anchors.
- **Gap 5**: no per-risk diagnostic explaining the disposition (`linked` / `sticky-carried` / `stale` / `ignored` / `unmatched-candidate`).

## Design

### 1. Risk-anchor store (`src/features/hse-monitoring/lib/riskAnchorMemory.ts`, new, pure)

A small store keyed by a **stable anchor key**, NOT by `track_id`:

```text
anchorKey = risk_id || source_risk_id || `${hazardType}|${normalizedLabel}|${anchorRegion}`
```

`anchorRegion` is a coarse bucket of the last known center (e.g. quantized to 0.05 in normalized coords) so two unrelated "object_near_edge" risks on opposite sides of the frame don't collide.

For each key we keep:

```text
{ anchorKey, hazardType, level, label?, lastBbox, lastTrackIds, lastEntityIds,
  lastDetectionIds, firstSeenMs, lastLinkedMs, lastCarriedMs,
  disposition: 'linked' | 'sticky-carried' | 'stale' | 'ignored' }
```

Pure functions:

- `upsertAnchorOnLink(prev, grouped, currentEntity, now)`
- `tryRebindAnchor(prev, currentEntities, parsedRisk, now)` — for each anchor with no fresh link this frame, try in order:
  1. exact id match against any current entity (`track_id`, `id`, `entity_id`, `detection_id`)
  2. **same label + IoU≥0.2 OR center<0.12** to `lastBbox`
  3. **spatialMatchRiskToEntity** against the raw `SceneRisk` for that anchor (reuse existing helper)
  4. otherwise mark as `sticky-carried` (using `lastBbox`) until TTL, then `stale`, then drop.
- `expireAnchors(prev, now, caps)` with the existing caps:
  - YELLOW carried/stale dashed: 2500 ms total (matches `YELLOW_HARD_MAX_MS`)
  - ORANGE/RED carried/stale dashed: 5000 ms (matches `RED_STALE_MAX_MS`); user prompt allows up to 6 — keep at 5000 to stay aligned with the heartbeat cap we just set.
- Never mints a brand-new box for an anchor that has never been linked. Anchors are created only from real linked grouped risks.

### 2. View-model integration (`src/features/hse-monitoring/hooks/useHseLiveRiskViewModel.ts`)

- After `buildHseLiveRiskViewModel`, run `tryRebindAnchor` + `expireAnchors` on the ref-stored anchor map.
- For each anchor that rebinds to a **current** YOLO entity, **override `overlayEntities` to use the current entity's bbox** (never the cached one). This satisfies: "always use current YOLO bbox; never use old Qwen bbox as live overlay position; if the object moved slightly, the colored box follows the current YOLO box".
- For `sticky-carried` and `stale` anchors with no current match, emit a synthetic overlay entry tagged `__riskAnchorStale: true` carrying `lastBbox`. Cap entry lifetime via the existing per-level windows.
- Augment `HseGroupedRisk` (or attach via a parallel `riskAnchors` array on the view model) with `anchorDisposition` so consumers can render dashed style + diagnostics.

### 3. Overlay style (`src/components/live/BackendEntityOverlay.tsx`)

- When `entity.__riskAnchorStale === true` (or a parallel `staleAnchorKeys: Set<string>` is passed in), render the box with:
  - dashed border (`stroke-dasharray`)
  - 60% opacity
  - same hazard color as before
- No other visual change for healthy linked boxes.

### 4. Diagnostics

- Extend `HseGroupedRisk` with optional `anchorDisposition?: 'linked' | 'sticky-carried' | 'stale' | 'ignored' | 'unmatched-candidate'` + a one-line `anchorReason?: string`.
- In `HseMonitoringPanel` (priority risks list) and `ReasonerContractProbe`, show the disposition pill next to each Qwen-linked risk. `ignored` reuses the existing `heartbeatIgnoreReason` text.
- Console-side: when a disposition transitions, log once at debug level with the chosen path (id / label+spatial / spatial-only / none).

### 5. Tests (`src/__tests__/`)

New `riskAnchorMemory.test.ts`:
- carries an anchor across a `track_id` change when label + IoU match
- rebinds via center-distance when IoU is 0 but center<0.12
- expires YELLOW carried after 2500 ms and RED after 5000 ms
- never invents an overlay entity for an anchor that was never linked
- emits the correct `disposition` for each rebind path

Extend `qwenHeartbeat.test.ts` / view-model thresholds: assert that current YOLO bbox is used (not cached) when rebind succeeds, and dashed flag is set only when no current match.

## Files changed

- `src/features/hse-monitoring/lib/riskAnchorMemory.ts` *(new, pure)*
- `src/features/hse-monitoring/hooks/useHseLiveRiskViewModel.ts` *(integrate anchor memory; override bbox to current entity; emit stale overlays)*
- `src/lib/detection/hseLiveRiskViewModel.ts` *(add `anchorDisposition` / `anchorReason` to `HseGroupedRisk` type only)*
- `src/components/live/BackendEntityOverlay.tsx` *(dashed/opacity style for stale anchors)*
- `src/components/live/HseMonitoringPanel.tsx` *(show disposition pill)*
- `src/components/live/ReasonerContractProbe.tsx` *(show disposition in diagnostics)*
- `src/__tests__/riskAnchorMemory.test.ts` *(new)*
- `src/__tests__/qwenHeartbeat.test.ts` *(extend)*
- `src/__tests__/hseLiveRiskViewModelThresholds.test.ts` *(extend with anchor-carry assertion)*

## Out of scope

- Cloudflare Worker, RunPod, `postDetectFrame`, Build / Plan modes.
- Adding any Vite secret or `.env` value (no new public flags needed — caps reuse the existing `YELLOW_HARD_MAX_MS` / `RED_STALE_MAX_MS`).
- Changing how Qwen heartbeat fires or how `mergeParsedRisk` works.

## Acceptance

- A Qwen risk on a person/object survives a YOLO `track_id` change as long as a current entity with a similar label is near the previous anchor — and paints with the **current** YOLO bbox.
- When no current match exists, the box stays dashed/semi-transparent for the per-level window then clears; we never fabricate a new solid box.
- Each Qwen-linked priority risk shows a disposition (`linked` / `sticky-carried` / `stale` / `ignored` / `unmatched-candidate`).
- All existing tests still pass; new tests cover rebind paths and TTL.