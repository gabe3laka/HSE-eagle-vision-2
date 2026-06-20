/**
 * Pure helpers to merge a Qwen-heartbeat ParsedDetectRisk into the live
 * detector ParsedDetectRisk without ever replacing the live detector entity
 * stream. The live detector loop remains the source of truth for current
 * entities/poses/segments — this helper only enriches the scene-reasoning
 * fields (sceneRisks, sceneContext, semanticCorrections, reasonerStatus,
 * temporalReasoning, warnings) the HSE view model consumes.
 */

import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type { SceneRisk } from "@/lib/detection/riskTypes";

/** Default freshness window for a heartbeat scene-reasoning result. */
export const HSE_QWEN_HEARTBEAT_RESULT_TTL_MS_DEFAULT = 8000;

/** PURE: true when the heartbeat result is recent enough to influence coloring. */
export function isHeartbeatFresh(
  receivedAtMs: number | null | undefined,
  ttlMs: number = HSE_QWEN_HEARTBEAT_RESULT_TTL_MS_DEFAULT,
  nowMs: number = Date.now(),
): boolean {
  if (receivedAtMs == null) return false;
  if (!Number.isFinite(receivedAtMs)) return false;
  return nowMs - receivedAtMs <= ttlMs;
}

/**
 * Reason a heartbeat result is NOT applied to box coloring. `null` = apply.
 * `"stale"` outside TTL, `"session-mismatch"` when heartbeat/live session ids
 * differ, `"frame-mismatch"` when the live detector has no entities right now.
 */
export type HeartbeatIgnoreReason = null | "stale" | "session-mismatch" | "frame-mismatch";

export function heartbeatIgnoreReason(args: {
  receivedAtMs: number | null;
  ttlMs?: number;
  nowMs?: number;
  heartbeatSessionId?: string | null;
  liveSessionId?: string | null;
  liveHasEntities: boolean;
}): HeartbeatIgnoreReason {
  const {
    receivedAtMs,
    ttlMs = HSE_QWEN_HEARTBEAT_RESULT_TTL_MS_DEFAULT,
    nowMs = Date.now(),
    heartbeatSessionId,
    liveSessionId,
    liveHasEntities,
  } = args;
  if (!isHeartbeatFresh(receivedAtMs, ttlMs, nowMs)) return "stale";
  if (heartbeatSessionId && liveSessionId && heartbeatSessionId !== liveSessionId) {
    return "session-mismatch";
  }
  if (!liveHasEntities) return "frame-mismatch";
  return null;
}

/** Human-readable diagnostic for the probe / dry-run verdict. */
export function heartbeatIgnoreMessage(reason: HeartbeatIgnoreReason): string | null {
  if (reason == null) return null;
  if (reason === "stale") return "Qwen heartbeat result received but ignored: stale";
  if (reason === "session-mismatch")
    return "Qwen heartbeat result received but ignored: session mismatch";
  // "frame-mismatch": live detector currently has no entities to color.
  return "Qwen heartbeat result received but ignored: no current detector entities";
}

function dedupKey(r: SceneRisk): string {
  if (typeof r.risk_id === "string" && r.risk_id) return `id:${r.risk_id}`;
  if (typeof r.source_risk_id === "string" && r.source_risk_id) return `src:${r.source_risk_id}`;
  const hazard = r.hazard_type ?? r.hazard ?? "unknown";
  const linked = Array.isArray(r.involved_detection_ids)
    ? [...r.involved_detection_ids].sort().join(",")
    : (r.linked_entity_id ?? r.entity_id ?? "");
  return `h:${hazard}|${linked}`;
}

export interface MergeParsedRiskOptions {
  /** When true, append heartbeat sceneRisks to the live set (deduped). Default true. */
  applyHeartbeatRisks?: boolean;
}

/**
 * PURE: merge a Qwen-heartbeat parsed risk into the live parsed risk. Live
 * remains primary for current detector state; heartbeat enriches scene
 * reasoning fields only. Caller decides freshness via `applyHeartbeatRisks`
 * (typically `isHeartbeatFresh(...)`).
 */
export function mergeParsedRisk(
  live: ParsedDetectRisk | null,
  heartbeat: ParsedDetectRisk | null,
  options: MergeParsedRiskOptions = {},
): ParsedDetectRisk | null {
  const { applyHeartbeatRisks = true } = options;
  if (!heartbeat) return live;
  const base: ParsedDetectRisk = live ?? {
    sceneRisks: [],
    degraded: false,
    warnings: [],
  };

  const merged: ParsedDetectRisk = {
    ...base,
    sceneRisks: [...base.sceneRisks],
    warnings: Array.from(new Set([...(base.warnings ?? []), ...(heartbeat.warnings ?? [])])),
  };

  if (applyHeartbeatRisks && heartbeat.sceneRisks.length > 0) {
    const seen = new Set<string>();
    const out: SceneRisk[] = [];
    for (const r of merged.sceneRisks) {
      const k = dedupKey(r);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    for (const r of heartbeat.sceneRisks) {
      const k = dedupKey(r);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    merged.sceneRisks = out;
  }

  // Diagnostics-only fields always flow through from heartbeat (badge/probe).
  if (heartbeat.reasonerStatus) merged.reasonerStatus = heartbeat.reasonerStatus;
  if (heartbeat.reasonerStatusRaw) merged.reasonerStatusRaw = heartbeat.reasonerStatusRaw;
  if (heartbeat.semanticCorrections && heartbeat.semanticCorrections.length > 0) {
    merged.semanticCorrections = heartbeat.semanticCorrections;
  }
  if (heartbeat.temporalReasoning !== undefined) {
    merged.temporalReasoning = heartbeat.temporalReasoning;
  }
  // Scene context: adopt heartbeat if live has none.
  if (!merged.sceneContext && heartbeat.sceneContext) {
    merged.sceneContext = heartbeat.sceneContext;
  }

  return merged;
}
