import type { HSEDetectionProfile, HSEDetectRequest, HSERoi } from "./hseTypes";

/**
 * Phase 2 — monitoring detection profiles. Each profile maps to detect-request
 * quality (img size / confidence / cadence) plus optional ROI. The app sends
 * this metadata as OPTIONAL fields on the existing /detect body; a worker that
 * ignores them keeps working exactly as before (the contract is unchanged).
 */

export interface ProfileSpec {
  quality: HSEDetectRequest["quality"];
  /** Submit cadence ceiling (ms) — far-scan is slower, inspection slower still. */
  intervalMs: number;
  tasks: string[];
  label: string;
  hint: string;
}

export const HSE_PROFILES: Record<HSEDetectionProfile, ProfileSpec> = {
  fast: {
    quality: { imgSize: 640, conf: 0.25, iou: 0.45, maxDetections: 50 },
    intervalMs: 250,
    tasks: ["det"],
    label: "Fast",
    hint: "Low latency, fewer objects",
  },
  balanced: {
    quality: { imgSize: 704, conf: 0.18, iou: 0.45, maxDetections: 80 },
    intervalMs: 300,
    tasks: ["det", "pose"],
    label: "Balanced",
    hint: "Stable tracking (default)",
  },
  "far-scan": {
    quality: { imgSize: 960, conf: 0.12, iou: 0.5, maxDetections: 120 },
    intervalMs: 500,
    tasks: ["det"],
    label: "Far Scan",
    hint: "Distant objects, slower cadence",
  },
  inspection: {
    quality: { imgSize: 1024, conf: 0.1, iou: 0.5, maxDetections: 120 },
    intervalMs: 700,
    tasks: ["det", "pose"],
    label: "Inspection",
    hint: "Tap a region for a detailed scan",
  },
};

export const DEFAULT_HSE_PROFILE: HSEDetectionProfile = "balanced";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** Normalize/clamp an ROI; returns undefined for a degenerate region. */
export function normalizeRoi(roi?: Partial<HSERoi> | null): HSERoi | undefined {
  if (!roi || typeof roi.x !== "number" || typeof roi.y !== "number") return undefined;
  const x = clamp01(roi.x);
  const y = clamp01(roi.y);
  const w = clamp01(roi.w ?? 0);
  const h = clamp01(roi.h ?? 0);
  if (w < 0.05 || h < 0.05) return undefined;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/**
 * Build the optional HSE detect-request metadata for a profile (+ optional ROI).
 * Returned object is spread onto the /detect POST body alongside the existing
 * `image_b64` / `conf` / `img_size` fields.
 */
export function buildHseDetectRequest(
  profile: HSEDetectionProfile,
  roi?: Partial<HSERoi> | null,
  requestReason = "live-monitoring",
): HSEDetectRequest {
  const spec = HSE_PROFILES[profile] ?? HSE_PROFILES[DEFAULT_HSE_PROFILE];
  const normRoi = normalizeRoi(roi);
  return {
    mode: "hse-monitoring",
    profile,
    tasks: spec.tasks,
    quality: spec.quality,
    ...(normRoi ? { roi: normRoi } : {}),
    requestReason,
  };
}

/**
 * Neutral, scene-first HSE monitoring context attached to the /detect body when
 * monitoring mode is active. Replaces any older edge-biased `allowed_hazard_focus`
 * wording. The Cloudflare worker forwards these fields verbatim to the reasoner;
 * a worker that ignores them keeps working exactly as before.
 *
 * Goals:
 *  - Qwen reasons from the visible frame first, not a hazard template.
 *  - Qwen may say "no active scene risk" instead of inventing one.
 *  - Cached risk must be re-verified against the current frame.
 */
export const NEUTRAL_HSE_SITE_CONTEXT = {
  environment_type: "indoor",
  mode: "live_hse_monitoring",
  reasoning_policy: {
    report_only_visible_supported_risks: true,
    allow_no_risk_result: true,
    prefer_scene_observation_over_hazard_template: true,
    require_visual_evidence_for_scene_risk: true,
    avoid_assuming_edge_risk_from_object_presence: true,
  },
  monitoring_focus: [
    "visible slip/trip hazards",
    "falling-object potential",
    "blocked path",
    "broken object",
    "unsafe human-object interaction",
    "visible PPE concern",
    "vehicle/person proximity when visible",
  ],
} as const;

export const NEUTRAL_HSE_REASONING_PREFERENCES = {
  force_reason: false,
  prefer_low_latency: true,
  target_reasoning_interval_ms: 1500,
  max_candidate_age_ms: 1500,
  require_visual_evidence: true,
  allow_no_active_risk: true,
  avoid_repeating_unconfirmed_risks: true,
  verify_current_frame_before_reusing_cached_risk: true,
} as const;

/**
 * Merge the HSE request metadata into a base /detect body. The base fields stay
 * (back-compat); profile-derived `conf`/`img_size` override the defaults so the
 * worker that DOES read top-level conf/img_size also benefits. Neutral
 * `site_context` and `reasoning_preferences` are attached when monitoring is
 * active so the worker/Qwen reasoner is not biased toward edge/danger templates.
 */
export function applyHseRequestToBody(
  base: Record<string, unknown>,
  req: HSEDetectRequest | null,
): Record<string, unknown> {
  if (!req) return base;
  return {
    ...base,
    conf: req.quality.conf,
    img_size: req.quality.imgSize,
    mode: req.mode,
    profile: req.profile,
    tasks: req.tasks,
    quality: req.quality,
    ...(req.roi ? { roi: req.roi } : {}),
    requestReason: req.requestReason,
    site_context: NEUTRAL_HSE_SITE_CONTEXT,
    reasoning_preferences: NEUTRAL_HSE_REASONING_PREFERENCES,
  };
}
