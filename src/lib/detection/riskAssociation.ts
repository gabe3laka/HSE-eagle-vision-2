import type { BackendEntity, BBox } from "./types";
import type { RecommendedControl, RiskLevel, SceneRisk, SemanticCorrection } from "./riskTypes";
import { normalizeRiskLevel, riskLevelRank } from "./riskTypes";

export type NormalizedBox = BBox;

export type EntitySnapshot = {
  frameId?: string;
  timestampMs: number;
  entities: BackendEntity[];
};

export type RiskAnchor = {
  riskId: string;
  riskLevel: RiskLevel;
  riskScore?: number;
  hazardType?: string;
  riskState?: string;
  reason?: string;
  evidence?: string[];
  recommendedAction?: string;
  recommendedControls?: RecommendedControl[];
  producedBy?: string;
  requiresHumanReview?: boolean;

  linkedTrackIds: string[];
  linkedDetectionIds: string[];

  lastMatchedEntityId?: string;
  lastMatchedTrackId?: string;
  lastLabel?: string;
  lastSemanticLabel?: string;
  lastBox?: NormalizedBox;

  status?: "active" | "resolving" | "expired";
  stale?: boolean;
  lastConfirmedAtMs?: number;
  resolvingStartedAtMs?: number;

  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
};

export type CorrectionAnchor = {
  correctionId: string;
  action?: string;
  semanticLabel?: string;
  rawLabel?: string;
  reason?: string;
  linkedTrackIds: string[];
  linkedDetectionIds: string[];
  lastMatchedEntityId?: string;
  lastMatchedTrackId?: string;
  lastLabel?: string;
  lastSemanticLabel?: string;
  lastBox?: NormalizedBox;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
};

export type RiskAssociationResult = {
  entities: BackendEntity[];
  associatedRisks: SceneRisk[];
  anchors: RiskAnchor[];
  unmatchedRisks: SceneRisk[];
};

export type SemanticCorrectionResult = {
  entities: BackendEntity[];
  anchors: CorrectionAnchor[];
  unmatchedCorrections: SemanticCorrection[];
};

export const RECENT_ENTITY_MEMORY_MS = 4000;
export const YELLOW_CARRYOVER_MS = 2000;
export const YELLOW_HARD_MAX_MS = 2500;
export const ORANGE_CARRYOVER_MS = 3000;
export const RED_CARRYOVER_MS = 5000;
export const SUPPRESSED_CARRYOVER_MS = 2000;
export const RESOLVING_YELLOW_MS = 750;

const HISTORICAL_IOU_THRESHOLD = 0.2;
const HISTORICAL_CENTER_THRESHOLD = 0.2;
const ANCHOR_THRESHOLD = 0.55;
const RED_ANCHOR_THRESHOLD = 0.45;
const SPATIAL_FALLBACK_THRESHOLD = 0.6;

const PROTECTED_SUPPRESSION_LABELS = [
  "person",
  "fire",
  "smoke",
  "spill",
  "knife",
  "broken glass",
  "exposed wire",
  "forklift",
  "moving vehicle",
  "vehicle",
];

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

function labelKey(value?: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function entityStableId(entity: BackendEntity, index: number): string {
  return entity.id ?? entity.detection_id ?? entity.track_id ?? `${entity.label}-${index}`;
}

function riskLevelTtl(level?: RiskLevel | null): number {
  switch (String(level ?? "").toUpperCase()) {
    case "RED":
      return RED_CARRYOVER_MS;
    case "ORANGE":
      return ORANGE_CARRYOVER_MS;
    case "YELLOW":
      return YELLOW_CARRYOVER_MS;
    default:
      return SUPPRESSED_CARRYOVER_MS;
  }
}

function riskHardExpiry(anchor: RiskAnchor): number {
  const confirmedAtMs = anchor.lastConfirmedAtMs ?? anchor.updatedAtMs ?? anchor.createdAtMs;
  if (String(anchor.riskLevel).toUpperCase() === "YELLOW") {
    return confirmedAtMs + YELLOW_HARD_MAX_MS;
  }
  return confirmedAtMs + riskLevelTtl(anchor.riskLevel);
}

function hazardType(risk: SceneRisk): string | undefined {
  return risk.hazard_type ?? risk.hazard;
}

function riskReason(risk: SceneRisk): string | undefined {
  return (
    risk.risk_reason ?? risk.trigger_condition ?? risk.visual_evidence?.[0] ?? risk.evidence?.[0]
  );
}

function riskEvidence(risk: SceneRisk): string[] | undefined {
  return risk.visual_evidence ?? risk.evidence;
}

function riskTrackIds(risk: SceneRisk): string[] {
  return unique([...(risk.involved_track_ids ?? []), asString(risk.track_id)]);
}

function riskDetectionIds(risk: SceneRisk): string[] {
  return unique([
    ...(risk.involved_detection_ids ?? []),
    asString(risk.detection_id),
    asString(risk.entity_id),
  ]);
}

function riskIdentity(risk: SceneRisk, index: number): string {
  const tracks = riskTrackIds(risk).join(",");
  const detections = riskDetectionIds(risk).join(",");
  if (risk.risk_id) return risk.risk_id;
  const linkedIds = tracks || detections;
  const hazardKey = linkedIds ? [hazardType(risk), linkedIds].filter(Boolean).join(":") : "";
  if (hazardKey) return hazardKey;
  const trackKey = risk.track_id ? [risk.track_id, risk.risk_level].filter(Boolean).join(":") : "";
  return trackKey || `risk-${index}`;
}

function correctionTrackIds(correction: SemanticCorrection): string[] {
  return unique([...(correction.involved_track_ids ?? []), asString(correction.track_id)]);
}

function correctionDetectionIds(correction: SemanticCorrection): string[] {
  return unique([
    ...(correction.involved_detection_ids ?? []),
    asString(correction.detection_id),
    asString(correction.entity_id),
  ]);
}

function correctionIdentity(correction: SemanticCorrection, index: number): string {
  const ids = [...correctionTrackIds(correction), ...correctionDetectionIds(correction)];
  if (correction.correction_id) return correction.correction_id;
  const key = ids.length ? [correction.action, ...ids].filter(Boolean).join(":") : "";
  return key || `correction-${index}`;
}

function riskBox(risk: SceneRisk): NormalizedBox | undefined {
  const box = risk.bbox ?? risk.box;
  if (!box) return undefined;
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

function correctionBox(correction: SemanticCorrection): NormalizedBox | undefined {
  const box = correction.bbox ?? correction.box;
  if (!box) return undefined;
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

export function pushRecentEntitySnapshot(
  snapshots: EntitySnapshot[],
  snapshot: EntitySnapshot,
  nowMs = snapshot.timestampMs,
): EntitySnapshot[] {
  return [...snapshots, snapshot]
    .filter((s) => nowMs - s.timestampMs <= RECENT_ENTITY_MEMORY_MS)
    .slice(-24);
}

function iou(a: NormalizedBox, b: NormalizedBox): number {
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

function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

function sizeSimilarity(a: NormalizedBox, b: NormalizedBox): number {
  const aw = Math.max(0.001, a.w);
  const ah = Math.max(0.001, a.h);
  const bw = Math.max(0.001, b.w);
  const bh = Math.max(0.001, b.h);
  const wr = Math.min(aw, bw) / Math.max(aw, bw);
  const hr = Math.min(ah, bh) / Math.max(ah, bh);
  return (wr + hr) / 2;
}

function compatibleLabels(a?: string, b?: string): boolean {
  const left = labelKey(a);
  const right = labelKey(b);
  if (!left || !right) return true;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function matchScore(
  sourceBox: NormalizedBox,
  entity: BackendEntity,
  sourceLabel?: string,
  sourceSemanticLabel?: string,
): number {
  const overlap = iou(sourceBox, entity.bbox);
  const dist = centerDistance(sourceBox, entity.bbox);
  const centerScore = Math.max(0, 1 - dist / 0.35);
  const sizeScore = sizeSimilarity(sourceBox, entity.bbox);
  const labelScore = compatibleLabels(sourceLabel, entity.label) ? 1 : 0;
  const semanticScore = compatibleLabels(sourceSemanticLabel, entity.semantic_label) ? 1 : 0.65;
  return (
    overlap * 0.35 + centerScore * 0.3 + sizeScore * 0.15 + labelScore * 0.15 + semanticScore * 0.05
  );
}

function findEntityByIds(
  entities: BackendEntity[],
  trackIds: string[],
  detectionIds: string[],
): number {
  return entities.findIndex((entity) => {
    const trackMatch = !!entity.track_id && trackIds.includes(entity.track_id);
    const detectionMatch = !!entity.detection_id && detectionIds.includes(entity.detection_id);
    const idMatch = !!entity.id && detectionIds.includes(entity.id);
    return trackMatch || detectionMatch || idMatch;
  });
}

function findHistoricalEntity(
  trackIds: string[],
  detectionIds: string[],
  recentSnapshots: EntitySnapshot[],
): BackendEntity | null {
  for (let s = recentSnapshots.length - 1; s >= 0; s -= 1) {
    const idx = findEntityByIds(recentSnapshots[s].entities, trackIds, detectionIds);
    if (idx >= 0) return recentSnapshots[s].entities[idx];
  }
  return null;
}

function findBestSpatialMatch(
  entities: BackendEntity[],
  sourceBox: NormalizedBox,
  sourceLabel?: string,
  sourceSemanticLabel?: string,
): { index: number; score: number; overlap: number; distance: number } {
  let best = { index: -1, score: -1, overlap: 0, distance: Number.POSITIVE_INFINITY };
  entities.forEach((entity, index) => {
    const overlap = iou(sourceBox, entity.bbox);
    const distance = centerDistance(sourceBox, entity.bbox);
    const score = matchScore(sourceBox, entity, sourceLabel, sourceSemanticLabel);
    if (score > best.score) best = { index, score, overlap, distance };
  });
  return best;
}

function buildAnchorFromRisk(
  risk: SceneRisk,
  riskId: string,
  entity: BackendEntity,
  nowMs: number,
  previous?: RiskAnchor,
  stale = false,
  status: RiskAnchor["status"] = "active",
): RiskAnchor {
  const level = normalizeRiskLevel(risk.risk_level, risk.risk_color) ?? "YELLOW";
  const createdAtMs = previous?.createdAtMs ?? nowMs;
  const expiresAtMs = nowMs + riskLevelTtl(level);
  return {
    riskId,
    riskLevel: level,
    riskScore: risk.risk_score,
    hazardType: hazardType(risk),
    riskState: risk.risk_state,
    reason: riskReason(risk),
    evidence: riskEvidence(risk),
    recommendedAction: risk.recommended_action ?? risk.recommended_controls?.[0]?.action,
    recommendedControls: risk.recommended_controls,
    producedBy: risk.produced_by,
    requiresHumanReview: risk.requires_human_review,
    linkedTrackIds: unique([...riskTrackIds(risk), entity.track_id]),
    linkedDetectionIds: unique([...riskDetectionIds(risk), entity.detection_id, entity.id]),
    lastMatchedEntityId: entityStableId(entity, 0),
    lastMatchedTrackId: entity.track_id,
    lastLabel: entity.label,
    lastSemanticLabel: entity.semantic_label,
    lastBox: entity.bbox,
    status,
    stale,
    lastConfirmedAtMs: stale ? previous?.lastConfirmedAtMs : nowMs,
    resolvingStartedAtMs:
      status === "resolving" ? (previous?.resolvingStartedAtMs ?? nowMs) : undefined,
    createdAtMs,
    updatedAtMs: nowMs,
    expiresAtMs,
  };
}

function riskFromAnchor(anchor: RiskAnchor): SceneRisk {
  return {
    risk_id: anchor.riskId,
    hazard_type: anchor.hazardType,
    hazard: anchor.hazardType,
    risk_level: anchor.riskLevel,
    risk_score: anchor.riskScore,
    risk_state: anchor.riskState,
    risk_reason: anchor.reason,
    visual_evidence: anchor.evidence,
    recommended_action: anchor.recommendedAction,
    recommended_controls: anchor.recommendedControls,
    produced_by: anchor.producedBy,
    requires_human_review: anchor.requiresHumanReview,
    involved_track_ids: anchor.linkedTrackIds,
    involved_detection_ids: anchor.linkedDetectionIds,
  };
}

function applyRiskToEntity(
  entity: BackendEntity,
  risk: SceneRisk,
  association: BackendEntity["risk_association"],
  anchor: RiskAnchor,
  stale: boolean,
  resolving: boolean,
): BackendEntity {
  const level = normalizeRiskLevel(risk.risk_level, risk.risk_color) ?? anchor.riskLevel;
  const currentRank = riskLevelRank(normalizeRiskLevel(entity.risk_level, entity.risk_color));
  const nextRank = riskLevelRank(level);
  if (nextRank >= currentRank) {
    entity.risk_level = level;
    entity.risk_score = risk.risk_score ?? anchor.riskScore;
    entity.severity = risk.severity;
    entity.likelihood = risk.likelihood;
    entity.risk_reason = riskReason(risk) ?? anchor.reason;
    entity.evidence = riskEvidence(risk) ?? anchor.evidence;
    entity.recommended_action =
      risk.recommended_action ?? risk.recommended_controls?.[0]?.action ?? anchor.recommendedAction;
    entity.recommended_controls = risk.recommended_controls ?? anchor.recommendedControls;
    entity.produced_by = risk.produced_by ?? anchor.producedBy;
    entity.requires_human_review = risk.requires_human_review ?? anchor.requiresHumanReview;
    entity.linked_risk_id = anchor.riskId;
    entity.risk_association = association;
    entity.risk_stale = stale;
    entity.risk_resolving = resolving;
    entity.risk_expires_at_ms = anchor.expiresAtMs;
  }
  return entity;
}

function applyAnchorToEntity(
  entity: BackendEntity,
  anchor: RiskAnchor,
  association: BackendEntity["risk_association"],
): BackendEntity {
  return applyRiskToEntity(
    entity,
    riskFromAnchor(anchor),
    association,
    anchor,
    anchor.stale === true || anchor.status === "resolving",
    anchor.status === "resolving",
  );
}

function previousAnchorForRisk(
  previousAnchors: RiskAnchor[],
  riskId: string,
): RiskAnchor | undefined {
  return previousAnchors.find((anchor) => anchor.riskId === riskId);
}

function riskStillConfirmedByCurrentResponse(
  anchor: RiskAnchor,
  risks: SceneRisk[],
  indexToSkip = -1,
): boolean {
  return risks.some((risk, index) => {
    if (index === indexToSkip) return false;
    if (risk.risk_id && risk.risk_id === anchor.riskId) return true;
    if (hazardType(risk) && hazardType(risk) === anchor.hazardType) {
      const tracks = riskTrackIds(risk);
      return tracks.some((track) => anchor.linkedTrackIds.includes(track));
    }
    return false;
  });
}

export function associateRisksToEntities(
  currentEntities: BackendEntity[],
  risks: SceneRisk[],
  _semanticCorrections: unknown[],
  recentSnapshots: EntitySnapshot[],
  previousAnchors: RiskAnchor[],
  nowMs: number,
): RiskAssociationResult {
  const entities = currentEntities.map((entity) => ({ ...entity }));
  const associatedRisks: SceneRisk[] = [];
  const nextAnchors: RiskAnchor[] = [];
  const unmatchedRisks: SceneRisk[] = [];
  const updatedAnchorIds = new Set<string>();

  risks.forEach((risk, riskIndex) => {
    const riskId = riskIdentity(risk, riskIndex);
    const trackIds = riskTrackIds(risk);
    const detectionIds = riskDetectionIds(risk);
    const previous = previousAnchorForRisk(previousAnchors, riskId);
    let matchedIndex = findEntityByIds(entities, trackIds, detectionIds);
    let association: BackendEntity["risk_association"] = "exact_id";

    if (matchedIndex < 0) {
      const historical = findHistoricalEntity(trackIds, detectionIds, recentSnapshots);
      if (historical) {
        const best = findBestSpatialMatch(
          entities,
          historical.bbox,
          historical.label,
          historical.semantic_label,
        );
        if (
          best.index >= 0 &&
          (best.overlap >= HISTORICAL_IOU_THRESHOLD ||
            (best.distance <= HISTORICAL_CENTER_THRESHOLD &&
              compatibleLabels(historical.label, entities[best.index].label)))
        ) {
          matchedIndex = best.index;
          association = "historical_id";
        }
      }
    }

    if (matchedIndex < 0 && previous?.lastBox) {
      const best = findBestSpatialMatch(
        entities,
        previous.lastBox,
        previous.lastLabel,
        previous.lastSemanticLabel,
      );
      const level = normalizeRiskLevel(risk.risk_level, risk.risk_color) ?? previous.riskLevel;
      const threshold =
        String(level).toUpperCase() === "RED" ? RED_ANCHOR_THRESHOLD : ANCHOR_THRESHOLD;
      if (best.index >= 0 && best.score >= threshold) {
        matchedIndex = best.index;
        association = "anchor_carryover";
      }
    }

    if (matchedIndex < 0) {
      const box = riskBox(risk);
      if (box) {
        const best = findBestSpatialMatch(entities, box, hazardType(risk));
        if (best.index >= 0 && best.score >= SPATIAL_FALLBACK_THRESHOLD) {
          matchedIndex = best.index;
          association = "spatial_fallback";
        }
      }
    }

    if (matchedIndex < 0) {
      const unmatched = { ...risk, risk_association: "unmatched" };
      associatedRisks.push(unmatched);
      unmatchedRisks.push(unmatched);
      return;
    }

    const anchor = buildAnchorFromRisk(risk, riskId, entities[matchedIndex], nowMs, previous);
    associatedRisks.push({
      ...risk,
      linked_entity_id: entityStableId(entities[matchedIndex], matchedIndex),
      risk_association: association,
      risk_anchor_status: anchor.status,
      risk_stale: false,
      risk_resolving: false,
    });
    nextAnchors.push(anchor);
    updatedAnchorIds.add(riskId);
    applyRiskToEntity(entities[matchedIndex], risk, association, anchor, false, false);
  });

  for (const previous of previousAnchors) {
    if (updatedAnchorIds.has(previous.riskId)) continue;
    if (
      previous.status === "expired" ||
      nowMs >= Math.min(previous.expiresAtMs, riskHardExpiry(previous))
    ) {
      continue;
    }
    if (!previous.lastBox) {
      nextAnchors.push(previous);
      continue;
    }
    const best = findBestSpatialMatch(
      entities,
      previous.lastBox,
      previous.lastLabel,
      previous.lastSemanticLabel,
    );
    const isRed = String(previous.riskLevel).toUpperCase() === "RED";
    const threshold = isRed ? RED_ANCHOR_THRESHOLD : ANCHOR_THRESHOLD;
    if (best.index < 0 || best.score < threshold) {
      nextAnchors.push({ ...previous, stale: true, updatedAtMs: nowMs });
      continue;
    }

    const level = String(previous.riskLevel).toUpperCase();
    const sameRiskConfirmed = riskStillConfirmedByCurrentResponse(previous, risks);
    if (sameRiskConfirmed) {
      nextAnchors.push(previous);
      continue;
    }

    if (level === "YELLOW") {
      const resolvingStartedAtMs = previous.resolvingStartedAtMs ?? nowMs;
      if (nowMs - resolvingStartedAtMs > RESOLVING_YELLOW_MS) continue;
      const anchor: RiskAnchor = {
        ...previous,
        lastMatchedEntityId: entityStableId(entities[best.index], best.index),
        lastMatchedTrackId: entities[best.index].track_id,
        lastLabel: entities[best.index].label,
        lastSemanticLabel: entities[best.index].semantic_label,
        lastBox: entities[best.index].bbox,
        status: "resolving",
        stale: true,
        resolvingStartedAtMs,
        updatedAtMs: nowMs,
        expiresAtMs: Math.min(previous.expiresAtMs, riskHardExpiry(previous)),
      };
      nextAnchors.push(anchor);
      applyAnchorToEntity(entities[best.index], anchor, "anchor_carryover");
      continue;
    }

    const anchor: RiskAnchor = {
      ...previous,
      lastMatchedEntityId: entityStableId(entities[best.index], best.index),
      lastMatchedTrackId: entities[best.index].track_id,
      lastLabel: entities[best.index].label,
      lastSemanticLabel: entities[best.index].semantic_label,
      lastBox: entities[best.index].bbox,
      status: "active",
      stale: true,
      updatedAtMs: nowMs,
    };
    nextAnchors.push(anchor);
    applyAnchorToEntity(entities[best.index], anchor, "anchor_carryover");
  }

  return {
    entities,
    associatedRisks,
    anchors: nextAnchors.filter(
      (anchor) => anchor.status !== "expired" && nowMs < anchor.expiresAtMs,
    ),
    unmatchedRisks,
  };
}

function isProtectedSuppression(entity: BackendEntity, correction: SemanticCorrection): boolean {
  const action = labelKey(correction.action);
  if (action !== "suppress_from_hse_alerts") return false;
  const labels = [
    entity.label,
    entity.semantic_label,
    entity.raw_label,
    correction.semantic_label,
    correction.corrected_label,
  ]
    .map(labelKey)
    .filter(Boolean);
  return labels.some((label) =>
    PROTECTED_SUPPRESSION_LABELS.some(
      (protectedLabel) => label === protectedLabel || label.includes(protectedLabel),
    ),
  );
}

function applyCorrection(entity: BackendEntity, correction: SemanticCorrection): BackendEntity {
  if (isProtectedSuppression(entity, correction)) {
    entity.correction_status = "protected_not_suppressed";
    entity.semantic_correction_reason = correction.reason;
    return entity;
  }
  entity.raw_label = entity.raw_label ?? entity.label;
  const semanticLabel = correction.semantic_label ?? correction.corrected_label ?? correction.label;
  if (semanticLabel) entity.semantic_label = semanticLabel;
  entity.correction_status = correction.action ?? correction.status ?? "corrected";
  entity.semantic_correction_reason = correction.reason;
  return entity;
}

export function applySemanticCorrectionsToEntities(
  currentEntities: BackendEntity[],
  semanticCorrections: SemanticCorrection[],
  recentSnapshots: EntitySnapshot[],
  previousCorrectionAnchors: CorrectionAnchor[],
  nowMs: number,
): SemanticCorrectionResult {
  const entities = currentEntities.map((entity) => ({ ...entity }));
  const anchors: CorrectionAnchor[] = [];
  const unmatchedCorrections: SemanticCorrection[] = [];

  semanticCorrections.forEach((correction, index) => {
    const correctionId = correctionIdentity(correction, index);
    const trackIds = correctionTrackIds(correction);
    const detectionIds = correctionDetectionIds(correction);
    const previous = previousCorrectionAnchors.find(
      (anchor) => anchor.correctionId === correctionId,
    );
    let matchedIndex = findEntityByIds(entities, trackIds, detectionIds);

    if (matchedIndex < 0) {
      const historical = findHistoricalEntity(trackIds, detectionIds, recentSnapshots);
      if (historical) {
        const best = findBestSpatialMatch(
          entities,
          historical.bbox,
          historical.label,
          historical.semantic_label,
        );
        if (
          best.index >= 0 &&
          (best.overlap >= HISTORICAL_IOU_THRESHOLD ||
            (best.distance <= HISTORICAL_CENTER_THRESHOLD &&
              compatibleLabels(historical.label, entities[best.index].label)))
        ) {
          matchedIndex = best.index;
        }
      }
    }

    if (matchedIndex < 0 && previous?.lastBox) {
      const best = findBestSpatialMatch(
        entities,
        previous.lastBox,
        previous.lastLabel,
        previous.lastSemanticLabel,
      );
      if (best.index >= 0 && best.score >= ANCHOR_THRESHOLD) matchedIndex = best.index;
    }

    if (matchedIndex < 0) {
      const box = correctionBox(correction);
      if (box) {
        const best = findBestSpatialMatch(
          entities,
          box,
          correction.original_label ?? correction.raw_label,
        );
        if (best.index >= 0 && best.score >= SPATIAL_FALLBACK_THRESHOLD) matchedIndex = best.index;
      }
    }

    if (matchedIndex < 0) {
      unmatchedCorrections.push(correction);
      return;
    }

    applyCorrection(entities[matchedIndex], correction);
    anchors.push({
      correctionId,
      action: correction.action,
      semanticLabel: correction.semantic_label ?? correction.corrected_label ?? correction.label,
      rawLabel: correction.raw_label ?? correction.original_label,
      reason: correction.reason,
      linkedTrackIds: unique([...trackIds, entities[matchedIndex].track_id]),
      linkedDetectionIds: unique([
        ...detectionIds,
        entities[matchedIndex].detection_id,
        entities[matchedIndex].id,
      ]),
      lastMatchedEntityId: entityStableId(entities[matchedIndex], matchedIndex),
      lastMatchedTrackId: entities[matchedIndex].track_id,
      lastLabel: entities[matchedIndex].label,
      lastSemanticLabel: entities[matchedIndex].semantic_label,
      lastBox: entities[matchedIndex].bbox,
      createdAtMs: previous?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
      expiresAtMs: nowMs + SUPPRESSED_CARRYOVER_MS,
    });
  });

  for (const previous of previousCorrectionAnchors) {
    if (anchors.some((anchor) => anchor.correctionId === previous.correctionId)) continue;
    if (nowMs >= previous.expiresAtMs || !previous.lastBox) continue;
    const best = findBestSpatialMatch(
      entities,
      previous.lastBox,
      previous.lastLabel,
      previous.lastSemanticLabel,
    );
    if (best.index < 0 || best.score < ANCHOR_THRESHOLD) continue;
    applyCorrection(entities[best.index], {
      correction_id: previous.correctionId,
      action: previous.action,
      semantic_label: previous.semanticLabel,
      raw_label: previous.rawLabel,
      reason: previous.reason,
    });
    anchors.push({
      ...previous,
      lastMatchedEntityId: entityStableId(entities[best.index], best.index),
      lastMatchedTrackId: entities[best.index].track_id,
      lastLabel: entities[best.index].label,
      lastSemanticLabel: entities[best.index].semantic_label,
      lastBox: entities[best.index].bbox,
      updatedAtMs: nowMs,
    });
  }

  return { entities, anchors, unmatchedCorrections };
}
