import { useMemo, useRef } from "react";
import {
  buildHseLiveRiskViewModel,
  type BuildHseLiveRiskViewModelInput,
  type HseLiveRiskViewModel,
} from "@/lib/detection/hseLiveRiskViewModel";
import { riskLevelRank } from "@/lib/detection/riskTypes";
import type { BackendEntity } from "@/lib/detection/types";

export const MIN_VISIBLE_RISK_MS = 1000;
export const YELLOW_RESOLVING_MS = 500;
export const YELLOW_HARD_MAX_MS = 2000;
export const RED_STALE_MAX_MS = 4500;

export type HseRiskSmoothingEntry = {
  key: string;
  entity: BackendEntity;
  firstVisibleMs: number;
  lastSeenMs: number;
  level?: string;
};

export type HseRiskSmoothingCache = Map<string, HseRiskSmoothingEntry>;

function entitySmoothingKey(entity: BackendEntity, index: number): string {
  return (
    entity.linked_risk_id ??
    entity.id ??
    entity.detection_id ??
    entity.track_id ??
    `${entity.label}-${index}`
  );
}

function staleLimitMs(level?: string): number {
  switch (String(level ?? "").toUpperCase()) {
    case "RED":
      return RED_STALE_MAX_MS;
    case "YELLOW":
      return YELLOW_HARD_MAX_MS;
    default:
      return MIN_VISIBLE_RISK_MS;
  }
}

function shouldCarryMissing(entry: HseRiskSmoothingEntry, nowMs: number): boolean {
  const visibleFor = nowMs - entry.firstVisibleMs;
  const missingFor = nowMs - entry.lastSeenMs;
  if (visibleFor < MIN_VISIBLE_RISK_MS) return true;
  const level = String(entry.level ?? "").toUpperCase();
  if (level === "YELLOW")
    return missingFor <= YELLOW_RESOLVING_MS && visibleFor <= YELLOW_HARD_MAX_MS;
  if (level === "RED") return missingFor <= RED_STALE_MAX_MS;
  return false;
}

export function applyHseRiskSmoothing(
  model: HseLiveRiskViewModel,
  cache: HseRiskSmoothingCache,
  nowMs: number,
): HseLiveRiskViewModel {
  const currentKeys = new Set<string>();
  const currentEntities = model.overlayEntities.map((entity, index) => {
    const key = entitySmoothingKey(entity, index);
    currentKeys.add(key);
    const previous = cache.get(key);
    const firstVisibleMs = previous?.firstVisibleMs ?? nowMs;
    const next = { ...entity };
    cache.set(key, {
      key,
      entity: next,
      firstVisibleMs,
      lastSeenMs: nowMs,
      level: String(next.risk_level ?? previous?.level ?? ""),
    });
    return next;
  });

  for (const [key, entry] of [...cache.entries()]) {
    if (currentKeys.has(key)) continue;
    if (!shouldCarryMissing(entry, nowMs)) {
      cache.delete(key);
      continue;
    }
    const missingFor = nowMs - entry.lastSeenMs;
    const carried: BackendEntity = {
      ...entry.entity,
      risk_stale: true,
      risk_resolving:
        riskLevelRank(entry.level) <= riskLevelRank("YELLOW") && missingFor <= YELLOW_RESOLVING_MS,
    };
    currentEntities.push(carried);
    if (nowMs - entry.lastSeenMs > staleLimitMs(entry.level)) cache.delete(key);
  }

  return {
    ...model,
    overlayEntities: currentEntities,
  };
}

export function useHseLiveRiskViewModel(
  input: BuildHseLiveRiskViewModelInput,
): HseLiveRiskViewModel {
  const cacheRef = useRef<HseRiskSmoothingCache>(new Map());
  return useMemo(() => {
    const base = buildHseLiveRiskViewModel(input);
    return applyHseRiskSmoothing(base, cacheRef.current, input.nowMs);
  }, [
    input.entities,
    input.poses,
    input.parsedRisk,
    input.localActiveAlerts,
    input.nowMs,
    input.acknowledgedRiskKeys,
    input.debug,
    input.qwenCandidateLaneEnabled,
    input.showQwenCandidates,
    input.localAlertsEnabled,
  ]);
}
