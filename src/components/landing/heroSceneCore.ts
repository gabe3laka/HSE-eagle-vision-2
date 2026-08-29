/**
 * Pure geometry + authored data for the landing HeroScene — kept React-free so
 * it is unit-testable, matching the xrayLensCore.ts convention.
 *
 * HONESTY RULE: every number here is AUTHORED, not computed by any model. The
 * scene is an illustrated example and is labelled as such in the UI. Numbers
 * must stay plausible against the real 5×5 matrix (severity 1–5 × likelihood
 * 1–5, score = product) so a safety professional doesn't wince.
 */

export interface HeroSceneObject {
  id: string;
  label: string;
  /** Outline tint — the Live category palette (person cyan, vehicle amber,
   *  access/egress sky), reused so the two lenses read as one product. */
  tint: string;
  /** Normalized 0..1 bbox in scene space. */
  bbox: { x: number; y: number; w: number; h: number };
  level: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  severity: number; // 1..5, authored
  likelihood: number; // 1..5, authored
  reason: string;
}

/** The story: the forklift-near-worker pairing and the blocked exit are the
 *  two that read RED/ORANGE — everything else stays quiet. */
export const SCENE_OBJECTS: HeroSceneObject[] = [
  {
    id: "forklift",
    label: "forklift",
    tint: "rgba(251,191,36,0.95)",
    bbox: { x: 0.448, y: 0.49, w: 0.13, h: 0.39 },
    level: "RED",
    severity: 4,
    likelihood: 4,
    reason: "Crossing a pedestrian route with a worker inside 3 m",
  },
  {
    id: "worker",
    label: "person",
    tint: "rgba(34,211,238,0.9)",
    bbox: { x: 0.383, y: 0.6, w: 0.046, h: 0.25 },
    level: "YELLOW",
    severity: 3,
    likelihood: 2,
    reason: "On foot in a vehicle operating area",
  },
  {
    id: "exit",
    label: "exit route",
    tint: "rgba(125,211,252,0.9)",
    bbox: { x: 0.768, y: 0.2, w: 0.135, h: 0.44 },
    level: "ORANGE",
    severity: 4,
    likelihood: 3,
    reason: "Emergency exit partially blocked by stored pallets",
  },
  {
    id: "pallets",
    label: "pallet stack",
    tint: "rgba(251,191,36,0.7)",
    bbox: { x: 0.066, y: 0.535, w: 0.16, h: 0.295 },
    level: "GREEN",
    severity: 2,
    likelihood: 2,
    reason: "Stable stack, within height limit",
  },
];

/** Floor-marked pedestrian walkway that the forklift is crossing (normalized
 *  points, drawn dashed in the base scene and hatched in the sensor view). */
export const ZONE_POINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.5025, y: 0.511 }, // near the wall, left edge
  { x: 0.5419, y: 0.511 }, // near the wall, right edge
  { x: 0.475, y: 0.985 }, // front right
  { x: 0.2875, y: 0.985 }, // front left
];

/** Slice-fit of the 160×90 scene into a box: scale + centred offsets. */
export function sliceLayout(w: number, h: number) {
  const s = Math.max(w / 160, h / 90);
  return { w, h, s, ox: (w - 160 * s) / 2, oy: (h - 90 * s) / 2 };
}
export type Layout = ReturnType<typeof sliceLayout>;

/** Map an ART-normalized point (0..1 of the 160×90 scene) to box pixels under
 *  the slice fit. On a card the two spaces nearly coincide; on a full-bleed
 *  portrait backdrop the art is cropped hard and they diverge — the sweep is
 *  authored in art space and must land on the forklift, not on 48% of the
 *  viewport. */
export function artToBox(nx: number, ny: number, L: Layout): { x: number; y: number } {
  return { x: L.ox + nx * 160 * L.s, y: L.oy + ny * 90 * L.s };
}

export function riskScore(o: Pick<HeroSceneObject, "severity" | "likelihood">): number {
  return o.severity * o.likelihood;
}

/** Same tile format the app renders over live detections. */
export function riskTileText(o: HeroSceneObject): string {
  return `[${o.level}] S${o.severity}×L${o.likelihood}=${riskScore(o)} · rules`;
}

/** Keep the lens center inside the scene box (px space). */
export function clampLensCenter(
  x: number,
  y: number,
  box: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), Math.max(box.w, 0)),
    y: Math.min(Math.max(y, 0), Math.max(box.h, 0)),
  };
}

export interface SweepPoint {
  x: number; // normalized 0..1
  y: number;
  pauseMs: number; // dwell after arriving
}

const center = (id: string) => {
  const o = SCENE_OBJECTS.find((s) => s.id === id)!;
  return { x: o.bbox.x + o.bbox.w / 2, y: o.bbox.y + o.bbox.h / 2 };
};

/** Left edge → forklift (pause) → blocked exit (pause) → wrap. The pauses are
 *  the demo: they hold the lens over the two tiles that tell the story. */
export const SWEEP_PATH: SweepPoint[] = [
  { x: 0.12, y: 0.62, pauseMs: 0 },
  // Dwell up-left of the forklift's centre so the RED plate, the operator and
  // the worker all sit inside the glass at the pause — on a phone's tighter
  // crop as well as on desktop.
  { x: center("forklift").x - 0.03, y: center("forklift").y - 0.1, pauseMs: 1200 },
  { ...center("exit"), y: center("exit").y - 0.07, pauseMs: 1200 },
];

export const SWEEP_TRAVEL_MS = 2600;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Position along the looped sweep at elapsed time t (ms). Each leg travels
 *  `travelMs`, then dwells `pauseMs` at its destination; the path wraps from
 *  the last point back to the first. Pure and deterministic. */
export function sweepPosition(
  tMs: number,
  path: SweepPoint[] = SWEEP_PATH,
  travelMs: number = SWEEP_TRAVEL_MS,
): { x: number; y: number } {
  if (path.length === 0) return { x: 0.5, y: 0.5 };
  if (path.length === 1) return { x: path[0].x, y: path[0].y };
  const legs = path.map((_, i) => {
    const to = path[(i + 1) % path.length];
    return travelMs + to.pauseMs;
  });
  const cycle = legs.reduce((a, b) => a + b, 0);
  let t = ((tMs % cycle) + cycle) % cycle;
  for (let i = 0; i < path.length; i++) {
    const from = path[i];
    const to = path[(i + 1) % path.length];
    if (t < travelMs) {
      const k = easeInOut(t / travelMs);
      return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    }
    t -= travelMs;
    if (t < to.pauseMs) return { x: to.x, y: to.y };
    t -= to.pauseMs;
  }
  return { x: path[0].x, y: path[0].y };
}
