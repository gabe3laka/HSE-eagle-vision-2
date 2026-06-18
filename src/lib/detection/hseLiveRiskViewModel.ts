/**
 * HSE Live Risk View Model — the SINGLE selector that decides what the Live
 * HSE UI shows: which detection boxes to render, what color/label they get,
 * which risks land in the Priority Scene Risks list, and which Qwen-only
 * advisory candidates are surfaced.
 *
 * Pure (no React / DOM). Driven by worker/Qwen scene risks as the source of
 * truth — local alerts only feed the model when `localAlertsEnabled` is true.
 */

import type { BackendEntity, BackendPose } from "./types";
import type { RiskBBox, RiskLevel, SceneRisk } from "./riskTypes";
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

export interface HseDebugRisk {
  key: string;
  level: RiskLevel | null;
  hazard?: string;
  reason: string;
  source: HseRiskSource;
  raw: SceneRisk;
}

export interface HseQwenCandidate {
  key: string;
  label: string;
  why?: string;
  level: RiskLevel | null;
  raw: SceneRisk;
}

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
  /** Convenient counts for camera chips ("Risk-linked boxes/poses"). */
  riskLinkedEntityCount: number;
  riskLinkedPoseCount: number;
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
  const spaced = k.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Item name helpers ───────────────────────────────────────────────────────

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
 * - normal: caller decides (returns null).
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
  void riskAware;
  return null;
}

// ── Effective risk level ────────────────────────────────────────────────────

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
  if (linked && riskLevelRank(linked) >= riskLevelRank("YELLOW")) {
    return linked;
  }

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
      const candidate = linked && riskLevelRank(linked) > 0 ? linked : ("YELLOW" as RiskLevel);
      return candidate;
    }
    return linked ?? null;
  }

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

// ── Wording fallback chain ──────────────────────────────────────────────────

export function pickRiskWhy(
  risk: SceneRisk,
  parsedRisk: ParsedDetectRisk | null = null,
): string | undefined {
  const r = risk as Record<string, unknown>;
  const candidates: (string | undefined)[] = [
    typeof risk.risk_reason === "string" ? risk.risk_reason : undefined,
    Array.isArray(risk.visual_evidence) ? risk.visual_evidence[0] : undefined,
    Array.isArray(risk.evidence) ? risk.evidence[0] : undefined,
    typeof risk.trigger_condition === "string" ? risk.trigger_condition : undefined,
    typeof risk.observation === "string" ? risk.observation : undefined,
    typeof risk.description === "string" ? risk.description : undefined,
    typeof r.scene_summary === "string" ? (r.scene_summary as string) : undefined,
    parsedRisk?.sceneContext?.summary,
    parsedRisk?.sceneContext?.scene_summary,
    parsedRisk?.semanticCorrections?.[0]?.explanation,
  ];
  return candidates.find((s) => typeof s === "string" && s.trim().length > 0);
}

export function pickRiskAction(risk: SceneRisk): string | undefined {
  const candidates: (string | undefined)[] = [
    typeof risk.recommended_action === "string" ? risk.recommended_action : undefined,
    Array.isArray(risk.recommended_controls) && risk.recommended_controls.length > 0
      ? risk.recommended_controls[0]?.action
      : undefined,
    typeof risk.primary_action === "string" ? risk.primary_action : undefined,
    typeof risk.next_action === "string" ? risk.next_action : undefined,
    typeof risk.control_recommendation === "string" ? risk.control_recommendation : undefined,
  ];
  return candidates.find((s) => typeof s === "string" && s.trim().length > 0);
}

// ── Risk-to-entity linking ──────────────────────────────────────────────────

/** Extract a spatial region (0..1) from a worker scene risk, if present. */
export function riskRegionFor(risk: SceneRisk): RiskBBox | null {
  const r = risk as Record<string, unknown>;
  const candidates: unknown[] = [
    risk.bbox,
    risk.box,
    risk.approximate_region,
    risk.region,
    risk.visual_region,
    risk.location_box,
    r.location,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const x = numOr(o.x);
    const y = numOr(o.y);
    const w = numOr(o.w ?? o.width);
    const h = numOr(o.h ?? o.height);
    if (x == null || y == null || w == null || h == null) continue;
    if (w <= 0 || h <= 0) continue;
    return { x, y, w, h };
  }
  return null;
}

function numOr(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Whether a risk and entity share any id (track, entity, detection, source/linked risk). */
export function entityMatchesRiskIds(risk: SceneRisk, entity: BackendEntity): boolean {
  const e = entity as unknown as Record<string, unknown>;
  const entityIds = new Set<string>();
  for (const key of ["id", "entity_id", "detection_id", "linked_risk_id"]) {
    const v = e[key];
    if (typeof v === "string" && v) entityIds.add(v);
  }
  if (entity.track_id) entityIds.add(String(entity.track_id));

  const riskEntityIds: (string | undefined)[] = [
    risk.linked_entity_id,
    risk.entity_id,
    risk.detection_id,
    risk.source_risk_id,
    risk.linked_risk_id,
  ];
  for (const id of riskEntityIds) {
    if (typeof id === "string" && id && entityIds.has(id)) return true;
  }
  const riskTracks: string[] = [];
  if (risk.track_id) riskTracks.push(String(risk.track_id));
  if (Array.isArray(risk.involved_track_ids)) {
    for (const t of risk.involved_track_ids) if (typeof t === "string") riskTracks.push(t);
  }
  if (entity.track_id) {
    if (riskTracks.includes(String(entity.track_id))) return true;
  }
  return false;
}

function bboxIoU(a: RiskBBox, b: RiskBBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function centerDistance(a: RiskBBox, b: RiskBBox): number {
  const cax = a.x + a.w / 2;
  const cay = a.y + a.h / 2;
  const cbx = b.x + b.w / 2;
  const cby = b.y + b.h / 2;
  return Math.hypot(cax - cbx, cay - cby);
}

/** Best spatial match (IoU≥0.2 OR center-distance<0.12). null if none. */
export function spatialMatchRiskToEntity(
  risk: SceneRisk,
  entities: BackendEntity[],
): BackendEntity | null {
  const region = riskRegionFor(risk);
  if (!region) return null;
  let best: BackendEntity | null = null;
  let bestScore = -1;
  for (const e of entities) {
    if (!e.bbox) continue;
    const iou = bboxIoU(region, e.bbox);
    const d = centerDistance(region, e.bbox);
    if (iou < 0.2 && d > 0.12) continue;
    // Score: higher IoU is better; tiebreak by closer center.
    const score = iou + (1 - Math.min(1, d / 0.12)) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/**
 * Resolve all entities a risk should color. Priority:
 *   ids → spatial IoU/center → no match (empty array).
 */
export function linkedEntitiesForRisk(risk: SceneRisk, entities: BackendEntity[]): BackendEntity[] {
  const byId: BackendEntity[] = [];
  for (const e of entities) {
    if (entityMatchesRiskIds(risk, e)) byId.push(e);
  }
  if (byId.length > 0) return byId;
  const spatial = spatialMatchRiskToEntity(risk, entities);
  return spatial ? [spatial] : [];
}

// ── Misc ────────────────────────────────────────────────────────────────────

function groupKey(r: SceneRisk): string {
  if (r.risk_id) return `id:${r.risk_id}`;
  if (r.source_risk_id) return `src:${r.source_risk_id}`;
  const hazard = (r.hazard ?? "unknown").toLowerCase();
  const tracks = r.involved_track_ids ?? (r.track_id ? [String(r.track_id)] : undefined);
  if (Array.isArray(tracks) && tracks.length > 0) {
    return `${hazard}|t:${[...tracks].sort().join(",")}`;
  }
  if (r.linked_entity_id) return `${hazard}|e:${r.linked_entity_id}`;
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

/** Strong visual support test (Qwen-confirmed, real evidence, alerting, etc.). */
function hasVisualSupport(r: SceneRisk): boolean {
  if (r.should_alert === true) return true;
  if (Array.isArray(r.visual_evidence) && r.visual_evidence.length > 0) return true;
  if (Array.isArray(r.evidence) && r.evidence.length > 0) return true;
  if (typeof r.risk_score === "number" && r.risk_score >= 4) return true;
  if (r.produced_by && r.produced_by !== "rules") return true;
  const state = (r.risk_state ?? "").toLowerCase();
  if (state === "active" || state === "confirmed") return true;
  return false;
}

function isWeakEdgeRisk(r: SceneRisk): boolean {
  const hazard = (r.hazard ?? "").toLowerCase();
  if (hazard !== "object_near_edge") return false;
  return !hasVisualSupport(r);
}

/**
 * Qwen / reasoner badge. Strict: only explicit ready-class statuses become
 * "ready"; any unknown non-empty string is mapped to "unavailable" so the user
 * is never falsely told Qwen is healthy.
 */
function reasonerBadge(parsedRisk: ParsedDetectRisk | null): HseReasonerBadge {
  if (!parsedRisk) return { state: "disabled", label: "Qwen: disabled" };
  const raw = (parsedRisk.reasonerStatus ?? "").trim().toLowerCase();
  if (raw === "") return { state: "disabled", label: "Qwen: disabled" };
  if (["ready", "ok", "done", "completed", "success"].includes(raw)) {
    return { state: "ready", label: "Qwen: ready" };
  }
  if (["running", "busy", "processing", "in_progress"].includes(raw)) {
    return { state: "running", label: "Qwen: running" };
  }
  if (["queued", "pending", "scheduled"].includes(raw)) {
    return { state: "queued", label: "Qwen: queued" };
  }
  if (["disabled", "not_run"].includes(raw)) {
    return { state: "disabled", label: "Qwen: disabled" };
  }
  if (["unavailable", "timeout", "missing", "not_available"].includes(raw)) {
    return { state: "unavailable", label: "Qwen: unavailable — using rules only" };
  }
  if (["error", "schema_error"].includes(raw)) {
    return { state: "error", label: "Qwen: error — using rules only" };
  }
  // Unknown non-empty status → treat as unavailable, never as ready.
  return { state: "unavailable", label: "Qwen: unavailable — using rules only" };
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

export function poseHasStructure(pose: BackendPose): { ok: boolean; reason?: string } {
  const kps = pose.keypoints ?? [];
  const visible = kps.filter((k) => k && k.score >= POSE_MIN_KP_SCORE);
  if (visible.length < POSE_MIN_VISIBLE_KP) {
    return { ok: false, reason: "too few high-confidence keypoints" };
  }
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

/** Copy risk metadata onto a (shallow-cloned) entity for overlay rendering. */
function entityWithRisk(entity: BackendEntity, level: RiskLevel, risk: SceneRisk): BackendEntity {
  const clone: BackendEntity = { ...entity };
  clone.risk_level = level;
  if (risk.risk_color) clone.risk_color = risk.risk_color;
  if (typeof risk.risk_score === "number") clone.risk_score = risk.risk_score;
  if (typeof risk.risk_reason === "string") clone.risk_reason = risk.risk_reason;
  const action = pickRiskAction(risk);
  if (action) clone.recommended_action = action;
  if (typeof risk.produced_by === "string") clone.produced_by = risk.produced_by;
  if (risk.risk_id) {
    (clone as unknown as Record<string, unknown>).linked_risk_id = risk.risk_id;
  }
  return clone;
}

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

  // Pre-link every risk to its candidate entities so the overlay can paint
  // weak edge risks too, while the priority list keeps only strong ones.
  const linkMap = new Map<SceneRisk, BackendEntity[]>();
  for (const r of rawRisks) {
    linkMap.set(r, linkedEntitiesForRisk(r, entities));
  }

  // Bucket: unlinked Qwen-only candidates → qwenCandidates lane.
  const linkedRisks: SceneRisk[] = [];
  const qwenOnly: SceneRisk[] = [];
  for (const r of rawRisks) {
    const src = sourceFromRisk(r);
    const hasIdLink =
      !!r.track_id ||
      !!r.linked_entity_id ||
      (Array.isArray(r.involved_track_ids) && r.involved_track_ids.length > 0);
    const hasAnyLink = hasIdLink || (linkMap.get(r) ?? []).length > 0;
    if ((src === "Qwen" || src === "Rules + Qwen") && !hasAnyLink) {
      qwenOnly.push(r);
    } else {
      linkedRisks.push(r);
    }
  }

  // Group linked risks for the priority list. Weak edge risks are excluded
  // from priority but still allowed to paint linked boxes (see overlay below).
  const buckets = new Map<string, SceneRisk[]>();
  for (const r of linkedRisks) {
    if (isWeakEdgeRisk(r) && !debug) continue;
    const key = groupKey(r);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }

  const groupedAll: HseGroupedRisk[] = [];
  for (const [key, arr] of buckets) {
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
      if (r.track_id) linkedTracks.add(String(r.track_id));
      if (Array.isArray(r.involved_track_ids))
        for (const t of r.involved_track_ids) if (typeof t === "string") linkedTracks.add(t);
      if (r.linked_entity_id) linkedEntities.add(r.linked_entity_id);
      // Also pull ids from spatially-linked entities so overlay matching works.
      for (const e of linkMap.get(r) ?? []) {
        if (e.track_id) linkedTracks.add(String(e.track_id));
        const eid = (e as unknown as { id?: string }).id;
        if (typeof eid === "string") linkedEntities.add(eid);
      }
    }

    const linkedItem =
      [...linkedEntities, ...linkedTracks]
        .map((id) =>
          entities.find((e) => e.track_id === id || (e as unknown as { id?: string }).id === id),
        )
        .find((e) => e)?.label ??
      // Fall back to spatially-linked entity's label.
      linkMap.get(rep)?.[0]?.label;

    const stateStr = (rep.risk_state ?? "").toLowerCase();
    const resolving = stateStr === "resolving" || stateStr === "stale";
    const active = stateStr === "" || stateStr === "active" || stateStr === "confirmed";

    groupedAll.push({
      key,
      hazardType: rep.hazard ?? "unknown",
      hazardLabel: friendlyHazardLabel(rep.hazard),
      level,
      source,
      why: pickRiskWhy(rep, parsedRisk),
      action: pickRiskAction(rep),
      linkedItem: linkedItem
        ? itemNameForEntity({ label: linkedItem } as BackendEntity)
        : undefined,
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

  // Local fallback (only when explicitly enabled and no worker risks).
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

  // Overlay entities: paint every linked entity (priority + linked weak edge).
  // For each linked entity, copy effective risk metadata onto a clone.
  const overlayMap = new Map<string, BackendEntity>();
  const stampEntity = (e: BackendEntity, level: RiskLevel, risk: SceneRisk) => {
    const id =
      e.track_id ?? (e as unknown as { id?: string }).id ?? `${e.label}|${e.bbox?.x}|${e.bbox?.y}`;
    const existing = overlayMap.get(id);
    if (
      !existing ||
      riskLevelRank(level) >
        riskLevelRank(normalizeRiskLevel(existing.risk_level, existing.risk_color))
    ) {
      overlayMap.set(id, entityWithRisk(e, level, risk));
    }
  };

  // Pass 1: priority/grouped risks.
  for (const g of visibleGrouped) {
    for (const r of g.raw) {
      for (const e of linkMap.get(r) ?? []) {
        stampEntity(e, g.level, r);
      }
    }
  }
  // Pass 2: weak edge risks that ARE linked spatially get a YELLOW box but stay
  // out of the priority list. They never create haptics/incidents (UI-only).
  for (const r of rawRisks) {
    if (!isWeakEdgeRisk(r)) continue;
    const linkedByIds =
      !!r.track_id ||
      !!r.linked_entity_id ||
      (Array.isArray(r.involved_track_ids) && r.involved_track_ids.length > 0);
    const linked = linkMap.get(r) ?? [];
    if (!linkedByIds && linked.length === 0) continue;
    for (const e of linked) {
      stampEntity(e, "YELLOW", r);
    }
  }
  // Also include any entity that already carries its own YELLOW+ level from the
  // worker (defence in depth — never lose worker-painted boxes).
  for (const e of entities) {
    const lvl = normalizeRiskLevel(e.risk_level, e.risk_color);
    if (lvl && riskLevelRank(lvl) >= riskLevelRank("YELLOW")) {
      const id =
        e.track_id ??
        (e as unknown as { id?: string }).id ??
        `${e.label}|${e.bbox?.x}|${e.bbox?.y}`;
      if (!overlayMap.has(id)) overlayMap.set(id, { ...e });
    }
  }
  const overlayEntities = [...overlayMap.values()];

  // Overlay poses: only well-formed poses near a real person entity.
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

  const qwenCandidates: HseQwenCandidate[] = qwenCandidateLaneEnabled
    ? qwenOnly.map((r, i) => ({
        key: r.risk_id ?? `qwen-${i}`,
        label: friendlyHazardLabel(r.hazard),
        why: pickRiskWhy(r, parsedRisk),
        level: normalizeRiskLevel(r.risk_level, r.risk_color),
        raw: r,
      }))
    : [];
  void showQwenCandidates;

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
  const sceneContextLabel =
    parsedRisk?.sceneContext?.summary ?? parsedRisk?.sceneContext?.scene_summary;

  return {
    overlayEntities,
    overlayPoses,
    priorityRisks,
    groupedRisks: visibleGrouped,
    debugRisks,
    qwenCandidates,
    reasonerBadge: reasonerBadge(parsedRisk),
    sceneContextLabel: typeof sceneContextLabel === "string" ? sceneContextLabel : undefined,
    highestLevel,
    rawRiskCount: rawRisks.length,
    groupedRiskCount: visibleGrouped.length,
    acknowledgedRiskCount,
    hiddenGroupedRiskCount,
    hiddenPoseReasons,
    hasWorkerSceneRisks,
    shouldUseLocalFallback,
    riskLinkedEntityCount: overlayEntities.length,
    riskLinkedPoseCount: overlayPoses.length,
  };
}
