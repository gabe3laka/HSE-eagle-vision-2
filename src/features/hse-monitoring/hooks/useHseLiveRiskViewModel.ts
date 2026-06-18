/**
 * useHseLiveRiskViewModel — thin React wrapper around `buildHseLiveRiskViewModel`
 * that adds box-stickiness: linked risk boxes stay visible for a minimum window
 * so the overlay never flickers when a single frame loses the detection. Carries
 * a brief stale/dashed state when a risk disappears.
 *
 * Stores only metadata (risk key, level, bbox, timestamps) — no images.
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

export const MIN_VISIBLE_RISK_MS = 1000;
export const YELLOW_RESOLVING_MS = 500;
export const YELLOW_HARD_MAX_MS = 2000;
export const RED_STALE_MAX_MS = 4500;

interface StickyEntry {
  key: string;
  entity: BackendEntity;
  firstVisibleMs: number;
  lastSeenMs: number;
  level: RiskLevel;
  bbox: BackendEntity["bbox"];
  resolving: boolean;
}

export function useHseLiveRiskViewModel(input: BuildHseLiveRiskViewModelInput): HseLiveRiskViewModel {
  const stickyRef = useRef<Map<string, StickyEntry>>(new Map());

  return useMemo(() => {
    const base = buildHseLiveRiskViewModel(input);
    const now = input.nowMs;
    const sticky = stickyRef.current;

    // Refresh sticky entries from current overlay entities + grouped risks.
    const seenKeys = new Set<string>();
    for (const g of base.priorityRisks) {
      const ent = base.overlayEntities.find((e) => {
        if (e.track_id && g.linkedTrackIds.includes(e.track_id)) return true;
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

    // Expire sticky entries past their hard caps; keep recently-vanished ones
    // briefly as stale/dashed (we still expose them on overlayEntities).
    for (const [key, entry] of [...sticky.entries()]) {
      const age = now - entry.firstVisibleMs;
      const sinceSeen = now - entry.lastSeenMs;
      const isYellow = riskLevelRank(entry.level) === riskLevelRank("YELLOW");
      const isRed = riskLevelRank(entry.level) >= riskLevelRank("RED");
      if (sinceSeen > 0) {
        // Risk no longer present this frame.
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

    // Merge sticky entries back into overlayEntities so the box keeps showing
    // for at least MIN_VISIBLE_RISK_MS even if a single frame loses it.
    const overlayEntityIds = new Set(
      base.overlayEntities.map((e) => e.track_id ?? (e as { id?: string }).id ?? ""),
    );
    const extra: BackendEntity[] = [];
    for (const entry of sticky.values()) {
      const id = entry.entity.track_id ?? (entry.entity as { id?: string }).id ?? "";
      if (overlayEntityIds.has(id)) continue;
      // Only emit if still within minimum visible window.
      if (now - entry.firstVisibleMs < MIN_VISIBLE_RISK_MS || now - entry.lastSeenMs < MIN_VISIBLE_RISK_MS) {
        extra.push(entry.entity);
      }
    }

    void seenKeys;
    return {
      ...base,
      overlayEntities: [...base.overlayEntities, ...extra],
    };
  }, [input]);
}

/** Re-export grouped risk type for consumers. */
export type { HseGroupedRisk };
