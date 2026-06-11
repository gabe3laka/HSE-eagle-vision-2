import type {
  HSEAlertCandidate,
  HSEAlertCategory,
  HSEDetectionProfile,
  HSEObservation,
  HSEReasonedAlert,
  HSEReasoningOverlay,
  HSERiskReasoningPayload,
  HSERiskReasoningResponse,
  HSESeverity,
  HSETrack,
} from "@/lib/detection/hseTypes";
import type { DetectionZone } from "@/lib/detection/types";

/**
 * Phase 5 (app side) — pure helpers for HSE DeepSeek reasoning:
 *   payload  ← buildHseReasoningPayload()  (compact, image-free)
 *   response ← validateHseReasoning()      (strict parse + clamp 0..1)
 *   fallback ← buildHseRulesReasoning()    (local rules → same shape)
 * The browser never calls DeepSeek directly (see hseRiskReasoningClient).
 */

const SEVERITIES = new Set<HSESeverity>(["info", "low", "medium", "high", "critical"]);
const CATEGORIES = new Set<HSEAlertCategory>([
  "proximity",
  "ppe",
  "zone",
  "ergonomics",
  "trip-slip",
  "fire-safety",
  "blocked-access",
  "unknown-review",
]);
const OVERLAY_TYPES = new Set<HSEReasoningOverlay["type"]>([
  "box",
  "arrow",
  "zone",
  "ring",
  "label",
]);
const WEARABLE = new Set(["none", "soft-tap", "double-tap", "urgent-pulse", "continuous-critical"]);
const SEV_RANK: Record<HSESeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function clamp01(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}
function str(v: unknown, f = ""): string {
  return typeof v === "string" ? v : f;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function sev(v: unknown): HSESeverity {
  return SEVERITIES.has(v as HSESeverity) ? (v as HSESeverity) : "info";
}
function clampPoint(p: unknown): { x: number; y: number } | undefined {
  if (!p || typeof p !== "object") return undefined;
  const o = p as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number") return undefined;
  return { x: clamp01(o.x), y: clamp01(o.y) };
}

function validateOverlay(v: unknown): HSEReasoningOverlay | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!OVERLAY_TYPES.has(o.type as HSEReasoningOverlay["type"])) return undefined;
  return {
    type: o.type as HSEReasoningOverlay["type"],
    x: o.x != null ? clamp01(o.x) : undefined,
    y: o.y != null ? clamp01(o.y) : undefined,
    w: o.w != null ? clamp01(o.w) : undefined,
    h: o.h != null ? clamp01(o.h) : undefined,
    from: clampPoint(o.from),
    to: clampPoint(o.to),
    label: str(o.label) || undefined,
  };
}

/**
 * Strictly validate + clamp a raw HSE reasoning result. Coordinates clamp to
 * 0..1, unknown enums coerce to safe defaults, alerts without a message are
 * dropped, and a non-object returns null so the caller falls back to rules.
 */
export function validateHseReasoning(raw: unknown): HSERiskReasoningResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const alerts: HSEReasonedAlert[] = arr(r.alerts).flatMap((a, i) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    const shortMessage = str(o.shortMessage).trim() || str(o.title).trim();
    if (!shortMessage) return [];
    const category = CATEGORIES.has(o.category as HSEAlertCategory)
      ? (o.category as HSEAlertCategory)
      : "unknown-review";
    const wearablePattern = WEARABLE.has(o.wearablePattern as string)
      ? (o.wearablePattern as HSEReasonedAlert["wearablePattern"])
      : "none";
    return [
      {
        id: str(o.id) || `r-${i}`,
        severity: sev(o.severity),
        category,
        title: str(o.title) || shortMessage,
        shortMessage,
        spokenMessage: str(o.spokenMessage) || shortMessage,
        recommendedAction: str(o.recommendedAction),
        confidence: clamp01(o.confidence),
        relatedTrackIds: arr(o.relatedTrackIds)
          .map((t) => str(t))
          .filter(Boolean),
        overlay: validateOverlay(o.overlay),
        wearablePattern,
      },
    ];
  });

  const highest = alerts.reduce<HSESeverity>(
    (acc, a) => (SEV_RANK[a.severity] > SEV_RANK[acc] ? a.severity : acc),
    sev(r.highestSeverity),
  );

  return {
    status: r.status === "ok" ? "ok" : "fallback",
    source: r.source === "deepseek" ? "deepseek" : "rules",
    sceneCaption: str(r.sceneCaption),
    highestSeverity: highest,
    alerts: alerts.slice(0, 5),
    supervisorSummary: str(r.supervisorSummary),
    uncertainty: arr(r.uncertainty)
      .map((u) => str(u).trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}

/**
 * Build the compact, image-free reasoning payload from the current scene. Only
 * track/pose/zone summaries + the local candidate alerts — never a frame.
 */
export function buildHseReasoningPayload(opts: {
  tracks: HSETrack[];
  observations: HSEObservation[];
  zones?: DetectionZone[];
  candidates: HSEAlertCandidate[];
  profile: HSEDetectionProfile;
  wearableMode?: "phone" | "glasses" | "wristband";
  locationType?: string;
  maxAlerts?: number;
}): HSERiskReasoningPayload {
  return {
    mode: "hse-monitoring",
    cameraContext: {
      profile: opts.profile,
      wearableMode: opts.wearableMode ?? "phone",
      locationType: opts.locationType ?? "worksite",
    },
    sceneSummary: {
      objects: opts.tracks.slice(0, 16).map((t) => ({
        trackId: t.id,
        label: t.label,
        category: t.category,
        confidence: round2(t.confidence),
        bbox: t.bbox,
      })),
      poses: opts.observations
        .filter((o) => o.pose)
        .slice(0, 6)
        .map((o) => ({
          confidence: round2(o.confidence),
          keypointCount: o.pose?.keypoints.length ?? 0,
        })),
      zones: (opts.zones ?? []).map((z) => ({ label: z.label ?? "zone", kind: z.kind })),
      candidateAlerts: opts.candidates.slice(0, 6).map((c) => ({
        category: c.category,
        severity: c.severity,
        title: c.title,
        shortMessage: c.shortMessage,
        confidence: round2(c.confidence),
      })),
    },
    request: {
      output: "strict_json",
      maxAlerts: opts.maxAlerts ?? 3,
      prioritizeWearableAlert: true,
    },
  };
}

/**
 * Local rules fallback in the reasoning shape — built directly from the HSE
 * candidate alerts so the experience is identical when DeepSeek is unavailable.
 */
export function buildHseRulesReasoning(candidates: HSEAlertCandidate[]): HSERiskReasoningResponse {
  const alerts: HSEReasonedAlert[] = candidates.slice(0, 5).map((c) => ({
    id: c.id,
    severity: c.severity,
    category: c.category,
    title: c.title,
    shortMessage: c.shortMessage,
    spokenMessage: c.spokenMessage,
    recommendedAction: c.recommendedAction,
    confidence: c.confidence,
    relatedTrackIds: c.relatedTrackIds,
    overlay: c.bbox
      ? { type: "box", x: c.bbox.x, y: c.bbox.y, w: c.bbox.w, h: c.bbox.h }
      : undefined,
    wearablePattern: c.wearablePattern,
  }));
  const highest = alerts.reduce<HSESeverity>(
    (acc, a) => (SEV_RANK[a.severity] > SEV_RANK[acc] ? a.severity : acc),
    "info",
  );
  return {
    status: "fallback",
    source: "rules",
    sceneCaption: alerts.length ? "Local risk engine flagged hazards." : "Scene clear.",
    highestSeverity: highest,
    alerts,
    supervisorSummary: alerts.length
      ? `${alerts.length} hazard${alerts.length === 1 ? "" : "s"} flagged by the local risk engine.`
      : "No hazards flagged.",
    uncertainty: [],
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
