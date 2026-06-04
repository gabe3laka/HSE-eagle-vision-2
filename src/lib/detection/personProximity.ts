import type { BBox } from "./types";

/** Visual-proximity score at/above which a person_proximity observation is emitted. */
export const PROXIMITY_EMIT_THRESHOLD = 0.55;
/** Score at/above which proximity is considered strong. */
export const PROXIMITY_STRONG_THRESHOLD = 0.75;

export interface Point {
  x: number;
  y: number;
}

export function boxCenter(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function boxBottomCenter(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h };
}

/** Intersection-over-union of two normalized boxes (0 = disjoint, 1 = identical). */
export function boxIoU(a: BBox, b: BBox): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Shortest gap between the box edges (0 when the boxes overlap or touch). */
export function edgeGap(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Smallest box that covers both inputs (used as the alert bbox for a pair). */
export function unionBox(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Centre distance divided by the average person height (camera-scale aware). */
export function normalizedDistanceByHeight(a: BBox, b: BBox): number {
  const ca = boxCenter(a);
  const cb = boxCenter(b);
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const avgH = (a.h + b.h) / 2 || 1e-6;
  return dist / avgH;
}

/** Stable, order-independent key for a person pair. */
export function makePairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join("-");
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export interface ProximityResult {
  score: number; // 0..1 visual proximity (NOT metres)
  iou: number;
  edgeGap: number;
  normDist: number;
  sameFloor: number; // 0..1 likelihood both are on the same plane
}

/**
 * Visual person-to-person proximity from two pose-derived boxes. This is a
 * screen-space estimate — NOT a calibrated real-world distance. It combines
 * scale-normalized centre distance, edge gap and overlap, and is reduced when
 * the two people sit on clearly different floor planes (different foot levels).
 */
export function scorePersonProximity(a: BBox, b: BBox): ProximityResult {
  const iou = boxIoU(a, b);
  const gap = edgeGap(a, b);
  const normDist = normalizedDistanceByHeight(a, b);
  const avgH = (a.h + b.h) / 2 || 1e-6;

  // similar foot level → likely same depth/plane
  const bottomDiff = Math.abs(a.y + a.h - (b.y + b.h)) / avgH;
  const sameFloor = clamp(1 - bottomDiff / 0.6, 0, 1);

  // near (small normalized distance) → high
  const distScore = clamp((1.8 - normDist) / (1.8 - 0.6), 0, 1);
  // small edge gap relative to height → high
  const gapScore = clamp(1 - gap / avgH / 0.8, 0, 1);

  let score = 0.45 * distScore + 0.3 * gapScore + 0.25 * Math.min(1, iou * 2);
  score *= 0.5 + 0.5 * sameFloor; // different floor halves the score
  return { score: clamp(score, 0, 1), iou, edgeGap: gap, normDist, sameFloor };
}

// ── Simple frame-to-frame person tracker (IoU first, centre distance second) ──

/**
 * A tracked person must be seen on at least this many processed frames before
 * it is "stable" and allowed to emit hazards. This is what stops a one-frame
 * hallucinated pose from ever creating an alert/incident.
 */
export const MIN_STABLE_FRAMES = 3;

// Per-track centre-velocity model (ByteTrack-style motion prediction). The EMA
// smooths the estimate; MAX_VELOCITY (normalized units per ms) bounds it so a
// noisy frame can't fling a track across the frame.
const VELOCITY_SMOOTHING = 0.5;
const MAX_VELOCITY = 0.002;

interface PersonTrack {
  id: string;
  box: BBox;
  vx: number; // smoothed centre velocity (normalized units per ms)
  vy: number;
  firstSeen: number;
  lastSeen: number;
  framesSeen: number;
  quality: number;
}

export interface TrackedPerson {
  id: string;
  box: BBox;
  /**
   * Index of this person's box in the `boxes` array passed to `update()`. Lets a
   * caller map a stable id back to its own per-frame input (e.g. the matching pose
   * analysis) without assuming the output order matches the input order.
   */
  sourceIndex: number;
  firstSeen: number;
  lastSeen: number;
  framesSeen: number; // processed frames this id has been seen on
  qualityScore: number; // latest accepted-pose quality for this id
  jumpScore: number; // box centre jump vs last frame, height-normalized (0 = no jump)
  stable: boolean; // framesSeen >= MIN_STABLE_FRAMES
}

/**
 * Lightweight tracker keeping stable ids (p1, p2, …) across frames. Inspired by
 * ByteTrack's motion model + lost-track buffer (without a full Kalman filter or
 * camera-motion compensation): each track carries a smoothed centre velocity and
 * is matched against its *predicted* position, and an unmatched track is kept
 * alive for `expireMs` so a brief miss / short occlusion re-acquires the SAME id
 * rather than re-numbering. Still not BoT-SORT — that arrives with YOLO.
 */
export class PersonTracker {
  private tracks: PersonTrack[] = [];
  private nextId = 1;
  // expireMs doubles as the lost-track buffer: how long an unseen track survives
  // (still motion-predicted) so a brief miss/occlusion re-acquires the same id.
  constructor(private expireMs = 1200) {}

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  /** Track box motion-predicted forward to `now` (centre translation only). */
  private predict(t: PersonTrack, now: number): BBox {
    const dt = Math.max(0, now - t.lastSeen);
    if (dt === 0) return t.box;
    return {
      x: clamp(t.box.x + t.vx * dt, 0, 1 - t.box.w),
      y: clamp(t.box.y + t.vy * dt, 0, 1 - t.box.h),
      w: t.box.w,
      h: t.box.h,
    };
  }

  /**
   * Match this frame's (already accepted) person boxes to existing tracks.
   * `qualities[i]` is the optional pose-quality of `boxes[i]`. Returns one
   * TrackedPerson per input box, in input order, with a stable id, sourceIndex
   * and stability metadata.
   */
  update(boxes: BBox[], now: number, qualities?: number[]): TrackedPerson[] {
    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.expireMs);
    const used = new Set<number>();
    const out: TrackedPerson[] = [];

    for (let sourceIndex = 0; sourceIndex < boxes.length; sourceIndex++) {
      const box = boxes[sourceIndex];
      const quality = qualities?.[sourceIndex] ?? 1;
      let best = -1;
      let bestScore = 0;
      for (let i = 0; i < this.tracks.length; i++) {
        if (used.has(i)) continue;
        const predicted = this.predict(this.tracks[i], now);
        let score = boxIoU(box, predicted);
        if (score === 0) {
          const c1 = boxCenter(box);
          const c2 = boxCenter(predicted);
          score = Math.max(0, 0.3 - Math.hypot(c1.x - c2.x, c1.y - c2.y));
        }
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }

      if (best >= 0 && bestScore > 0.02) {
        const t = this.tracks[best];
        const dt = Math.max(1, now - t.lastSeen);
        const prevC = boxCenter(t.box);
        const newC = boxCenter(box);
        const avgH = (t.box.h + box.h) / 2 || 1e-6;
        const jumpScore = Math.hypot(prevC.x - newC.x, prevC.y - newC.y) / avgH;
        // EMA-update the centre velocity, bounded by MAX_VELOCITY
        t.vx = clamp(
          (1 - VELOCITY_SMOOTHING) * t.vx + (VELOCITY_SMOOTHING * (newC.x - prevC.x)) / dt,
          -MAX_VELOCITY,
          MAX_VELOCITY,
        );
        t.vy = clamp(
          (1 - VELOCITY_SMOOTHING) * t.vy + (VELOCITY_SMOOTHING * (newC.y - prevC.y)) / dt,
          -MAX_VELOCITY,
          MAX_VELOCITY,
        );
        t.box = box;
        t.lastSeen = now;
        t.framesSeen++;
        t.quality = quality;
        used.add(best);
        out.push({
          id: t.id,
          box,
          sourceIndex,
          firstSeen: t.firstSeen,
          lastSeen: now,
          framesSeen: t.framesSeen,
          qualityScore: quality,
          jumpScore,
          stable: t.framesSeen >= MIN_STABLE_FRAMES,
        });
      } else {
        const id = `p${this.nextId++}`;
        this.tracks.push({
          id,
          box,
          vx: 0,
          vy: 0,
          firstSeen: now,
          lastSeen: now,
          framesSeen: 1,
          quality,
        });
        used.add(this.tracks.length - 1);
        out.push({
          id,
          box,
          sourceIndex,
          firstSeen: now,
          lastSeen: now,
          framesSeen: 1,
          qualityScore: quality,
          jumpScore: 0,
          stable: MIN_STABLE_FRAMES <= 1,
        });
      }
    }
    return out;
  }
}
