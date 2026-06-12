import type { BackendEntity, BackendPose, BackendSegment, LiveBox } from "./types";
import type { HSECategory, HSEObservation } from "./hseTypes";

/**
 * Phase 1 — convert backend detections (YOLO26 entities / poses / segments) and
 * HSE live boxes into normalized HSE monitoring observations the risk engine
 * can reason over. We NEVER invent HSE classes YOLO can't produce: an unknown
 * label maps to the closest known category or "unknown".
 */

interface LabelRule {
  match: RegExp;
  category: HSECategory;
  normalizedLabel: string;
}

// Order matters — first match wins. Specific PPE/vehicle before generic person.
const LABEL_RULES: LabelRule[] = [
  { match: /forklift/i, category: "vehicle", normalizedLabel: "forklift" },
  { match: /truck|lorry/i, category: "vehicle", normalizedLabel: "truck" },
  {
    match: /\b(car|van|bus|vehicle|automobile)\b/i,
    category: "vehicle",
    normalizedLabel: "vehicle",
  },
  { match: /hard\s?hat|helmet/i, category: "ppe", normalizedLabel: "ppe-head" },
  { match: /safety\s?vest|hi-?vis|vest/i, category: "ppe", normalizedLabel: "ppe-vest" },
  { match: /glove/i, category: "ppe", normalizedLabel: "ppe-hand" },
  { match: /goggle|safety\s?glasses/i, category: "ppe", normalizedLabel: "ppe-eye" },
  {
    match: /worker|person|people|pedestrian|human/i,
    category: "person",
    normalizedLabel: "person",
  },
  { match: /ladder/i, category: "fall-hazard", normalizedLabel: "ladder" },
  { match: /scaffold/i, category: "fall-hazard", normalizedLabel: "scaffold" },
  {
    match: /fire\s?extinguisher|extinguisher/i,
    category: "fire-safety",
    normalizedLabel: "fire-extinguisher",
  },
  {
    match: /exit\s?sign|emergency\s?exit|fire\s?exit/i,
    category: "access-egress",
    normalizedLabel: "exit-sign",
  },
  { match: /\bcone\b|barrier|bollard/i, category: "equipment", normalizedLabel: "control-measure" },
  {
    match: /spill|puddle|liquid|wet\s?floor/i,
    category: "trip-hazard",
    normalizedLabel: "slip-hazard",
  },
  {
    match: /\b(box|carton)\b|pallet|cable|hose|cord|wire/i,
    category: "trip-hazard",
    normalizedLabel: "trip-hazard",
  },
  { match: /drill|hammer|wrench|grinder|saw|tool/i, category: "tool", normalizedLabel: "tool" },
];

/** Normalize a raw detector label to an HSE category + fine label. */
export function normalizeHseLabel(label: string): {
  category: HSECategory;
  normalizedLabel: string;
} {
  const l = (label ?? "").trim();
  for (const rule of LABEL_RULES) {
    if (rule.match.test(l))
      return { category: rule.category, normalizedLabel: rule.normalizedLabel };
  }
  return { category: "unknown", normalizedLabel: l ? l.toLowerCase() : "unknown" };
}

const PERSON_LABEL = /worker|person|people|pedestrian|human/i;

/** Whether a raw detector label denotes a person/worker. */
export function isPersonLabel(label: string): boolean {
  return PERSON_LABEL.test(label ?? "");
}

/** Bounding box enclosing a backend pose's confident keypoints (normalized
 *  0..1), or undefined when there aren't enough. Used to hide a person's box
 *  when a skeleton is available for them. */
export function poseBoundingBox(
  pose: { keypoints?: { x: number; y: number; score: number }[] },
  minScore = 0.1,
  pad = 0.03,
): { x: number; y: number; w: number; h: number } | undefined {
  const kpts = pose.keypoints?.filter((k) => k.score > minScore) ?? [];
  if (kpts.length < 2) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of kpts) {
    minX = Math.min(minX, k.x);
    minY = Math.min(minY, k.y);
    maxX = Math.max(maxX, k.x);
    maxY = Math.max(maxY, k.y);
  }
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return { x, y, w: Math.min(1, maxX + pad) - x, h: Math.min(1, maxY + pad) - y };
}

/** Does any pose overlap this box enough to be "the same person"? */
export function poseCoversBox(
  bbox: { x: number; y: number; w: number; h: number },
  poses: { keypoints?: { x: number; y: number; score: number }[] }[] | undefined,
  minIou = 0.15,
): boolean {
  if (!poses || poses.length === 0) return false;
  for (const p of poses) {
    const pb = poseBoundingBox(p);
    if (pb && iou(bbox, pb) >= minIou) return true;
  }
  return false;
}

/** Map the worker `source` string to the observation source bucket. */
function obsSource(source?: string): HSEObservation["source"] {
  if (!source) return "yolo26";
  if (/yolo/i.test(source)) return "yolo26";
  if (/edgecraft/i.test(source)) return "edgecrafter";
  return source;
}

/** Bounding box of a normalized contour (for segment-only detections). */
function contourBBox(contour: { x: number; y: number }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of contour) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Convert one monitoring frame's backend output into HSE observations. Poses
 * become person observations (so posture/ergonomics rules can run even when no
 * "person" box was returned). Segments enrich matching entities with a contour,
 * and a segment with no matching entity still becomes its own observation.
 */
export function mapToHseObservations(input: {
  entities?: BackendEntity[];
  poses?: BackendPose[];
  segments?: BackendSegment[];
  liveBoxes?: LiveBox[];
  timestampMs: number;
}): HSEObservation[] {
  const ts = input.timestampMs;
  const out: HSEObservation[] = [];

  (input.entities ?? []).forEach((e, i) => {
    if (!e?.bbox) return;
    const { category, normalizedLabel } = normalizeHseLabel(e.label);
    out.push({
      id: `ent-${i}`,
      label: e.label,
      normalizedLabel,
      category,
      confidence: e.confidence ?? 0,
      bbox: e.bbox,
      maskContour: e.maskContour,
      source: obsSource(e.source),
      timestampMs: ts,
    });
  });

  // Attach segment contours to the closest same-label entity; otherwise add the
  // segment as its own observation (mask-only detection).
  (input.segments ?? []).forEach((s, i) => {
    const bbox = contourBBox(s.maskContour);
    const match = out.find(
      (o) => o.label.toLowerCase() === (s.label ?? "").toLowerCase() && !o.maskContour,
    );
    if (match) {
      match.maskContour = s.maskContour;
      return;
    }
    const { category, normalizedLabel } = normalizeHseLabel(s.label);
    out.push({
      id: `seg-${i}`,
      label: s.label,
      normalizedLabel,
      category,
      confidence: s.confidence ?? 0,
      bbox,
      maskContour: s.maskContour,
      source: obsSource(s.source),
      timestampMs: ts,
    });
  });

  // Poses → person observations (only when no entity already covers that area).
  (input.poses ?? []).forEach((p, i) => {
    const bbox = poseBBox(p);
    const overlapsPerson = out.some(
      (o) => o.category === "person" && o.bbox && bbox && iou(o.bbox, bbox) > 0.3,
    );
    if (overlapsPerson) {
      // enrich the existing person obs with the pose for ergonomics rules
      const person = out.find(
        (o) => o.category === "person" && o.bbox && bbox && iou(o.bbox, bbox) > 0.3,
      );
      if (person && !person.pose) person.pose = p;
      return;
    }
    out.push({
      id: `pose-${i}`,
      label: p.label ?? "person",
      normalizedLabel: "person",
      category: "person",
      confidence: p.confidence ?? 0,
      bbox,
      pose: p,
      source: "edgecrafter",
      timestampMs: ts,
    });
  });

  // HSE live boxes (existing RiskEngine overlay boxes) — kept as observations
  // so the HUD can show them too; labelled by their hazard type.
  (input.liveBoxes ?? []).forEach((b, i) => {
    if (!b?.bbox) return;
    const { category, normalizedLabel } = normalizeHseLabel(b.hazardType);
    out.push({
      id: `live-${i}`,
      label: b.hazardType,
      normalizedLabel,
      category,
      confidence: b.confidence ?? 0,
      bbox: b.bbox,
      source: "manual",
      timestampMs: ts,
    });
  });

  return out;
}

/** Axis-aligned bbox enclosing a pose's keypoints (normalized 0..1). */
function poseBBox(p: BackendPose) {
  const kpts = p.keypoints?.filter((k) => k.score > 0.1) ?? [];
  if (kpts.length < 2) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of kpts) {
    minX = Math.min(minX, k.x);
    minY = Math.min(minY, k.y);
    maxX = Math.max(maxX, k.x);
    maxY = Math.max(maxY, k.y);
  }
  // pad slightly so the box wraps the body, clamped to frame
  const pad = 0.03;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.min(1, maxX + pad) - Math.max(0, minX - pad),
    h: Math.min(1, maxY + pad) - Math.max(0, minY - pad),
  };
}

/** Intersection-over-union of two normalized boxes. */
export function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
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
