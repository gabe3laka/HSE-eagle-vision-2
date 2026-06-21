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

/** Loose normalized bbox shape (0..1). */
export type RiskBBox = { x: number; y: number; w: number; h: number };

export type SceneRisk = {
  risk_id?: string;
  source_risk_id?: string;
  linked_risk_id?: string;
  track_id?: string;
  involved_track_ids?: string[];
  involved_detection_ids?: string[];
  linked_entity_id?: string;
  entity_id?: string;
  detection_id?: string;
  hazard?: string;
  /** Worker/reasoner may return `hazard_type` instead of `hazard`. */
  hazard_type?: string;
  risk_level?: RiskLevel;
  risk_color?: string;
  risk_score?: number;
  severity?: number;
  likelihood?: number;
  risk_reason?: string;
  evidence?: string[];
  visual_evidence?: string[];
  /** Free-text trigger/observation/description used as wording fallbacks. */
  trigger_condition?: string;
  observation?: string;
  description?: string;
  /** Optional spatial region for the risk (for app-side spatial linking). */
  bbox?: RiskBBox;
  box?: RiskBBox;
  approximate_region?: RiskBBox;
  region?: RiskBBox;
  visual_region?: RiskBBox;
  location_box?: RiskBBox;
  recommended_action?: string;
  recommended_controls?: RecommendedControl[];
  primary_action?: string;
  next_action?: string;
  control_recommendation?: string;
  produced_by?: string;
  risk_matrix_version?: string;
  should_alert?: boolean;
  requires_human_review?: boolean;
  reasoner_model?: string;
  reasoner_status?:
    | "not_run"
    | "ok"
    | "timeout"
    | "unavailable"
    | "schema_error"
    | "json_parse_error"
    | string;
  risk_state?: string;
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
  /** Top-level convenience field some workers emit alongside risk_summary. */
  highest_risk_level?: string;
  risk_enabled?: boolean;
  tracking_enabled?: boolean;
  scene_graph_enabled?: boolean;
  degraded?: boolean;
  degradation_mode?: string;
  /**
   * Worker may emit either a plain string ("ready") OR a structured object
   * such as `{ enabled: true, mode: "gemini", state: "ready" }` (legacy workers
   * used `mode: "qwen_vl"`). Both shapes are normalized via
   * `normalizeReasonerStatus`.
   */
  reasoner_status?:
    | string
    | ({ state?: unknown; status?: unknown; reasoner_status?: unknown } & Record<string, unknown>);
  stage_timings_ms?: Record<string, number>;
  privacy_blur_applied?: boolean;
  warnings?: string[];
  /** Additive: passed through verbatim to the panel/debug surfaces. */
  temporal_reasoning?: unknown;
  scene_context?: { summary?: string; scene_summary?: string } & Record<string, unknown>;
  semantic_corrections?: Array<{ explanation?: string } & Record<string, unknown>>;
}

/**
 * PURE: normalize a worker `reasoner_status` field. Accepts either a plain
 * string ("ready") or a structured object ({ state: "ready", ... }). Returns
 * the trimmed status token, or null when nothing usable is present.
 *
 * Only the state token is returned; the original object (if any) should be
 * preserved separately for diagnostics.
 */
export function normalizeReasonerStatus(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const state = record.state ?? record.status ?? record.reasoner_status;
    if (typeof state === "string" && state.trim()) return state.trim();
  }
  return null;
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
  return (
    status === "timeout" ||
    status === "unavailable" ||
    status === "schema_error" ||
    status === "json_parse_error" ||
    status === "error" ||
    status === "disabled"
  );
}

/**
 * PURE: a friendly display name for the worker's live scene reasoner. The worker
 * chooses the model and may report it via `model` / `model_id`; the app stays
 * model-agnostic. Returns "Gemini" / "Qwen" for known models, otherwise the
 * neutral "Reasoner". Never defaults to a specific vendor.
 */
export function reasonerDisplayName(raw?: Record<string, unknown> | null): string {
  const model = String(raw?.model ?? raw?.model_id ?? "").toLowerCase();
  if (model.includes("gemini")) return "Gemini";
  if (model.includes("qwen")) return "Qwen";
  return "Reasoner";
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
