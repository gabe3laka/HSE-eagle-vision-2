/**
 * Risk-aware detection types + PURE helpers (additive, backward-compatible).
 *
 * These describe the OPTIONAL risk fields a newer Cloudflare `/detect` worker
 * may add to its response (schema_version, risk_engine, tracks, scene_graph,
 * risks/scene_risks, risk_summary, degradation, reasoner provenance, …). Every
 * field is optional: old worker responses that omit them keep rendering as plain
 * detections, and an unknown `schema_version` never breaks parsing.
 *
 * The helpers here are intentionally pure (no React, no DOM) so they're unit
 * testable in the node test env and reusable by both the detector and the UI.
 */

export type RiskLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED" | string;

export type RecommendedControl = { level?: string; action: string };

export type RiskSummary = {
  highest_level?: RiskLevel;
  total?: number;
  alerting_count?: number;
  by_level?: Record<string, number>;
};

export type SceneRisk = {
  risk_id?: string;
  track_id?: string;
  hazard?: string;
  risk_level?: RiskLevel;
  risk_color?: string;
  risk_score?: number;
  severity?: number;
  likelihood?: number;
  risk_reason?: string;
  evidence?: string[];
  visual_evidence?: string[];
  recommended_action?: string;
  recommended_controls?: RecommendedControl[];
  produced_by?: string;
  risk_matrix_version?: string;
  should_alert?: boolean;
  requires_human_review?: boolean;
  reasoner_model?: string;
  reasoner_status?: "not_run" | "ok" | "timeout" | "unavailable" | "schema_error" | string;
  confidence?: number;
};

/**
 * The OPTIONAL risk-aware fields layered on top of the existing `/detect`
 * response. All optional — when absent the response renders exactly as before.
 */
export interface RiskAwareFields {
  schema_version?: string | number;
  risk_engine?: string;
  tracks?: unknown;
  scene_graph?: unknown;
  risks?: SceneRisk[];
  scene_risks?: SceneRisk[];
  risk_summary?: RiskSummary;
  risk_enabled?: boolean;
  tracking_enabled?: boolean;
  scene_graph_enabled?: boolean;
  degraded?: boolean;
  degradation_mode?: string;
  reasoner_status?: string;
  stage_timings_ms?: Record<string, number>;
  privacy_blur_applied?: boolean;
  warnings?: string[];
}

// ── PURE helpers ─────────────────────────────────────────────────────────────

const RISK_LEVEL_RANK: Record<string, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

/** Normalize a worker-supplied risk level/color to a canonical RiskLevel.
 *  Returns null when nothing recognisable is present. */
export function normalizeRiskLevel(level?: unknown, color?: unknown): RiskLevel | null {
  const fromLevel = typeof level === "string" ? level.trim().toUpperCase() : "";
  if (fromLevel in RISK_LEVEL_RANK) return fromLevel as RiskLevel;
  const fromColor = typeof color === "string" ? color.trim().toUpperCase() : "";
  if (fromColor in RISK_LEVEL_RANK) return fromColor as RiskLevel;
  // amber → yellow alias sometimes emitted by workers
  if (fromColor === "AMBER" || fromLevel === "AMBER") return "YELLOW";
  return null;
}

/** Rank a risk level for comparison (higher = more severe). Unknown → -1. */
export function riskLevelRank(level?: RiskLevel | null): number {
  if (!level) return -1;
  const r = RISK_LEVEL_RANK[String(level).toUpperCase()];
  return r == null ? -1 : r;
}

/** A CSS color for a risk level. Falls back to a neutral cyan for unknowns. */
export function riskLevelColor(level?: RiskLevel | null): string {
  switch (String(level ?? "").toUpperCase()) {
    case "RED":
      return "rgba(239,68,68,0.95)";
    case "ORANGE":
      return "rgba(249,115,22,0.95)";
    case "YELLOW":
      return "rgba(251,191,36,0.95)";
    case "GREEN":
      return "rgba(34,197,94,0.95)";
    default:
      return "rgba(34,211,238,0.85)";
  }
}

/** PURE: decide whether to show the "Monitoring degraded" banner. */
export function shouldShowDegradedBanner(resp: { degraded?: unknown } | null | undefined): boolean {
  return !!resp && resp.degraded === true;
}

/** PURE: decide the "AI draft — review required" label.
 *  True when the risk was produced by a VLM reasoner OR explicitly flagged for
 *  human review. */
export function isAiDraftReviewRequired(
  risk: { produced_by?: unknown; requires_human_review?: unknown } | null | undefined,
): boolean {
  if (!risk) return false;
  return risk.produced_by === "vlm_reasoner" || risk.requires_human_review === true;
}

/** PURE: a reasoner status that means the AI did not produce a usable result. */
export function isReasonerUnavailable(status?: unknown): boolean {
  return status === "timeout" || status === "unavailable" || status === "schema_error";
}

/**
 * PURE: decide whether a single risk should surface as an alert.
 * Only when `should_alert === true` OR the level is ORANGE/RED.
 */
export function shouldSurfaceRiskAlert(
  risk: { should_alert?: unknown; risk_level?: RiskLevel; risk_color?: string } | null | undefined,
): boolean {
  if (!risk) return false;
  if (risk.should_alert === true) return true;
  const level = normalizeRiskLevel(risk.risk_level, risk.risk_color);
  return level === "ORANGE" || level === "RED";
}

/**
 * PURE: given a list of scene risks, return the ones that should surface as
 * alerts, de-duplicated by `risk_id` (falling back to `track_id`). Risks without
 * any stable id are kept individually (never collapsed).
 */
export function gateRiskAlerts(risks: SceneRisk[] | null | undefined): SceneRisk[] {
  if (!Array.isArray(risks)) return [];
  const out: SceneRisk[] = [];
  const seen = new Set<string>();
  for (const r of risks) {
    if (!shouldSurfaceRiskAlert(r)) continue;
    const key = r.risk_id ?? r.track_id ?? null;
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}

/** PURE: the highest risk level present in a list of risks (or null). */
export function highestRiskLevel(risks: SceneRisk[] | null | undefined): RiskLevel | null {
  if (!Array.isArray(risks) || risks.length === 0) return null;
  let best: RiskLevel | null = null;
  let bestRank = -1;
  for (const r of risks) {
    const lvl = normalizeRiskLevel(r.risk_level, r.risk_color);
    const rank = riskLevelRank(lvl);
    if (rank > bestRank) {
      bestRank = rank;
      best = lvl;
    }
  }
  return best;
}
