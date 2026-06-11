import type { BBox } from "./types";
import type { HSEObservation, HSETrack } from "./hseTypes";
import { iou } from "./hseEntityMapper";

/**
 * Phase 3 — temporal object tracking. Matches this frame's observations to
 * existing tracks by bbox IoU + same category, assigns STABLE ids, smooths the
 * box, keeps missing tracks alive briefly (anti-flicker), and marks a track
 * "stable" only after it persists. Wearable alerts must not fire on a single
 * jittery frame, so the risk engine reads `stable`/`ageMs` from here.
 */

export interface HSETrackerConfig {
  /** Min IoU to associate an observation with an existing track. */
  matchIou: number;
  /** A track is "stable" after this age OR this many sightings. */
  stableAfterMs: number;
  stableAfterCount: number;
  /** Keep a missing track alive this long before dropping it. */
  ttlMs: number;
  /** Box smoothing factor (0 = frozen, 1 = snap to latest). */
  smoothing: number;
}

export const DEFAULT_TRACKER_CONFIG: HSETrackerConfig = {
  matchIou: 0.3,
  stableAfterMs: 700,
  stableAfterCount: 2,
  ttlMs: 1200,
  smoothing: 0.5,
};

let trackSeq = 0;

interface InternalTrack extends HSETrack {
  lastObsId: string;
}

export class HSETracker {
  private tracks = new Map<string, InternalTrack>();
  private cfg: HSETrackerConfig;

  constructor(cfg: Partial<HSETrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...cfg };
  }

  reset() {
    this.tracks.clear();
  }

  /** Snapshot of current tracks (stable + recently-missing). */
  list(): HSETrack[] {
    return [...this.tracks.values()].map(stripInternal);
  }

  /**
   * Advance the tracker with one frame of observations. Returns the live track
   * list. Greedy IoU matching (highest overlap first), then unmatched tracks
   * age out, then unmatched observations spawn new tracks.
   */
  update(observations: HSEObservation[], now: number): HSETrack[] {
    const obsWithBox = observations.filter((o) => o.bbox);
    const usedTracks = new Set<string>();
    const usedObs = new Set<string>();

    // Build all candidate (track, obs) pairs, match greedily by IoU.
    const pairs: Array<{ trackId: string; obsIdx: number; score: number }> = [];
    const trackList = [...this.tracks.values()];
    obsWithBox.forEach((o, oi) => {
      for (const t of trackList) {
        if (t.category !== o.category) continue;
        const score = iou(t.bbox, o.bbox!);
        if (score >= this.cfg.matchIou) pairs.push({ trackId: t.id, obsIdx: oi, score });
      }
    });
    pairs.sort((a, b) => b.score - a.score);

    for (const pair of pairs) {
      if (usedTracks.has(pair.trackId) || usedObs.has(String(pair.obsIdx))) continue;
      usedTracks.add(pair.trackId);
      usedObs.add(String(pair.obsIdx));
      const t = this.tracks.get(pair.trackId)!;
      const o = obsWithBox[pair.obsIdx];
      this.updateTrack(t, o, now);
    }

    // Unmatched observations → new tracks.
    obsWithBox.forEach((o, oi) => {
      if (usedObs.has(String(oi))) return;
      const id = `t-${o.category}-${++trackSeq}`;
      this.tracks.set(id, {
        id,
        label: o.label,
        category: o.category,
        normalizedLabel: o.normalizedLabel,
        bbox: o.bbox!,
        confidence: o.confidence,
        firstSeenMs: now,
        lastSeenMs: now,
        ageMs: 0,
        seenCount: 1,
        missingCount: 0,
        stable: false,
        source: o.source,
        lastObsId: o.id,
      });
    });

    // Age out / drop missing tracks.
    for (const [id, t] of this.tracks) {
      if (usedTracks.has(id)) continue;
      t.missingCount += 1;
      if (now - t.lastSeenMs > this.cfg.ttlMs) this.tracks.delete(id);
    }

    return this.list();
  }

  private updateTrack(t: InternalTrack, o: HSEObservation, now: number) {
    const s = this.cfg.smoothing;
    t.bbox = smoothBox(t.bbox, o.bbox!, s);
    t.confidence = Math.max(t.confidence * 0.6, o.confidence);
    const dt = now - t.lastSeenMs;
    if (dt > 0) {
      const vx = (o.bbox!.x - t.bbox.x) / dt;
      const vy = (o.bbox!.y - t.bbox.y) / dt;
      t.velocity = { x: vx, y: vy };
    }
    t.lastSeenMs = now;
    t.ageMs = now - t.firstSeenMs;
    t.seenCount += 1;
    t.missingCount = 0;
    t.label = o.label;
    t.normalizedLabel = o.normalizedLabel;
    t.lastObsId = o.id;
    t.stable = t.ageMs >= this.cfg.stableAfterMs || t.seenCount >= this.cfg.stableAfterCount;
  }
}

function smoothBox(prev: BBox, next: BBox, s: number): BBox {
  return {
    x: prev.x + (next.x - prev.x) * s,
    y: prev.y + (next.y - prev.y) * s,
    w: prev.w + (next.w - prev.w) * s,
    h: prev.h + (next.h - prev.h) * s,
  };
}

function stripInternal(t: InternalTrack): HSETrack {
  const { lastObsId: _drop, ...rest } = t;
  return rest;
}
