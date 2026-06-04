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

interface PersonTrack {
  id: string;
  box: BBox;
  lastSeen: number;
}

export interface TrackedPerson {
  id: string;
  box: BBox;
}

/**
 * Lightweight greedy tracker that keeps stable ids (p1, p2, …) across frames.
 * Not ByteTrack/BoT-SORT — just enough to form stable person-pair keys so the
 * RiskEngine doesn't see flickering identities. Real tracking comes with YOLO.
 */
export class PersonTracker {
  private tracks: PersonTrack[] = [];
  private nextId = 1;
  constructor(private expireMs = 900) {}

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  update(boxes: BBox[], now: number): TrackedPerson[] {
    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.expireMs);
    const used = new Set<number>();
    const out: TrackedPerson[] = [];

    for (const box of boxes) {
      let best = -1;
      let bestScore = 0;
      for (let i = 0; i < this.tracks.length; i++) {
        if (used.has(i)) continue;
        const iou = boxIoU(box, this.tracks[i].box);
        let s = iou;
        if (s === 0) {
          const c1 = boxCenter(box);
          const c2 = boxCenter(this.tracks[i].box);
          s = Math.max(0, 0.3 - Math.hypot(c1.x - c2.x, c1.y - c2.y));
        }
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      }

      if (best >= 0 && bestScore > 0.02) {
        this.tracks[best].box = box;
        this.tracks[best].lastSeen = now;
        used.add(best);
        out.push({ id: this.tracks[best].id, box });
      } else {
        const id = `p${this.nextId++}`;
        this.tracks.push({ id, box, lastSeen: now });
        used.add(this.tracks.length - 1);
        out.push({ id, box });
      }
    }
    return out;
  }
}
