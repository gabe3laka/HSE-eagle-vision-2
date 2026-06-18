/**
 * HSE Live Risk View Model — the SINGLE selector that decides what the Live
 * HSE UI shows: which detection boxes to render, what color/label they get,
 * which risks land in the Priority Scene Risks list, and which Qwen-only
 * advisory candidates are surfaced.
 *
 * Pure (no React / DOM). Driven by worker/Qwen scene risks as the source of
 * truth — local alerts only feed the model when `localAlertsEnabled` is true.
 *
 * Used by: SceneRiskPanel, HseMonitoringPanel, BackendEntityOverlay,
 * BackendPoseOverlay, Live.tsx (HSE mode wiring).
 */

import type { BackendEntity, BackendPose } from "./types";
import type { RiskLevel, SceneRisk } from "./riskTypes";
import { normalizeRiskLevel, riskLevelRank } from "./riskTypes";
import type { ParsedDetectRisk } from "./backendVisionHttpDetector";
import type { HSEActiveAlert } from "./hseTypes";

/** Max grouped risks rendered in the Priority Scene Risks list. */
export const HSE_PRIORITY_RISK_LIMIT = 10;

/** How the overlays render boxes/poses. */
export type HseOverlayMode = "normal" | "hse-risk-only" | "debug";

/** Where a grouped risk originated. */
export type HseRiskSource = "Rules" | "Qwen" | "Rules + Qwen" | "Qwen Candidate" | "Local fallback";

/** A friendly, grouped risk row ready for rendering. */
export interface HseGroupedRisk {
  key: string;
  hazardType: string;
  hazardLabel: string;
  level: RiskLevel;
  source: HseRiskSource;
  why?: string;
  action?: string;
  linkedItem?: string;
  linkedTrackIds: string[];
  linkedEntityIds: string[];
  riskScore: number;
  active: boolean;
  resolving: boolean;
  acknowledged: boolean;
  lastSeenMs: number;
  raw: SceneRisk[];
}

/** Internal/debug-only view of every raw risk that fed the view model. */
export interface HseDebugRisk {
  key: string;
  level: RiskLevel | null;
  hazard?: string;
  reason: string;
  source: HseRiskSource;
  raw: SceneRisk;
}

/** Qwen-only candidate — never auto-rendered unless flags allow. */
export interface HseQwenCandidate {
  key: string;
  label: string;
  why?: string;
  level: RiskLevel | null;
  raw: SceneRisk;
}

/** Qwen / reasoner availability badge for the panel. */
export type HseReasonerBadge =
  | { state: "queued"; label: "Qwen: queued" }
  | { state: "running"; label: "Qwen: running" }
  | { state: "ready"; label: "Qwen: ready" }
  | { state: "unavailable"; label: "Qwen: unavailable — using rules only" }
  | { state: "error"; label: "Qwen: error — using rules only" }
  | { state: "disabled"; label: "Qwen: disabled" };

export interface BuildHseLiveRiskViewModelInput {
  entities: BackendEntity[];
  poses: BackendPose[];
  parsedRisk: ParsedDetectRisk | null;
  localActiveAlerts?: HSEActiveAlert[];
  nowMs: number;
  acknowledgedRiskKeys?: Set<string>;
  debug?: boolean;
  qwenCandidateLaneEnabled?: boolean;
  showQwenCandidates?: boolean;
  localAlertsEnabled?: boolean;
}

export interface HseLiveRiskViewModel {
  overlayEntities: BackendEntity[];
  overlayPoses: BackendPose[];
  priorityRisks: HseGroupedRisk[];
  groupedRisks: HseGroupedRisk[];
  debugRisks: HseDebugRisk[];
  qwenCandidates: HseQwenCandidate[];
  reasonerBadge: HseReasonerBadge;
  sceneContextLabel?: string;
  highestLevel: RiskLevel | null;
  rawRiskCount: number;
  groupedRiskCount: number;
  acknowledgedRiskCount: number;
  hiddenGroupedRiskCount: number;
  hiddenPoseReasons: string[];
  hasWorkerSceneRisks: boolean;
  shouldUseLocalFallback: boolean;
}

// ── Friendly labels ─────────────────────────────────────────────────────────

const HAZARD_LABELS: Record<string, string> = {
  object_near_edge: "Object near edge",
  unsafe_posture: "Unsafe posture",
  worker_near_vehicle: "Worker near vehicle",
  ppe_missing: "PPE missing",
  slip_trip: "Slip/trip risk",
  trip: "Trip hazard",
  spill: "Spill",
  falling_object: "Falling object",
  broken_object: "Broken object",
  blocked_path: "Blocked path",
  blocked_access: "Blocked access",
  fire_safety: "Fire safety",
  ergonomics: "Ergonomic risk",
};

export function friendlyHazardLabel(raw: string | undefined): string {
  if (!raw) return "Hazard";
  const k = raw.trim().toLowerCase();
  if (HAZARD_LABELS[k]) return HAZARD_LABELS[k];
  // Fallback: replace separators with spaces and capitalize.
  const spaced = k.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Item name helpers ───────────────────────────────────────────────────────

/** Best-effort item name for a backend entity. */
export function itemNameForEntity(e: BackendEntity): string {
  const record = e as unknown as Record<string, unknown>;
  const candidates = [
    (record.semantic_label as string | undefined) ?? undefined,
    typeof record.display_label === "string" ? (record.display_label as string) : undefined,
    e.label,
    typeof record.class_name === "string" ? (record.class_name as string) : undefined,
  ];
  const name = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  return (name ?? "").trim() || "detected item";
}

/**
 * Resolve the visible label for an entity box.
 * - hse-risk-only: ITEM NAME only — never risk words/stale/track ids.
 * - normal: existing behavior of the caller (returns null so the caller can
 *   keep its current label code path).
 * - debug: detailed label including risk + confidence.
 */
export function boxLabelForEntity(
  e: BackendEntity,
  riskAware: boolean,
  overlayMode: HseOverlayMode = "normal",
): string | null {
  if (overlayMode === "hse-risk-only") {
    return itemNameForEntity(e);
  }
  if (overlayMode === "debug") {
    const conf = Math.round((e.confidence ?? 0) * 100);
    const level = normalizeRiskLevel(e.risk_level, e.risk_color);
    const parts = [itemNameForEntity(e), `${conf}%`];
    if (level) parts.push(level);
    if (e.track_id) parts.push(`t${e.track_id}`);
    if (e.state) parts.push(e.state);
    return parts.join(" · ");
  }
  // normal: caller decides (return null so legacy label rendering wins).
  void riskAware;
  return null;
}

// ── Effective risk level ────────────────────────────────────────────────────

/**
 * Decide the "effective" visible risk level for an entity/risk pair.
 *
 * Rules:
 * - Never DOWNGRADE a linked YELLOW/ORANGE/RED scene risk to GREEN.
 * - `object_near_edge` is only promoted to visible YELLOW when there is real
 *   evidence (Qwen-confirmed, visual evidence, active/confirmed state,
 *   should_alert=true, or risk_score >= 4). Latent/generic edge risks alone
 *   never auto-paint YELLOW — caller decides whether to surface them in debug.
 * - Strong evidence on any hazard can promote to YELLOW.
 */
export function effectiveRiskLevel(input: {
  risk?: SceneRisk;
  entity?: BackendEntity;
  riskSummaryHighest?: RiskLevel | null;
  linkedSceneHighest?: RiskLevel | null;
}): RiskLevel | null {
  const linked =
    normalizeRiskLevel(input.linkedSceneHighest, undefined) ??
    normalizeRiskLevel(input.risk?.risk_level, input.risk?.risk_color);
  const entityLevel = normalizeRiskLevel(input.entity?.risk_level, input.entity?.risk_color);
  const candidates: (RiskLevel | null)[] = [linked, entityLevel];
  // Never downgrade a linked non-GREEN to GREEN.
  if (linked && riskLevelRank(linked) >= riskLevelRank("YELLOW")) {
    return linked;
  }

  // Special case object_near_edge: require evidence for YELLOW promotion.
  const risk = input.risk;
  const hazardKey = (risk?.hazard ?? "").toLowerCase();
  if (hazardKey === "object_near_edge") {
    const hasEvidence = !!(
      (risk?.visual_evidence && risk.visual_evidence.length > 0) ||
      (risk?.evidence && risk.evidence.length > 0) ||
      risk?.should_alert === true ||
      (typeof risk?.risk_score === "number" && risk.risk_score >= 4) ||
      risk?.produced_by === "vlm_reasoner" ||
      risk?.produced_by === "rules+vlm"
    );
    if (hasEvidence) {
      // Promote at least to YELLOW.
      const candidate = linked && riskLevelRank(linked) > 0 ? linked : ("YELLOW" as RiskLevel);
      return candidate;
    }
    // No evidence → keep weak/latent edge risks invisible (caller filters).
    return linked ?? null;
  }

  // Generic: pick the highest of the available candidates, fall back to summary.
  let best: RiskLevel | null = null;
  let bestRank = -1;
  for (const c of candidates) {
    const r = riskLevelRank(c);
    if (c && r > bestRank) {
      bestRank = r;
      best = c;
    }
  }
  if (!best && input.riskSummaryHighest) {
    return normalizeRiskLevel(input.riskSummaryHighest, undefined);
  }
  return best;
}

// ── Group key ──────────────────────────────────────────────────────────────

function groupKey(r: SceneRisk): string {
  if (r.risk_id) return `id:${r.risk_id}`;
  const sourceId = (r as Record<string, unknown>).source_risk_id;
  if (typeof sourceId === "string" && sourceId) return `src:${sourceId}`;
  const hazard = (r.hazard ?? "unknown").toLowerCase();
  const tracks =
    (r as Record<string, unknown>).involved_track_ids ?? (r.track_id ? [r.track_id] : undefined);
  if (Array.isArray(tracks) && tracks.length > 0) {
    return `${hazard}|t:${[...tracks].sort().join(",")}`;
  }
  const linkedEntity = (r as Record<string, unknown>).linked_entity_id;
  if (typeof linkedEntity === "string" && linkedEntity) {
    return `${hazard}|e:${linkedEntity}`;
  }
  const action = (r.recommended_action ?? "").toLowerCase();
  return `${hazard}|a:${action}`;
}

function sourceFromRisk(r: SceneRisk): HseRiskSource {
  const p = (r.produced_by ?? "").toLowerCase();
  if (p.includes("vlm") && p.includes("rules")) return "Rules + Qwen";
  if (p.includes("vlm") || p.includes("qwen")) return "Qwen";
  if (p.includes("rules")) return "Rules";
  if (p.includes("local")) return "Local fallback";
  return "Rules";
}

function rankSource(s: HseRiskSource): number {
  switch (s) {
    case "Rules + Qwen":
      return 3;
    case "Qwen":
      return 2;
    case "Rules":
      return 1;
    case "Local fallback":
      return 0;
    case "Qwen Candidate":
      return -1;
  }
}

/** Whether a single risk has real visual support. */
function hasVisualSupport(r: SceneRisk): boolean {
  if (r.should_alert === true) return true;
  if (r.visual_evidence && r.visual_evidence.length > 0) return true;
  if (r.evidence && r.evidence.length > 0) return true;
  if (typeof r.risk_score === "number" && r.risk_score >= 4) return true;
  if (r.produced_by && r.produced_by !== "rules") return true;
  return false;
}

/** A weak/generic latent edge risk that should NOT flood the priority list. */
function isWeakEdgeRisk(r: SceneRisk): boolean {
  const hazard = (r.hazard ?? "").toLowerCase();
  if (hazard !== "object_near_edge") return false;
  return !hasVisualSupport(r);
}

function reasonerBadge(parsedRisk: ParsedDetectRisk | null): HseReasonerBadge {
  if (!parsedRisk) return { state: "disabled", label: "Qwen: disabled" };
  const s = (parsedRisk.reasonerStatus ?? "").toLowerCase();
  if (s === "ok" || s === "ready") return { state: "ready", label: "Qwen: ready" };
  if (s === "running" || s === "in_progress") return { state: "running", label: "Qwen: running" };
  if (s === "queued" || s === "pending") return { state: "queued", label: "Qwen: queued" };
  if (s === "unavailable" || s === "timeout") {
    return { state: "unavailable", label: "Qwen: unavailable — using rules only" };
  }
  if (s === "schema_error" || s === "error") {
    return { state: "error", label: "Qwen: error — using rules only" };
  }
  if (s === "disabled" || s === "not_run") return { state: "disabled", label: "Qwen: disabled" };
  return { state: "ready", label: "Qwen: ready" };
}

// ── Pose filtering (HSE risk-only) ──────────────────────────────────────────

const POSE_MIN_KP_SCORE = 0.45;
const POSE_MIN_VISIBLE_KP = 8;
const PERSON_MIN_CONF = 0.45;

const STRUCTURAL_KEYPOINT_NAMES = new Set([
  "nose",
  "head",
  "left_shoulder",
  "right_shoulder",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "neck",
  "torso",
]);

function poseHasStructure(pose: BackendPose): { ok: boolean; reason?: string } {
  const kps = pose.keypoints ?? [];
  const visible = kps.filter((k) => k && k.score >= POSE_MIN_KP_SCORE);
  if (visible.length < POSE_MIN_VISIBLE_KP) {
    return { ok: false, reason: "too few high-confidence keypoints" };
  }
  // If keypoint names are present, require torso/head/lower-body structure.
  const named = visible.filter((k) => typeof k.name === "string" && k.name.length > 0);
  if (named.length > 0) {
    const present = new Set(named.map((k) => k.name.toLowerCase()));
    const hasShoulder = present.has("left_shoulder") || present.has("right_shoulder");
    const hasHip = present.has("left_hip") || present.has("right_hip");
    const hasHead = present.has("nose") || present.has("head");
    const handOnly = [...present].every((n) => n.includes("hand") || n.includes("finger"));
    if (handOnly) return { ok: false, reason: "hand-only pose dropped" };
    if (!hasShoulder || !hasHip || !hasHead) {
      const recognizable = [...present].some((n) => STRUCTURAL_KEYPOINT_NAMES.has(n));
      if (recognizable) {
        return { ok: false, reason: "missing torso/head/lower-body structure" };
      }
    }
  }
  return { ok: true };
}

function poseHasNearbyPerson(pose: BackendPose, entities: BackendEntity[]): boolean {
  // Centroid of pose keypoints.
  const kps = pose.keypoints ?? [];
  if (kps.length === 0) return false;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const k of kps) {
    if (k.score < POSE_MIN_KP_SCORE) continue;
    sx += k.x;
    sy += k.y;
    n += 1;
  }
  if (n === 0) return false;
  const cx = sx / n;
  const cy = sy / n;
  return entities.some((e) => {
    const lbl = (e.label ?? "").toLowerCase();
    if (!lbl.includes("person")) return false;
    if ((e.confidence ?? 0) < PERSON_MIN_CONF) return false;
    if (!e.bbox) return false;
    const { x, y, w, h } = e.bbox;
    return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
  });
}

// ── Main builder ────────────────────────────────────────────────────────────

export function buildHseLiveRiskViewModel(
  input: BuildHseLiveRiskViewModelInput,
): HseLiveRiskViewModel {
  const {
    entities,
    poses,
    parsedRisk,
    localActiveAlerts = [],
    acknowledgedRiskKeys = new Set<string>(),
    debug = false,
    qwenCandidateLaneEnabled = false,
    showQwenCandidates = false,
    localAlertsEnabled = false,
    nowMs,
  } = input;

  const rawRisks: SceneRisk[] = parsedRisk?.sceneRisks ?? [];
  const hasWorkerSceneRisks = rawRisks.length > 0;

  // Bucket risks: unlinked Qwen-only candidates go into qwenCandidates lane.
  const linkedRisks: SceneRisk[] = [];
  const qwenOnly: SceneRisk[] = [];
  for (const r of rawRisks) {
    const src = sourceFromRisk(r);
    const linked = !!(
      r.track_id ||
      (r as Record<string, unknown>).linked_entity_id ||
      (Array.isArray((r as Record<string, unknown>).involved_track_ids) &&
        ((r as Record<string, unknown>).involved_track_ids as unknown[]).length > 0)
    );
    if ((src === "Qwen" || src === "Rules + Qwen") && !linked) {
      qwenOnly.push(r);
    } else {
      linkedRisks.push(r);
    }
  }

  // Group linked risks.
  const buckets = new Map<string, SceneRisk[]>();
  for (const r of linkedRisks) {
    if (isWeakEdgeRisk(r) && !debug) continue; // weak/generic edge risks excluded
    const key = groupKey(r);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }

  const groupedAll: HseGroupedRisk[] = [];
  for (const [key, arr] of buckets) {
    // Choose the strongest representative.
    arr.sort((a, b) => {
      const la = riskLevelRank(normalizeRiskLevel(a.risk_level, a.risk_color));
      const lb = riskLevelRank(normalizeRiskLevel(b.risk_level, b.risk_color));
      if (la !== lb) return lb - la;
      return (b.risk_score ?? 0) - (a.risk_score ?? 0);
    });
    const rep = arr[0];
    const level =
      effectiveRiskLevel({
        risk: rep,
        entity: undefined,
        riskSummaryHighest: parsedRisk?.riskSummary?.highest_level ?? null,
        linkedSceneHighest: normalizeRiskLevel(rep.risk_level, rep.risk_color),
      }) ?? "GREEN";
    // Combine source over the bucket — Rules + Qwen wins when both present.
    const sources = new Set(arr.map(sourceFromRisk));
    const source: HseRiskSource = sources.has("Rules + Qwen")
      ? "Rules + Qwen"
      : sources.has("Qwen") && sources.has("Rules")
        ? "Rules + Qwen"
        : sources.has("Qwen")
          ? "Qwen"
          : sources.has("Rules")
            ? "Rules"
            : "Local fallback";

    const linkedTracks = new Set<string>();
    const linkedEntities = new Set<string>();
    for (const r of arr) {
      if (r.track_id) linkedTracks.add(r.track_id);
      const it = (r as Record<string, unknown>).involved_track_ids;
      if (Array.isArray(it)) for (const t of it) if (typeof t === "string") linkedTracks.add(t);
      const le = (r as Record<string, unknown>).linked_entity_id;
      if (typeof le === "string") linkedEntities.add(le);
    }

    const linkedItem = [...linkedEntities, ...linkedTracks]
      .map((id) =>
        entities.find((e) => e.track_id === id || (e as unknown as { id?: string }).id === id),
      )
      .find((e) => e)?.label;

    const state = (rep as Record<string, unknown>).risk_state;
    const stateStr = typeof state === "string" ? state.toLowerCase() : "";
    const resolving = stateStr === "resolving" || stateStr === "stale";
    const active = stateStr === "" || stateStr === "active" || stateStr === "confirmed";

    groupedAll.push({
      key,
      hazardType: rep.hazard ?? "unknown",
      hazardLabel: friendlyHazardLabel(rep.hazard),
      level,
      source,
      why: rep.risk_reason,
      action: rep.recommended_action,
      linkedItem,
      linkedTrackIds: [...linkedTracks],
      linkedEntityIds: [...linkedEntities],
      riskScore: rep.risk_score ?? 0,
      active,
      resolving,
      acknowledged: acknowledgedRiskKeys.has(key),
      lastSeenMs: nowMs,
      raw: arr,
    });
  }

  // Optional: local fallback when there are NO worker scene risks and the flag
  // is on. Maps local alerts onto grouped risks so the panel can still render.
  const shouldUseLocalFallback = !hasWorkerSceneRisks && localAlertsEnabled;
  if (shouldUseLocalFallback) {
    for (const a of localActiveAlerts) {
      if (a.state === "resolved") continue;
      const sev = a.severity;
      const level: RiskLevel =
        sev === "critical"
          ? "RED"
          : sev === "high"
            ? "ORANGE"
            : sev === "medium"
              ? "YELLOW"
              : "GREEN";
      groupedAll.push({
        key: `local:${a.key}`,
        hazardType: a.category,
        hazardLabel: friendlyHazardLabel(a.category),
        level,
        source: "Local fallback",
        why: a.spokenMessage,
        action: a.recommendedAction,
        linkedItem: undefined,
        linkedTrackIds: a.relatedTrackIds ?? [],
        linkedEntityIds: [],
        riskScore: Math.round((a.confidence ?? 0) * 10),
        active: a.state !== "acknowledged",
        resolving: false,
        acknowledged: a.state === "acknowledged",
        lastSeenMs: a.lastSeenMs ?? nowMs,
        raw: [],
      });
    }
  }

  // Rank: RED first → YELLOW; active before stale; non-resolving first;
  // Rules+Qwen → Qwen → Rules; higher risk_score; more linked items; newer.
  groupedAll.sort((a, b) => {
    const lr = riskLevelRank(b.level) - riskLevelRank(a.level);
    if (lr !== 0) return lr;
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.resolving !== b.resolving) return a.resolving ? 1 : -1;
    const sr = rankSource(b.source) - rankSource(a.source);
    if (sr !== 0) return sr;
    if (a.riskScore !== b.riskScore) return b.riskScore - a.riskScore;
    const lc = b.linkedTrackIds.length - a.linkedTrackIds.length;
    if (lc !== 0) return lc;
    return b.lastSeenMs - a.lastSeenMs;
  });

  const visibleGrouped = groupedAll.filter(
    (g) => riskLevelRank(g.level) >= riskLevelRank("YELLOW"),
  );
  const priorityRisks = visibleGrouped.slice(0, HSE_PRIORITY_RISK_LIMIT);
  const hiddenGroupedRiskCount = Math.max(0, visibleGrouped.length - priorityRisks.length);

  // Overlay entities: only those tied to a visible YELLOW+ risk.
  const visibleEntityIds = new Set<string>();
  const visibleTrackIds = new Set<string>();
  for (const g of visibleGrouped) {
    for (const id of g.linkedEntityIds) visibleEntityIds.add(id);
    for (const t of g.linkedTrackIds) visibleTrackIds.add(t);
  }
  const overlayEntities = entities.filter((e) => {
    if (e.track_id && visibleTrackIds.has(e.track_id)) return true;
    const id = (e as unknown as { id?: string }).id;
    if (typeof id === "string" && visibleEntityIds.has(id)) return true;
    const entLevel = normalizeRiskLevel(e.risk_level, e.risk_color);
    if (entLevel && riskLevelRank(entLevel) >= riskLevelRank("YELLOW")) return true;
    return false;
  });

  // Overlay poses: pose filtering rules.
  const hiddenPoseReasons: string[] = [];
  const overlayPoses: BackendPose[] = [];
  for (const p of poses) {
    const structure = poseHasStructure(p);
    if (!structure.ok) {
      if (structure.reason) hiddenPoseReasons.push(structure.reason);
      continue;
    }
    if (!poseHasNearbyPerson(p, entities)) {
      hiddenPoseReasons.push("no nearby person entity");
      continue;
    }
    overlayPoses.push(p);
  }

  // Qwen advisory lane.
  const qwenCandidates: HseQwenCandidate[] = qwenCandidateLaneEnabled
    ? qwenOnly.map((r, i) => ({
        key: r.risk_id ?? `qwen-${i}`,
        label: friendlyHazardLabel(r.hazard),
        why: r.risk_reason,
        level: normalizeRiskLevel(r.risk_level, r.risk_color),
        raw: r,
      }))
    : [];
  void showQwenCandidates; // surfaced via flag at render-time

  const debugRisks: HseDebugRisk[] = debug
    ? rawRisks.map((r) => ({
        key: groupKey(r),
        level: normalizeRiskLevel(r.risk_level, r.risk_color),
        hazard: r.hazard,
        reason: r.risk_reason ?? "",
        source: sourceFromRisk(r),
        raw: r,
      }))
    : [];

  const highestLevel = priorityRisks[0]?.level ?? null;
  const acknowledgedRiskCount = groupedAll.filter((g) => g.acknowledged).length;

  return {
    overlayEntities,
    overlayPoses,
    priorityRisks,
    groupedRisks: visibleGrouped,
    debugRisks,
    qwenCandidates,
    reasonerBadge: reasonerBadge(parsedRisk),
    sceneContextLabel: undefined,
    highestLevel,
    rawRiskCount: rawRisks.length,
    groupedRiskCount: visibleGrouped.length,
    acknowledgedRiskCount,
    hiddenGroupedRiskCount,
    hiddenPoseReasons,
    hasWorkerSceneRisks,
    shouldUseLocalFallback,
  };
}
