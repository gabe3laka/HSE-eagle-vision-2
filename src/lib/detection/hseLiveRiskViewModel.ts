import type { ParsedDetectRisk } from "./backendVisionHttpDetector";
import { isPersonLabel } from "./hseEntityMapper";
import type { HSEActiveAlert, HSESeverity } from "./hseTypes";
import type { BackendEntity, BackendPose, BBox } from "./types";
import type { ReasonerStatus, RiskLevel, SceneRisk } from "./riskTypes";
import { normalizeRiskLevel, riskLevelRank } from "./riskTypes";

export const HSE_PRIORITY_RISK_LIMIT = 10;

export type HseOverlayMode = "normal" | "hse-risk-only" | "debug";
export type HseRiskSourceLabel =
  | "Rules"
  | "Qwen"
  | "Rules + Qwen"
  | "Qwen Candidate"
  | "Local fallback";

export type HseReasonerBadge = {
  label: string;
  state: "queued" | "running" | "ready" | "unavailable" | "error" | "disabled" | "idle";
  mode?: string;
  tone: "neutral" | "info" | "warning" | "error" | "success";
};

export type HsePriorityRisk = {
  key: string;
  title: string;
  level: RiskLevel;
  hazardType?: string;
  linkedLabels: string[];
  linkedTrackIds: string[];
  itemCount: number;
  reason?: string;
  primaryAction?: string;
  sourceLabel: HseRiskSourceLabel;
  isResolving?: boolean;
  isStale?: boolean;
  acknowledged?: boolean;
  highestRiskScore?: number;
  latestSeenMs?: number;
};

export type HseGroupedRisk = HsePriorityRisk & {
  risks: SceneRisk[];
};

export type HseDebugRisk = {
  key: string;
  risk: SceneRisk | HSEActiveAlert;
  sourceLabel: HseRiskSourceLabel;
  hidden?: boolean;
  reason?: string;
};

export type HseQwenCandidate = {
  key: string;
  title: string;
  level: RiskLevel;
  reason?: string;
  approximateRegion?: BBox;
  confidence?: number;
  matchedEntityId?: string;
  matchedTrackId?: string;
  status: "unlinked" | "matched" | "ignored" | "expired";
};

export type HseLiveRiskViewModel = {
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
};

export type BuildHseLiveRiskViewModelInput = {
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
};

const MIN_PERSON_CONFIDENCE = 0.45;
const MIN_HSE_POSE_KEYPOINT_SCORE = 0.45;
const MIN_HSE_POSE_KEYPOINTS = 8;
const FRAME_EDGE_MARGIN = 0.035;

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function clean(value?: string | null): string {
  return String(value ?? "").trim();
}

function lower(value?: string | null): string {
  return clean(value).toLowerCase();
}

function titleCaseToken(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function bboxTouchesFrameEdge(bbox: BBox): boolean {
  return (
    bbox.x <= FRAME_EDGE_MARGIN ||
    bbox.y <= FRAME_EDGE_MARGIN ||
    bbox.x + bbox.w >= 1 - FRAME_EDGE_MARGIN ||
    bbox.y + bbox.h >= 1 - FRAME_EDGE_MARGIN
  );
}

function isObjectNearEdgeRisk(risk: SceneRisk): boolean {
  return lower(riskHazard(risk)) === "object_near_edge";
}

function isQwenConfirmedRisk(risk: SceneRisk): boolean {
  return riskLooksQwen(risk);
}

function isActionableObjectNearEdgeEntity(risk: SceneRisk, entity: BackendEntity): boolean {
  if (!isObjectNearEdgeRisk(risk)) return true;
  if (isQwenConfirmedRisk(risk)) return true;
  return !bboxTouchesFrameEdge(entity.bbox);
}

export function formatHazardLabel(value?: string | null): string {
  const key = lower(value);
  const known: Record<string, string> = {
    object_near_edge: "Object near edge",
    unsafe_posture: "Unsafe posture",
    worker_near_vehicle: "Worker near vehicle",
    ppe_missing: "PPE missing",
    slip_trip: "Slip/trip risk",
    trip_slip: "Slip/trip risk",
    forklift_proximity: "Forklift proximity",
  };
  if (known[key]) return known[key];
  const text = key || "scene risk";
  return text
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}

function riskHazard(risk: SceneRisk): string | undefined {
  return risk.hazard_type ?? risk.hazard;
}

function riskReason(risk: SceneRisk): string | undefined {
  return (
    risk.risk_reason ?? risk.trigger_condition ?? risk.visual_evidence?.[0] ?? risk.evidence?.[0]
  );
}

function primaryAction(risk: SceneRisk): string | undefined {
  return (
    risk.recommended_action ??
    risk.recommended_controls?.find((control) => !!control.action)?.action
  );
}

function riskTrackIds(risk: SceneRisk): string[] {
  return unique([...(risk.involved_track_ids ?? []), risk.track_id]);
}

function riskDetectionIds(risk: SceneRisk): string[] {
  return unique([
    ...(risk.involved_detection_ids ?? []),
    risk.detection_id,
    risk.entity_id,
    risk.linked_entity_id,
  ]);
}

function entityIds(entity: BackendEntity): string[] {
  return unique([entity.id, entity.detection_id, entity.track_id, entity.linked_risk_id]);
}

function entityStableId(entity: BackendEntity, index: number): string {
  return entity.id ?? entity.detection_id ?? entity.track_id ?? `${entity.label}-${index}`;
}

function riskBaseKey(risk: SceneRisk, index: number): string {
  const tracks = riskTrackIds(risk).join(",");
  const detections = riskDetectionIds(risk).join(",");
  const hazard = riskHazard(risk);
  const action = primaryAction(risk);
  if (risk.risk_id) return `risk:${risk.risk_id}`;
  if (risk.source_risk_id) return `source:${risk.source_risk_id}`;
  if (hazard && tracks) return `hazard-tracks:${hazard}:${tracks}`;
  if (hazard && detections) return `hazard-entity:${hazard}:${detections}`;
  if (hazard && action) return `hazard-action:${hazard}:${action}`;
  return `risk-index:${hazard ?? "risk"}:${index}`;
}

function displayGroupKey(risk: SceneRisk, index: number): string {
  const hazard = riskHazard(risk) ?? "risk";
  const action = primaryAction(risk);
  const tracks = riskTrackIds(risk).join(",");
  const detections = riskDetectionIds(risk).join(",");
  if (lower(hazard) === "object_near_edge" && action) {
    return `hazard-action:${hazard}:${action}`;
  }
  if (hazard && tracks) return `hazard-tracks:${hazard}:${tracks}`;
  if (hazard && detections) return `hazard-entity:${hazard}:${detections}`;
  if (hazard && action) return `hazard-action:${hazard}:${action}`;
  return riskBaseKey(risk, index);
}

function acknowledgedKeyFor(
  hazardType: string | undefined,
  level: RiskLevel,
  linkedIds: string[],
  action?: string,
  riskIdentity?: string,
): string {
  return [
    hazardType ?? "risk",
    String(level).toUpperCase(),
    linkedIds.sort().join(","),
    action ?? "",
    riskIdentity ?? "",
  ]
    .map((part) => part.trim())
    .join("|");
}

function riskLooksQwen(risk: SceneRisk): boolean {
  const producedBy = lower(risk.produced_by);
  const model = lower(risk.reasoner_model);
  return producedBy.includes("vlm") || producedBy.includes("qwen") || model.includes("qwen");
}

export function sourceLabelForRisk(risk: SceneRisk, candidate = false): HseRiskSourceLabel {
  if (candidate) return "Qwen Candidate";
  if (riskLooksQwen(risk) && risk.source_risk_id) return "Rules + Qwen";
  if (riskLooksQwen(risk)) return "Qwen";
  return "Rules";
}

function sourcePriority(source: HseRiskSourceLabel): number {
  switch (source) {
    case "Rules + Qwen":
      return 3;
    case "Qwen":
      return 2;
    case "Rules":
      return 1;
    default:
      return 0;
  }
}

function numericRiskField(risk: SceneRisk, names: string[]): number | undefined {
  const record = risk as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function riskUpdatedMs(risk: SceneRisk, index = 0): number {
  return (
    numericRiskField(risk, [
      "last_seen_ms",
      "updated_at_ms",
      "last_updated_ms",
      "observed_at_ms",
      "timestamp_ms",
      "frame_id",
    ]) ?? -index
  );
}

function groupRiskScore(group: HseGroupedRisk): number {
  if (typeof group.highestRiskScore === "number" && Number.isFinite(group.highestRiskScore)) {
    return group.highestRiskScore;
  }
  return Math.max(0, ...group.risks.map((item) => item.risk_score ?? 0));
}

function groupUpdatedMs(group: HseGroupedRisk): number {
  if (typeof group.latestSeenMs === "number" && Number.isFinite(group.latestSeenMs)) {
    return group.latestSeenMs;
  }
  return Math.max(0, ...group.risks.map((item, index) => riskUpdatedMs(item, index)));
}

export function rankGroupedRisks(a: HseGroupedRisk, b: HseGroupedRisk): number {
  return (
    riskLevelRank(b.level) - riskLevelRank(a.level) ||
    Number(a.isStale === true) - Number(b.isStale === true) ||
    Number(a.isResolving === true) - Number(b.isResolving === true) ||
    sourcePriority(b.sourceLabel) - sourcePriority(a.sourceLabel) ||
    groupRiskScore(b) - groupRiskScore(a) ||
    b.itemCount - a.itemCount ||
    groupUpdatedMs(b) - groupUpdatedMs(a) ||
    a.title.localeCompare(b.title)
  );
}

export function formatReasonerBadge(status?: ReasonerStatus): HseReasonerBadge {
  if (status == null) return { label: "Qwen: idle", state: "idle", tone: "neutral" };
  const state =
    typeof status === "string"
      ? lower(status)
      : lower(typeof status.state === "string" ? status.state : undefined);
  const mode =
    typeof status === "object" && status && typeof status.mode === "string"
      ? status.mode
      : typeof status === "object" && status && typeof status.model === "string"
        ? status.model
        : undefined;
  if (state.includes("queue") || state === "pending") {
    return { label: "Qwen: queued", state: "queued", mode, tone: "info" };
  }
  if (state.includes("run") || state === "busy") {
    return { label: "Qwen: running", state: "running", mode, tone: "info" };
  }
  if (state === "ok" || state === "ready" || state === "done") {
    return { label: "Qwen: ready", state: "ready", mode, tone: "success" };
  }
  if (state === "disabled" || state === "not_run") {
    return { label: "Qwen: disabled", state: "disabled", mode, tone: "neutral" };
  }
  if (state === "timeout" || state === "unavailable") {
    return {
      label: "Qwen: unavailable - using rules only",
      state: "unavailable",
      mode,
      tone: "warning",
    };
  }
  if (state === "schema_error" || state === "error") {
    return { label: "Qwen: error - using rules only", state: "error", mode, tone: "error" };
  }
  return { label: state ? `Qwen: ${state}` : "Qwen: idle", state: "idle", mode, tone: "neutral" };
}

export function effectiveRiskLevel(input: {
  risk?: SceneRisk;
  entity?: BackendEntity;
  riskSummaryHighest?: RiskLevel | null;
  linkedSceneHighest?: RiskLevel | null;
}): RiskLevel | null {
  const risk = input.risk;
  const entity = input.entity;
  const rawLevel = normalizeRiskLevel(
    risk?.risk_level ?? entity?.risk_level,
    risk?.risk_color ?? entity?.risk_color,
  );
  let best = rawLevel;

  const hazard = lower(riskHazard(risk ?? {}));
  if (
    hazard === "object_near_edge" &&
    typeof risk?.risk_score === "number" &&
    risk.risk_score >= 4
  ) {
    best = riskLevelRank(best) < riskLevelRank("YELLOW") ? "YELLOW" : best;
  }

  const linkedHighest = normalizeRiskLevel(input.linkedSceneHighest);
  if (linkedHighest && riskLevelRank(linkedHighest) > riskLevelRank(best)) best = linkedHighest;

  const summaryHighest = normalizeRiskLevel(input.riskSummaryHighest);
  if (
    summaryHighest &&
    risk &&
    riskLevelRank(summaryHighest) > riskLevelRank(best) &&
    riskLevelRank(summaryHighest) >= riskLevelRank("YELLOW")
  ) {
    best = summaryHighest;
  }

  if (lower(risk?.risk_state) === "latent" && (!best || best === "GREEN")) {
    if (hazard === "object_near_edge") {
      // Only escalate latent object_near_edge to YELLOW when there is real
      // evidence — score, Qwen confirmation, visual evidence, explicit alert
      // flag, active state, or a stronger linked scene level. This stops the
      // UI from flooding with weak generic edge risks.
      const r = (risk ?? {}) as Record<string, unknown>;
      const score = typeof risk?.risk_score === "number" ? risk.risk_score : 0;
      const sourceStr = lower(
        typeof r.source === "string"
          ? (r.source as string)
          : typeof risk?.produced_by === "string"
            ? risk.produced_by
            : typeof risk?.reasoner_model === "string"
              ? risk.reasoner_model
              : undefined,
      );
      const qwenConfirmed =
        sourceStr.includes("qwen") ||
        sourceStr.includes("reasoner") ||
        r.confirmed_by_reasoner === true ||
        risk?.reasoner_status === "ok";
      const hasVisualEvidence =
        Array.isArray(risk?.visual_evidence) &&
        risk.visual_evidence.some((v) => typeof v === "string" && v.trim().length > 0);
      const isActive =
        lower(risk?.risk_anchor_status) === "active" ||
        lower(typeof r.status === "string" ? (r.status as string) : undefined) === "active" ||
        lower(typeof r.status === "string" ? (r.status as string) : undefined) === "confirmed";
      const shouldAlert = risk?.should_alert === true;
      const linkedStrong =
        linkedHighest && riskLevelRank(linkedHighest) >= riskLevelRank("YELLOW");

      if (
        score >= 4 ||
        qwenConfirmed ||
        hasVisualEvidence ||
        shouldAlert ||
        isActive ||
        linkedStrong
      ) {
        best = "YELLOW";
      }
    }
  }

  return best ?? null;
}

function riskMatchesEntity(risk: SceneRisk, entity: BackendEntity, index: number): boolean {
  const ids = entityIds(entity);
  if (
    risk.linked_entity_id &&
    (ids.includes(risk.linked_entity_id) || risk.linked_entity_id === entityStableId(entity, index))
  ) {
    return true;
  }
  const tracks = riskTrackIds(risk);
  if (tracks.some((track) => ids.includes(track))) return true;
  const detections = riskDetectionIds(risk);
  if (detections.some((id) => ids.includes(id))) return true;
  return (
    !!entity.linked_risk_id &&
    (entity.linked_risk_id === risk.risk_id || entity.linked_risk_id === risk.source_risk_id)
  );
}

function linkedLabelsForRisk(risk: SceneRisk, entities: BackendEntity[]): string[] {
  return unique(
    entities
      .map((entity, index) =>
        riskMatchesEntity(risk, entity, index) && isActionableObjectNearEdgeEntity(risk, entity)
          ? (entity.semantic_label ?? entity.label)
          : undefined,
      )
      .filter(Boolean),
  ).slice(0, 4);
}

function linkedIdsForRisk(risk: SceneRisk, entities: BackendEntity[]): string[] {
  const fromEntities = entities.flatMap((entity, index) =>
    riskMatchesEntity(risk, entity, index) && isActionableObjectNearEdgeEntity(risk, entity)
      ? entityIds(entity)
      : [],
  );
  if (isObjectNearEdgeRisk(risk) && fromEntities.length === 0) {
    return isQwenConfirmedRisk(risk) ? riskDetectionIds(risk) : [];
  }
  return unique([...riskTrackIds(risk), ...riskDetectionIds(risk), ...fromEntities]);
}

export function groupRisks(
  risks: SceneRisk[],
  entities: BackendEntity[],
  riskSummaryHighest?: RiskLevel | null,
): HseGroupedRisk[] {
  const groups = new Map<string, HseGroupedRisk>();
  const seenBaseKeys = new Set<string>();

  risks.forEach((risk, index) => {
    const baseKey = riskBaseKey(risk, index);
    if (seenBaseKeys.has(baseKey)) return;
    seenBaseKeys.add(baseKey);

    const level = effectiveRiskLevel({ risk, riskSummaryHighest });
    if (!level || riskLevelRank(level) < riskLevelRank("YELLOW")) return;

    const key = displayGroupKey(risk, index);
    const hazardType = riskHazard(risk);
    const action = primaryAction(risk);
    const linkedIds = linkedIdsForRisk(risk, entities);
    const labels = linkedLabelsForRisk(risk, entities);
    if (
      isObjectNearEdgeRisk(risk) &&
      labels.length === 0 &&
      linkedIds.length === 0 &&
      !isQwenConfirmedRisk(risk)
    ) {
      return;
    }
    const ackKey = acknowledgedKeyFor(
      hazardType,
      level,
      linkedIds,
      action,
      risk.risk_id ?? risk.source_risk_id ?? baseKey,
    );
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key: ackKey,
        title: formatHazardLabel(hazardType),
        level,
        hazardType,
        linkedLabels: labels,
        linkedTrackIds: unique(
          isObjectNearEdgeRisk(risk) ? linkedIds : [...riskTrackIds(risk), ...linkedIds],
        ),
        itemCount: Math.max(1, labels.length || linkedIds.length),
        reason: riskReason(risk),
        primaryAction: action,
        sourceLabel: sourceLabelForRisk(risk),
        isResolving: risk.risk_resolving === true,
        isStale: risk.risk_stale === true,
        highestRiskScore: risk.risk_score,
        latestSeenMs: riskUpdatedMs(risk, index),
        risks: [risk],
      });
      return;
    }

    existing.risks.push(risk);
    existing.linkedLabels = unique([...existing.linkedLabels, ...labels]).slice(0, 4);
    existing.linkedTrackIds = unique([
      ...existing.linkedTrackIds,
      ...(isObjectNearEdgeRisk(risk) ? linkedIds : [...riskTrackIds(risk), ...linkedIds]),
    ]);
    existing.itemCount = Math.max(
      existing.itemCount + 1,
      existing.linkedLabels.length,
      existing.linkedTrackIds.length,
    );
    if (riskLevelRank(level) > riskLevelRank(existing.level)) existing.level = level;
    if (
      typeof risk.risk_score === "number" &&
      risk.risk_score > (existing.highestRiskScore ?? Number.NEGATIVE_INFINITY)
    ) {
      existing.highestRiskScore = risk.risk_score;
    }
    existing.latestSeenMs = Math.max(
      existing.latestSeenMs ?? Number.NEGATIVE_INFINITY,
      riskUpdatedMs(risk, index),
    );
    if (!existing.reason) existing.reason = riskReason(risk);
    if (!existing.primaryAction) existing.primaryAction = action;
    if (
      existing.sourceLabel !== "Rules + Qwen" &&
      sourceLabelForRisk(risk) !== existing.sourceLabel
    ) {
      existing.sourceLabel = "Rules + Qwen";
    }
    existing.isResolving = existing.isResolving || risk.risk_resolving === true;
    existing.isStale = existing.isStale || risk.risk_stale === true;
  });

  return [...groups.values()].sort(rankGroupedRisks);
}

function qwenCandidateFromRisk(
  risk: SceneRisk,
  index: number,
  entities: BackendEntity[],
): HseQwenCandidate {
  const approximateRegion = risk.approximate_region ?? risk.bbox ?? risk.box;
  const matched = entities.find((entity, entityIndex) =>
    riskMatchesEntity(risk, entity, entityIndex),
  );
  const status =
    (risk.candidate_status as HseQwenCandidate["status"] | undefined) ??
    (matched ? "matched" : "unlinked");
  return {
    key: risk.risk_id ?? risk.source_risk_id ?? `qwen-candidate-${index}`,
    title: formatHazardLabel(riskHazard(risk)),
    level: effectiveRiskLevel({ risk }) ?? "YELLOW",
    reason: riskReason(risk),
    approximateRegion,
    confidence: risk.confidence,
    matchedEntityId: matched ? entityIds(matched)[0] : undefined,
    matchedTrackId: matched?.track_id,
    status,
  };
}

function collectQwenCandidates(
  parsedRisk: ParsedDetectRisk | null,
  entities: BackendEntity[],
  laneEnabled: boolean,
  showCandidates: boolean,
): HseQwenCandidate[] {
  if (!laneEnabled) return [];
  const candidates = [
    ...(parsedRisk?.qwenCandidates ?? []),
    ...(parsedRisk?.sceneRisks ?? []).filter(
      (risk) =>
        risk.candidate_status != null ||
        (riskLooksQwen(risk) && (risk.risk_association === "unmatched" || !risk.linked_entity_id)),
    ),
  ];
  if (!showCandidates) return [];
  return candidates.map((risk, index) => qwenCandidateFromRisk(risk, index, entities)).slice(0, 2);
}

export function filterOverlayEntities(
  entities: BackendEntity[],
  groupedRisks: HseGroupedRisk[],
  debug = false,
): BackendEntity[] {
  const activeRisks = groupedRisks.flatMap((group) => group.risks.map((risk) => ({ risk, group })));
  const out: BackendEntity[] = [];
  entities.forEach((entity, index) => {
    if (entity.correction_status === "suppress_from_hse_alerts" && !debug) return;
    const match = activeRisks.find(({ risk }) => riskMatchesEntity(risk, entity, index));
    if (
      match &&
      isObjectNearEdgeRisk(match.risk) &&
      !isActionableObjectNearEdgeEntity(match.risk, entity) &&
      !debug
    ) {
      return;
    }
    const level = effectiveRiskLevel({
      risk: match?.risk,
      entity,
      linkedSceneHighest: match?.group.level,
    });
    if (!debug && (!level || riskLevelRank(level) < riskLevelRank("YELLOW"))) return;
    if (
      !debug &&
      !match &&
      !entity.linked_risk_id &&
      riskLevelRank(level) < riskLevelRank("YELLOW")
    )
      return;
    out.push({
      ...entity,
      risk_level: level ?? entity.risk_level,
      risk_reason: match?.risk.risk_reason ?? entity.risk_reason,
      recommended_action: match?.group.primaryAction ?? entity.recommended_action,
      produced_by: match?.risk.produced_by ?? entity.produced_by,
      linked_risk_id: match?.risk.risk_id ?? entity.linked_risk_id,
      risk_stale: match?.group.isStale ?? entity.risk_stale,
      risk_resolving: match?.group.isResolving ?? entity.risk_resolving,
    });
  });
  return out;
}

function poseBounds(pose: BackendPose): BBox | null {
  const visible = pose.keypoints.filter((kp) => kp.score >= MIN_HSE_POSE_KEYPOINT_SCORE);
  if (visible.length === 0) return null;
  const xs = visible.map((kp) => kp.x);
  const ys = visible.map((kp) => kp.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: Math.max(0.02, maxX - minX), h: Math.max(0.02, maxY - minY) };
}

function hasHumanTorsoStructure(pose: BackendPose): boolean {
  const visibleNames = pose.keypoints
    .filter((kp) => kp.score >= MIN_HSE_POSE_KEYPOINT_SCORE)
    .map((kp) => lower(kp.name));
  const hasRecognizableNames = visibleNames.some((name) =>
    /(nose|eye|ear|shoulder|hip|knee|ankle|elbow|wrist|thumb|index|middle|ring|pinky|palm)/.test(
      name,
    ),
  );
  if (!hasRecognizableNames) return true;

  const shoulders = visibleNames.filter((name) => name.includes("shoulder")).length;
  const hips = visibleNames.filter((name) => name.includes("hip")).length;
  const head = visibleNames.some((name) => /nose|eye|ear/.test(name));
  const lowerBody = visibleNames.some((name) => /knee|ankle/.test(name));
  const handOnly =
    visibleNames.some((name) => /thumb|index|middle|ring|pinky|palm/.test(name)) &&
    shoulders === 0 &&
    hips === 0 &&
    !head &&
    !lowerBody;

  if (handOnly) return false;
  return shoulders >= 1 && (hips >= 1 || head || lowerBody);
}

function centerDistance(a: BBox, b: BBox): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

function overlapsOrNear(a: BBox, b: BBox): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const overlap =
    Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  return overlap > 0 || centerDistance(a, b) <= 0.25;
}

export function filterHsePoses(
  poses: BackendPose[],
  entities: BackendEntity[],
  _sceneContext?: unknown,
  debug = false,
): { poses: BackendPose[]; hiddenPoseReasons: string[] } {
  if (debug) return { poses, hiddenPoseReasons: [] };
  const people = entities.filter(
    (entity) => isPersonLabel(entity.label) && entity.confidence >= MIN_PERSON_CONFIDENCE,
  );
  const accepted: BackendPose[] = [];
  const hiddenPoseReasons: string[] = [];

  poses.forEach((pose, index) => {
    const strongKeypoints = pose.keypoints.filter((kp) => kp.score >= MIN_HSE_POSE_KEYPOINT_SCORE);
    const bounds = poseBounds(pose);
    const matchedPerson = !!bounds && people.some((person) => overlapsOrNear(bounds, person.bbox));
    const torsoOk = hasHumanTorsoStructure(pose);
    if (strongKeypoints.length >= MIN_HSE_POSE_KEYPOINTS && matchedPerson && torsoOk) {
      accepted.push(pose);
    } else {
      hiddenPoseReasons.push(
        `pose ${index} hidden: ${
          !matchedPerson
            ? "no matching person entity"
            : !torsoOk
              ? "no torso structure"
              : "low keypoint confidence"
        }`,
      );
    }
  });

  return { poses: accepted, hiddenPoseReasons };
}

function highestGroupLevel(groups: HseGroupedRisk[]): RiskLevel | null {
  return groups.reduce<RiskLevel | null>((best, group) => {
    if (riskLevelRank(group.level) > riskLevelRank(best)) return group.level;
    return best;
  }, null);
}

function localSeverityToRiskLevel(severity: HSESeverity): RiskLevel {
  switch (severity) {
    case "critical":
      return "RED";
    case "high":
      return "ORANGE";
    case "medium":
      return "YELLOW";
    default:
      return "GREEN";
  }
}

function localFallbackPriorityRisks(
  alerts: HSEActiveAlert[],
  acknowledgedRiskKeys?: Set<string>,
): HseGroupedRisk[] {
  const groups = new Map<string, HseGroupedRisk>();
  alerts
    .filter((alert) => alert.state !== "resolved")
    .forEach((alert) => {
      const level = localSeverityToRiskLevel(alert.severity);
      if (riskLevelRank(level) < riskLevelRank("YELLOW")) return;
      const linked = unique(alert.relatedTrackIds ?? []);
      const key = [
        "local",
        alert.category,
        linked.join(","),
        alert.recommendedAction || alert.title,
        level,
      ].join("|");
      const existing = groups.get(key);
      if (existing) {
        existing.itemCount += 1;
        existing.linkedTrackIds = unique([...existing.linkedTrackIds, ...linked]);
        if (riskLevelRank(level) > riskLevelRank(existing.level)) existing.level = level;
        existing.latestSeenMs = Math.max(existing.latestSeenMs ?? 0, alert.lastSeenMs);
        return;
      }
      groups.set(key, {
        key,
        title: alert.title,
        level,
        hazardType: alert.category,
        linkedLabels: [],
        linkedTrackIds: linked,
        itemCount: Math.max(1, linked.length || 1),
        reason: alert.spokenMessage || alert.shortMessage,
        primaryAction: alert.recommendedAction,
        sourceLabel: "Local fallback",
        acknowledged: acknowledgedRiskKeys?.has(key) ?? alert.state === "acknowledged",
        highestRiskScore: alert.confidence,
        latestSeenMs: alert.lastSeenMs,
        risks: [],
      });
    });

  return [...groups.values()]
    .filter((risk) => !risk.acknowledged)
    .sort(rankGroupedRisks)
    .slice(0, HSE_PRIORITY_RISK_LIMIT);
}

function sceneContextLabel(sceneContext: unknown): string | undefined {
  if (!sceneContext || typeof sceneContext !== "object") return undefined;
  const record = sceneContext as Record<string, unknown>;
  const candidates = [record.summary, record.scene, record.environment_type, record.location_type];
  return candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

export function buildHseLiveRiskViewModel(
  input: BuildHseLiveRiskViewModelInput,
): HseLiveRiskViewModel {
  const entities = input.entities ?? [];
  const poses = input.poses ?? [];
  const parsedRisk = input.parsedRisk;
  const rawRisks = parsedRisk?.sceneRisks ?? [];
  const groupedRisks = groupRisks(rawRisks, entities, parsedRisk?.riskSummary?.highest_level);
  const reasonerBadge = formatReasonerBadge(parsedRisk?.reasonerStatus);
  const qwenCandidates = collectQwenCandidates(
    parsedRisk,
    entities,
    input.qwenCandidateLaneEnabled === true,
    input.showQwenCandidates === true,
  );
  const shouldUseLocalFallback =
    rawRisks.length === 0 &&
    input.localAlertsEnabled === true &&
    (input.localActiveAlerts ?? []).some((alert) => alert.state !== "resolved");

  const groupedWithAck = groupedRisks.map((group) => ({
    ...group,
    acknowledged: input.acknowledgedRiskKeys?.has(group.key) ?? false,
  }));
  const acknowledgedRiskCount = groupedWithAck.filter((group) => group.acknowledged).length;
  const workerPriorityRisks = groupedWithAck
    .filter((group) => !group.acknowledged)
    .sort(rankGroupedRisks)
    .slice(0, HSE_PRIORITY_RISK_LIMIT);
  const priorityRisks = shouldUseLocalFallback
    ? localFallbackPriorityRisks(input.localActiveAlerts ?? [], input.acknowledgedRiskKeys)
    : workerPriorityRisks;
  const hiddenGroupedRiskCount = Math.max(0, groupedRisks.length - priorityRisks.length);

  const overlayEntities = filterOverlayEntities(entities, groupedRisks, input.debug === true);
  const poseResult = filterHsePoses(
    poses,
    entities,
    parsedRisk?.sceneContext,
    input.debug === true,
  );
  const debugRisks: HseDebugRisk[] = [
    ...rawRisks.map((risk, index) => ({
      key: riskBaseKey(risk, index),
      risk,
      sourceLabel: sourceLabelForRisk(risk),
    })),
    ...((input.localActiveAlerts ?? []).map((alert) => ({
      key: alert.key,
      risk: alert,
      sourceLabel: "Local fallback" as const,
      hidden: input.localAlertsEnabled !== true,
      reason: input.localAlertsEnabled === true ? undefined : "local alerts disabled",
    })) ?? []),
  ];

  return {
    overlayEntities,
    overlayPoses: poseResult.poses,
    priorityRisks,
    groupedRisks,
    debugRisks,
    qwenCandidates,
    reasonerBadge,
    sceneContextLabel: sceneContextLabel(parsedRisk?.sceneContext),
    highestLevel: highestGroupLevel(groupedRisks),
    rawRiskCount: rawRisks.length,
    groupedRiskCount: groupedRisks.length,
    acknowledgedRiskCount,
    hiddenGroupedRiskCount,
    hiddenPoseReasons: poseResult.hiddenPoseReasons,
    hasWorkerSceneRisks: rawRisks.length > 0,
    shouldUseLocalFallback,
  };
}
