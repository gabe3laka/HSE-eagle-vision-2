import type { BlueprintAnchor, BlueprintFrame, SelectedRegion } from "../types";

/**
 * Pure blueprint helpers: the local mock generator (used when the backend
 * /build/* routes don't exist yet) and the replay interpolation math. No DOM,
 * no network — unit-testable in the node test env.
 *
 * All geometry is normalized 0..1 LOCAL to the selected region box.
 */

const TAU = Math.PI * 2;

/** Deterministic pseudo-random in [0,1) from a seed — keeps mocks stable per frame. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32 — tiny, deterministic, good enough for jittered mock geometry
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Build the ghost outline for a mock frame: an inset rounded-rectangle ring of
 * 12 points with a subtle per-frame "breathing" jitter so replay visibly moves.
 */
export function mockOutline(frameIndex: number): Array<{ x: number; y: number }> {
  const rand = seeded(97 + frameIndex * 13);
  const inset = 0.08;
  const cx = 0.5;
  const cy = 0.5;
  const rx = 0.5 - inset;
  const ry = 0.5 - inset;
  const pts: Array<{ x: number; y: number }> = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    // squarish superellipse so it reads as a panel/part outline, not a circle
    const sx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.6);
    const sy = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.6);
    const jitter = (rand() - 0.5) * 0.02;
    pts.push({
      x: clamp01(cx + sx * (rx + jitter)),
      y: clamp01(cy + sy * (ry + jitter)),
    });
  }
  return pts;
}

/** 4–8 sparse anchors: 4 corners plus up to 4 jittered interior points. */
export function mockAnchors(frameIndex: number): BlueprintAnchor[] {
  const rand = seeded(31 + frameIndex * 7);
  const corner = 0.12;
  const anchors: BlueprintAnchor[] = [
    { id: "a-tl", x: corner, y: corner, label: "A1" },
    { id: "a-tr", x: 1 - corner, y: corner, label: "A2" },
    { id: "a-br", x: 1 - corner, y: 1 - corner, label: "A3" },
    { id: "a-bl", x: corner, y: 1 - corner, label: "A4" },
  ];
  const extras = 2 + Math.floor(rand() * 3); // 2..4 extras -> 6..8 total
  for (let i = 0; i < extras; i++) {
    anchors.push({
      id: `a-x${i}`,
      x: clamp01(0.25 + rand() * 0.5),
      y: clamp01(0.25 + rand() * 0.5),
      confidence: 0.5 + rand() * 0.5,
    });
  }
  return anchors;
}

/** Step marker roughly every ~2s of capture, walking across the region. */
const MOCK_STEP_EVERY = 6; // every 6th keyframe (~2s at 3 FPS)

/**
 * Local mock of what the backend's blueprint extraction would return for one
 * selected-crop keyframe. Geometry is region-local (0..1).
 */
export function mockBlueprintFrame(
  sessionId: string,
  frameIndex: number,
  timestampMs: number,
  _region: SelectedRegion,
): BlueprintFrame {
  const stepCount = Math.floor(frameIndex / MOCK_STEP_EVERY) + 1;
  const stepMarkers = Array.from({ length: stepCount }, (_, i) => {
    const rand = seeded(7 + i * 101);
    return {
      id: `step-${i + 1}`,
      label: `${i + 1}`,
      x: clamp01(0.18 + rand() * 0.64),
      y: clamp01(0.18 + rand() * 0.64),
      timestampMs: i * MOCK_STEP_EVERY * 333,
    };
  });
  return {
    sessionId,
    frameId: `f-${frameIndex}`,
    timestampMs,
    outline: mockOutline(frameIndex),
    anchors: mockAnchors(frameIndex),
    stepMarkers,
    instruction: `Step ${stepCount} — follow the highlighted anchors`,
  };
}

/** Linear interpolation between two frames' geometry (same-index mapping). */
export function interpolateFrames(a: BlueprintFrame, b: BlueprintFrame, t: number): BlueprintFrame {
  const k = Math.max(0, Math.min(1, t));
  const lerp = (p: number, q: number) => p + (q - p) * k;
  const outline =
    a.outline.length === b.outline.length
      ? a.outline.map((p, i) => ({ x: lerp(p.x, b.outline[i].x), y: lerp(p.y, b.outline[i].y) }))
      : (k < 0.5 ? a : b).outline;
  const byId = new Map(b.anchors.map((an) => [an.id, an]));
  const anchors = a.anchors.map((an) => {
    const bn = byId.get(an.id);
    return bn ? { ...an, x: lerp(an.x, bn.x), y: lerp(an.y, bn.y) } : an;
  });
  const base = k < 0.5 ? a : b;
  return { ...base, outline, anchors };
}

/**
 * Resolve the (possibly interpolated) frame at `tMs` on the replay timeline.
 * Outside the recorded range it clamps to the first/last keyframe.
 */
export function blueprintFrameAt(frames: BlueprintFrame[], tMs: number): BlueprintFrame | null {
  if (frames.length === 0) return null;
  if (tMs <= frames[0].timestampMs) return frames[0];
  const last = frames[frames.length - 1];
  if (tMs >= last.timestampMs) return last;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (tMs >= a.timestampMs && tMs <= b.timestampMs) {
      const span = b.timestampMs - a.timestampMs;
      const t = span > 0 ? (tMs - a.timestampMs) / span : 0;
      return interpolateFrames(a, b, t);
    }
  }
  return last;
}

/** Total replay duration in ms (timestamp of the last keyframe). */
export function replayDurationMs(frames: BlueprintFrame[]): number {
  return frames.length ? frames[frames.length - 1].timestampMs : 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
