/**
 * useHseLiveRiskViewModel — thin React wrapper around `buildHseLiveRiskViewModel`
 * that adds box-stickiness AND risk-anchor memory. Linked risk boxes stay
 * visible for a minimum window so the overlay never flickers when a single
 * frame loses the detection. Anchors carry a Qwen-linked risk across YOLO
 * `track_id` churn by rebinding via id → label+spatial proximity → spatial.
 * When no rebind succeeds the carried box renders dashed/faded for a per-level
 * window. Stores only metadata (key, level, bbox, ids, timestamps) — no images.
 */

import { useMemo, useRef } from "react";
import {
  buildHseLiveRiskViewModel,
  type BuildHseLiveRiskViewModelInput,
  type HseGroupedRisk,
  type HseLiveRiskViewModel,
} from "@/lib/detection/hseLiveRiskViewModel";
import type { BackendEntity } from "@/lib/detection/types";
import type { RiskLevel } from "@/lib/detection/riskTypes";
import { riskLevelRank } from "@/lib/detection/riskTypes";
import {
  advanceAnchor,
  anchorReasonFor,
  staleOverlayEntityFor,
  upsertAnchorOnLink,
  DEFAULT_ANCHOR_CAPS,
  type RiskAnchorEntry,
} from "@/features/hse-monitoring/lib/riskAnchorMemory";

export const MIN_VISIBLE_RISK_MS = 1000;
export const YELLOW_RESOLVING_MS = 500;
export const YELLOW_HARD_MAX_MS = 2500;
export const RED_STALE_MAX_MS = 5000;

interface StickyEntry {
  key: string;
  entity: BackendEntity;
  firstVisibleMs: number;
  lastSeenMs: number;
  level: RiskLevel;
  bbox: BackendEntity["bbox"];
  resolving: boolean;
}

function findLinkedEntity(g: HseGroupedRisk, entities: BackendEntity[]): BackendEntity | null {
  for (const e of entities) {
    if (e.track_id && g.linkedTrackIds.includes(String(e.track_id))) return e;
    const eid = (e as unknown as { id?: string }).id;
    if (typeof eid === "string" && g.linkedEntityIds.includes(eid)) return e;
  }
  return null;
}

export function useHseLiveRiskViewModel(
  input: BuildHseLiveRiskViewModelInput,
): HseLiveRiskViewModel {
  const stickyRef = useRef<Map<string, StickyEntry>>(new Map());
  const anchorRef = useRef<Map<string, RiskAnchorEntry>>(new Map());

  return useMemo(() => {
    const base = buildHseLiveRiskViewModel(input);
    const now = input.nowMs;
    const sticky = stickyRef.current;
    const anchors = anchorRef.current;

    // ── Risk-anchor memory ────────────────────────────────────────────────
    // 1. Update anchors for every grouped risk that currently has a fresh
    //    YOLO link (linked by id or by the pure builder's spatial pass).
    const groupedThisFrame = new Set<string>();
    const dispositions = new Map<
      string,
      { disposition: NonNullable<HseGroupedRisk["anchorDisposition"]>; reason: string }
    >();

    for (const g of base.priorityRisks) {
      groupedThisFrame.add(g.key);
      const ent = findLinkedEntity(g, base.overlayEntities);
      if (ent && ent.bbox) {
        const next = upsertAnchorOnLink({
          prev: anchors.get(g.key),
          anchorKey: g.key,
          hazardType: g.hazardType,
          level: g.level,
          currentEntity: ent,
          nowMs: now,
        });
        if (next) {
          anchors.set(g.key, next);
          dispositions.set(g.key, {
            disposition: "linked",
            reason: anchorReasonFor(next),
          });
        }
      }
    }

    // 2. For every anchor NOT freshly linked this frame, try to rebind to a
    //    current YOLO entity; otherwise carry/stale; otherwise expire.
    const carriedExtras: BackendEntity[] = [];
    for (const [key, entry] of [...anchors.entries()]) {
      if (dispositions.has(key)) continue;
      const {
        entry: next,
        expired,
        rebound,
      } = advanceAnchor({
        entry,
        currentEntities: base.overlayEntities,
        nowMs: now,
        caps: DEFAULT_ANCHOR_CAPS,
      });
      if (expired) {
        anchors.delete(key);
        continue;
      }
      anchors.set(key, next);
      dispositions.set(key, {
        disposition: next.disposition,
        reason: anchorReasonFor(next),
      });
      if (rebound) continue; // overlay already has the current entity
      // No current match — render a dashed/stale synthetic box at lastBbox,
      // but only when the grouped risk is also still present this frame OR
      // we're still inside the sticky window after losing it.
      if (groupedThisFrame.has(key) || next.disposition === "sticky-carried") {
        carriedExtras.push(staleOverlayEntityFor(next));
      } else if (next.disposition === "stale") {
        carriedExtras.push(staleOverlayEntityFor(next));
      }
    }

    // 3. Patch priority/grouped risks with the disposition diagnostics.
    const patchDisposition = (g: HseGroupedRisk): HseGroupedRisk => {
      const d = dispositions.get(g.key);
      if (!d) return g;
      return { ...g, anchorDisposition: d.disposition, anchorReason: d.reason };
    };
    const priorityRisks = base.priorityRisks.map(patchDisposition);
    const groupedRisks = base.groupedRisks.map(patchDisposition);

    // ── Box stickiness (legacy: minimum visible window) ──────────────────
    const seenKeys = new Set<string>();
    for (const g of priorityRisks) {
      const ent = base.overlayEntities.find((e) => {
        if (e.track_id && g.linkedTrackIds.includes(String(e.track_id))) return true;
        const eid = (e as unknown as { id?: string }).id;
        return typeof eid === "string" && g.linkedEntityIds.includes(eid);
      });
      if (!ent || !ent.bbox) continue;
      const key = g.key;
      seenKeys.add(key);
      const prev = sticky.get(key);
      sticky.set(key, {
        key,
        entity: ent,
        firstVisibleMs: prev?.firstVisibleMs ?? now,
        lastSeenMs: now,
        level: g.level,
        bbox: ent.bbox,
        resolving: g.resolving,
      });
    }

    for (const [key, entry] of [...sticky.entries()]) {
      const age = now - entry.firstVisibleMs;
      const sinceSeen = now - entry.lastSeenMs;
      const isYellow = riskLevelRank(entry.level) === riskLevelRank("YELLOW");
      const isRed = riskLevelRank(entry.level) >= riskLevelRank("RED");
      if (sinceSeen > 0) {
        if (entry.resolving && sinceSeen > YELLOW_RESOLVING_MS) {
          sticky.delete(key);
          continue;
        }
        if (isYellow && age > YELLOW_HARD_MAX_MS) {
          sticky.delete(key);
          continue;
        }
        if (isRed && sinceSeen > RED_STALE_MAX_MS) {
          sticky.delete(key);
          continue;
        }
        if (!isYellow && !isRed && sinceSeen > MIN_VISIBLE_RISK_MS) {
          sticky.delete(key);
          continue;
        }
      }
    }

    const overlayEntityIds = new Set(
      base.overlayEntities.map((e) => e.track_id ?? (e as unknown as { id?: string }).id ?? ""),
    );
    const extra: BackendEntity[] = [];
    for (const entry of sticky.values()) {
      const id = entry.entity.track_id ?? (entry.entity as unknown as { id?: string }).id ?? "";
      if (overlayEntityIds.has(id)) continue;
      if (
        now - entry.firstVisibleMs < MIN_VISIBLE_RISK_MS ||
        now - entry.lastSeenMs < MIN_VISIBLE_RISK_MS
      ) {
        extra.push(entry.entity);
      }
    }

    void seenKeys;
    return {
      ...base,
      priorityRisks,
      groupedRisks,
      overlayEntities: [...base.overlayEntities, ...extra, ...carriedExtras],
    };
  }, [input]);
}

/** Re-export grouped risk type for consumers. */
export type { HseGroupedRisk };
