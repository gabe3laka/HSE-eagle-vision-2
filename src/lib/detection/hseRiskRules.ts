import type { DetectionZone } from "./types";
import type { HSEAlertCandidate, HSEObservation, HSESeverity, HSETrack } from "./hseTypes";
import { iou } from "./hseEntityMapper";

/**
 * Phase 4 — HSE risk rules. Turns stable tracks + observations + zones into
 * actionable HSEAlertCandidates. Local + immediate (DeepSeek refines later).
 *
 * Discipline:
 *  - Only STABLE tracks raise normal hazards (no single-frame flicker alerts);
 *    a near-collision (very high overlap) may fire on a fresh track.
 *  - PPE uses cautious wording ("PPE not visible") — never a hard "no PPE".
 *  - Messages are actionable, e.g. "Step back from the vehicle path."
 */

const PERSISTENCE = (t?: HSETrack) => (t ? t.ageMs : 0);

let candSeq = 0;
const nextId = () => `hsec-${++candSeq}`;

/** Centre point of a box. */
function centre(b: { x: number; y: number; w: number; h: number }) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
/** Centre-to-centre distance of two boxes (normalized). */
function gap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ca = centre(a);
  const cb = centre(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}
/** Is a box centre inside a (possibly polygon) zone — point-in-polygon. */
function inZone(b: { x: number; y: number; w: number; h: number }, zone: DetectionZone): boolean {
  const pts = zone.points;
  if (!pts || pts.length < 3) return false;
  const { x, y } = centre(b);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export interface HseRulesInput {
  tracks: HSETrack[];
  observations: HSEObservation[];
  zones?: DetectionZone[];
  /** PPE is only meaningful if the site requires it AND PPE classes can appear. */
  ppeRequired?: boolean;
}

/**
 * Run the HSE rules over the current scene. Returns the candidate hazards for
 * this tick (the alert manager then handles cooldown/dedupe/persistence).
 */
export function runHseRules(input: HseRulesInput): HSEAlertCandidate[] {
  const { tracks, observations, zones = [], ppeRequired } = input;
  const out: HSEAlertCandidate[] = [];

  const persons = tracks.filter((t) => t.category === "person");
  const vehicles = tracks.filter((t) => t.category === "vehicle");
  const stablePersons = persons.filter((t) => t.stable);

  // 1 — Person ↔ vehicle proximity (forklift path).
  for (const person of persons) {
    for (const vehicle of vehicles) {
      if (!person.stable && !vehicle.stable) continue;
      const overlap = iou(person.bbox, vehicle.bbox);
      const d = gap(person.bbox, vehicle.bbox);
      if (overlap > 0.05 || d < 0.22) {
        const severity: HSESeverity = overlap > 0.15 || d < 0.12 ? "high" : "medium";
        const vlabel = vehicle.normalizedLabel === "forklift" ? "forklift" : "vehicle";
        out.push({
          id: nextId(),
          severity,
          category: "proximity",
          title: `Worker near ${vlabel}`,
          shortMessage: `Worker is close to the ${vlabel} path`,
          spokenMessage: `Step back from the ${vlabel} path.`,
          bbox: person.bbox,
          relatedTrackIds: [person.id, vehicle.id],
          confidence: Math.min(person.confidence, vehicle.confidence),
          persistenceMs: Math.max(PERSISTENCE(person), PERSISTENCE(vehicle)),
          recommendedAction: `Keep clear of the ${vlabel}. Move to a safe distance.`,
          wearablePattern: severity === "high" ? "urgent-pulse" : "double-tap",
        });
      }
    }
  }

  // 2 — Person entering a restricted/danger zone.
  const restricted = zones.filter((z) => z.kind === "restricted");
  for (const person of stablePersons) {
    for (const z of restricted) {
      if (inZone(person.bbox, z)) {
        out.push({
          id: nextId(),
          severity: "high",
          category: "zone",
          title: "Worker in restricted zone",
          shortMessage: `Worker entered ${z.label ?? "a restricted zone"}`,
          spokenMessage: "Leave the restricted zone.",
          bbox: person.bbox,
          relatedTrackIds: [person.id],
          confidence: person.confidence,
          persistenceMs: PERSISTENCE(person),
          recommendedAction: `Exit ${z.label ?? "the restricted zone"} unless authorised.`,
          wearablePattern: "urgent-pulse",
        });
      }
    }
  }

  // 4 / 8 — Blocked exit / walkway (exit zones or detected exit signs occupied).
  const exitZones = zones.filter((z) => z.kind === "exit");
  for (const z of exitZones) {
    const blocker = tracks.find(
      (t) =>
        (t.category === "trip-hazard" || t.category === "equipment" || t.category === "vehicle") &&
        t.stable &&
        inZone(t.bbox, z),
    );
    if (blocker) {
      out.push({
        id: nextId(),
        severity: "high",
        category: "blocked-access",
        title: "Blocked exit / walkway",
        shortMessage: `${z.label ?? "Exit"} appears blocked`,
        spokenMessage: "Stop and clear the blocked walkway.",
        bbox: blocker.bbox,
        relatedTrackIds: [blocker.id],
        confidence: blocker.confidence,
        persistenceMs: PERSISTENCE(blocker),
        recommendedAction: `Clear ${z.label ?? "the exit"} — keep egress routes free.`,
        wearablePattern: "urgent-pulse",
      });
    }
  }

  // 5 — Fall hazard proximity (ladder / scaffold + person near).
  const fallHazards = tracks.filter((t) => t.category === "fall-hazard" && t.stable);
  for (const person of stablePersons) {
    for (const fh of fallHazards) {
      if (gap(person.bbox, fh.bbox) < 0.2 || iou(person.bbox, fh.bbox) > 0.05) {
        out.push({
          id: nextId(),
          severity: "medium",
          category: "proximity",
          title: `Worker at ${fh.normalizedLabel}`,
          shortMessage: `Worker is using/near a ${fh.normalizedLabel}`,
          spokenMessage: `Check fall protection at the ${fh.normalizedLabel}.`,
          bbox: person.bbox,
          relatedTrackIds: [person.id, fh.id],
          confidence: Math.min(person.confidence, fh.confidence),
          persistenceMs: PERSISTENCE(person),
          recommendedAction: `Confirm fall protection before working on the ${fh.normalizedLabel}.`,
          wearablePattern: "double-tap",
        });
      }
    }
  }

  // 7 — Trip / slip hazard near a worker (cables, boxes, spills).
  const tripHazards = tracks.filter((t) => t.category === "trip-hazard" && t.stable);
  for (const person of stablePersons) {
    for (const th of tripHazards) {
      if (gap(person.bbox, th.bbox) < 0.18) {
        const slip = th.normalizedLabel === "slip-hazard";
        out.push({
          id: nextId(),
          severity: slip ? "medium" : "low",
          category: "trip-slip",
          title: slip ? "Slip hazard near worker" : "Trip hazard near worker",
          shortMessage: slip
            ? "Possible slippery area near the worker"
            : "Possible trip hazard near the worker",
          spokenMessage: slip ? "Mind the slippery floor." : "Watch your footing.",
          bbox: th.bbox,
          relatedTrackIds: [person.id, th.id],
          confidence: th.confidence,
          persistenceMs: PERSISTENCE(th),
          recommendedAction: slip
            ? "Clean/flag the slippery area before continuing."
            : "Clear or flag the obstruction on the walkway.",
          wearablePattern: "soft-tap",
        });
      }
    }
  }

  // 6 — Ergonomic posture risk from pose (cautious; needs a pose).
  for (const person of stablePersons) {
    const obs = observations.find((o) => o.pose && o.bbox && iou(o.bbox, person.bbox) > 0.3);
    if (obs?.pose && isStooped(obs.pose)) {
      out.push({
        id: nextId(),
        severity: "low",
        category: "ergonomics",
        title: "Possible unsafe posture",
        shortMessage: "Worker may be lifting/bending unsafely",
        spokenMessage: "Bend your knees, keep your back straight.",
        bbox: person.bbox,
        relatedTrackIds: [person.id],
        confidence: obs.confidence,
        persistenceMs: PERSISTENCE(person),
        recommendedAction: "Use safe lifting posture — keep the back straight.",
        wearablePattern: "soft-tap",
      });
    }
  }

  // 3 — PPE (cautious): only when policy requires it AND a worker is stable.
  //     We never assert "no PPE"; we flag that PPE is not visible.
  if (ppeRequired) {
    const ppe = tracks.filter((t) => t.category === "ppe");
    for (const person of stablePersons) {
      const hasHead = ppe.some(
        (p) => p.normalizedLabel === "ppe-head" && iou(p.bbox, person.bbox) > 0.02,
      );
      if (!hasHead) {
        out.push({
          id: nextId(),
          severity: "medium",
          category: "ppe",
          title: "PPE not visible",
          shortMessage: "Head PPE not visible on the worker",
          spokenMessage: "Check PPE before entering.",
          bbox: person.bbox,
          relatedTrackIds: [person.id],
          confidence: person.confidence * 0.7,
          persistenceMs: PERSISTENCE(person),
          recommendedAction: "Confirm required PPE is worn before entering the area.",
          wearablePattern: "double-tap",
        });
      }
    }
  }

  // 9 / 10 — Unknown persistent object near a worker → scene review.
  const unknowns = tracks.filter((t) => t.category === "unknown" && t.stable && t.confidence < 0.5);
  for (const person of stablePersons) {
    for (const u of unknowns) {
      if (gap(person.bbox, u.bbox) < 0.15) {
        out.push({
          id: nextId(),
          severity: "info",
          category: "unknown-review",
          title: "Scene requires review",
          shortMessage: "Unidentified object near the worker",
          spokenMessage: "Review the area near the worker.",
          bbox: u.bbox,
          relatedTrackIds: [person.id, u.id],
          confidence: u.confidence,
          persistenceMs: PERSISTENCE(u),
          recommendedAction: "Visually check the unidentified object before proceeding.",
          wearablePattern: "none",
        });
        break;
      }
    }
  }

  return out;
}

/** Cautious "stooped" heuristic: shoulders well below hips' expected line. */
function isStooped(pose: {
  keypoints: { name: string; x: number; y: number; score: number }[];
}): boolean {
  const kp = (n: string) => pose.keypoints.find((k) => k.name === n && k.score > 0.2);
  const ls = kp("left_shoulder");
  const rs = kp("right_shoulder");
  const lh = kp("left_hip");
  const rh = kp("right_hip");
  if (!ls || !rs || !lh || !rh) return false;
  const shoulderY = (ls.y + rs.y) / 2;
  const hipY = (lh.y + rh.y) / 2;
  // Torso nearly horizontal → shoulders close to or below hips.
  return shoulderY > hipY - 0.08;
}
