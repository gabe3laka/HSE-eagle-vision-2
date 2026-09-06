/**
 * captureEngine.ts — PURE keyframe scheduler for Site/Object scans.
 *
 * No DOM, no timers, no Date.now(): every decision is a function of the
 * samples pushed in (stability, orientation) and the candidate offered, so the
 * same inputs always yield the same kept frames (determinism is unit-tested).
 *
 *   scheduler.pushStability(sample)     // IMU — same shape as useCameraStability
 *   scheduler.pushOrientation(sample)   // compass/pitch — same shape as useDeviceOrientation
 *   scheduler.offer(candidate)          // → keep / drop + reason
 *   scheduler.coverage()                // → 0..1 progress + detail
 *   scheduler.coachLine()               // → "move slower", "more overlap", "orbit 40% complete"
 */

import {
  SCAN_BLUR_THRESHOLD,
  SCAN_CAPTURE_INTERVAL_MS,
  SCAN_DUPLICATE_HEADING_DEG,
  SCAN_DUPLICATE_THRESHOLD,
  SCAN_HEADING_BINS_OBJECT,
  SCAN_HEADING_BINS_SITE,
  SCAN_SITE_TARGET_FRAMES,
  maxFramesFor,
  type ScanMode,
} from "../config";
import type {
  CaptureDecision,
  CoverageScore,
  DropReason,
  FrameCandidate,
  KeptFrame,
  OrientationSample,
  StabilitySample,
} from "../types";

// -- pure image helpers ------------------------------------------------------

/**
 * Variance of the 4-neighbour Laplacian over an 8-bit grey thumbnail. Sharp
 * frames have strong edges → high variance; motion blur flattens it. Border
 * pixels are skipped. Returns 0 for degenerate inputs.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean absolute difference between two equally sized grey thumbnails. */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 255;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += Math.abs(a[i] - b[i]);
  return acc / n;
}

/** Smallest signed angle a→b in degrees, in (-180, 180]. */
export function headingDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 540) % 360;
  d -= 180;
  return d === -180 ? 180 : d;
}

// -- scheduler ---------------------------------------------------------------

export interface CaptureSchedulerOptions {
  mode: ScanMode;
  intervalMs?: number;
  maxFrames?: number;
  blurThreshold?: number;
  duplicateThreshold?: number;
  duplicateHeadingDeg?: number;
  /** How long after the IMU last reported motion a frame is still "moving". */
  motionSettleMs?: number;
}

export class CaptureScheduler {
  readonly mode: ScanMode;
  readonly intervalMs: number;
  readonly maxFrames: number;
  readonly blurThreshold: number;
  readonly duplicateThreshold: number;
  readonly duplicateHeadingDeg: number;
  readonly motionSettleMs: number;

  private kept: KeptFrame[] = [];
  private lastKeptTs: number | null = null;
  private lastKeptThumb: Uint8Array | null = null;
  private lastKeptHeading: number | null = null;
  private lastMovingTs: number | null = null;
  private orientation: OrientationSample | null = null;
  private headingBins: Set<number> = new Set();
  private orbitVisited: Set<number> = new Set();
  private drops: Record<DropReason, number> = {
    too_soon: 0,
    moving: 0,
    blurry: 0,
    duplicate: 0,
    cap_reached: 0,
  };
  private recentDrops: DropReason[] = [];

  constructor(opts: CaptureSchedulerOptions) {
    this.mode = opts.mode;
    this.intervalMs = opts.intervalMs ?? SCAN_CAPTURE_INTERVAL_MS;
    this.maxFrames = opts.maxFrames ?? maxFramesFor(opts.mode);
    this.blurThreshold = opts.blurThreshold ?? SCAN_BLUR_THRESHOLD;
    this.duplicateThreshold = opts.duplicateThreshold ?? SCAN_DUPLICATE_THRESHOLD;
    this.duplicateHeadingDeg = opts.duplicateHeadingDeg ?? SCAN_DUPLICATE_HEADING_DEG;
    this.motionSettleMs = opts.motionSettleMs ?? 250;
  }

  get keptFrames(): readonly KeptFrame[] {
    return this.kept;
  }

  get dropCounts(): Readonly<Record<DropReason, number>> {
    return this.drops;
  }

  get capReached(): boolean {
    return this.kept.length >= this.maxFrames;
  }

  pushStability(sample: StabilitySample): void {
    if (sample.isMoving) this.lastMovingTs = sample.ts;
  }

  pushOrientation(sample: OrientationSample): void {
    this.orientation = sample;
  }

  private isMovingAt(ts: number): boolean {
    return this.lastMovingTs !== null && ts - this.lastMovingTs <= this.motionSettleMs;
  }

  private drop(reason: DropReason, sharpness: number, diff: number | null): CaptureDecision {
    this.drops[reason]++;
    this.recentDrops.push(reason);
    if (this.recentDrops.length > 8) this.recentDrops.shift();
    return { keep: false, reason, sharpness, diff };
  }

  /** Offer one candidate; returns the decision and, when kept, the tagged frame. */
  offer(candidate: FrameCandidate): CaptureDecision {
    const { ts } = candidate;
    if (this.capReached) return this.drop("cap_reached", 0, null);
    if (this.lastKeptTs !== null && ts - this.lastKeptTs < this.intervalMs) {
      return this.drop("too_soon", 0, null);
    }
    if (this.isMovingAt(ts)) return this.drop("moving", 0, null);

    const sharpness = laplacianVariance(candidate.gray, candidate.width, candidate.height);
    if (sharpness < this.blurThreshold) return this.drop("blurry", sharpness, null);

    const heading = this.orientation?.headingDeg ?? null;
    let diff: number | null = null;
    if (this.lastKeptThumb) {
      diff = meanAbsDiff(candidate.gray, this.lastKeptThumb);
      const swung =
        heading !== null &&
        this.lastKeptHeading !== null &&
        Math.abs(headingDelta(this.lastKeptHeading, heading)) > this.duplicateHeadingDeg;
      if (diff < this.duplicateThreshold && !swung) {
        return this.drop("duplicate", sharpness, diff);
      }
    }

    const frame: KeptFrame = { seq: this.kept.length, ts };
    if (heading !== null) frame.headingDeg = heading;
    const pitch = this.orientation?.pitchDeg ?? null;
    if (pitch !== null) frame.pitchDeg = pitch;

    this.kept.push(frame);
    this.lastKeptTs = ts;
    this.lastKeptThumb = Uint8Array.from(candidate.gray as ArrayLike<number>);
    this.lastKeptHeading = heading;
    this.recentDrops = [];

    if (heading !== null) {
      const bins = this.mode === "site" ? SCAN_HEADING_BINS_SITE : SCAN_HEADING_BINS_OBJECT;
      const bin = Math.floor((((heading % 360) + 360) % 360) / (360 / bins)) % bins;
      this.headingBins.add(bin);
      if (this.mode === "object") this.orbitVisited.add(bin);
    }

    return { keep: true, reason: "kept", frame, sharpness, diff };
  }

  coverage(): CoverageScore {
    const keptFrames = this.kept.length;
    if (this.mode === "site") {
      const pathSeconds = (keptFrames * this.intervalMs) / 1000;
      const headingCoverage = this.headingBins.size / SCAN_HEADING_BINS_SITE;
      const frameProgress = Math.min(1, keptFrames / SCAN_SITE_TARGET_FRAMES);
      // Path length dominates a walkthrough; turn coverage keeps loops closing.
      const score = Math.min(1, 0.6 * frameProgress + 0.4 * headingCoverage);
      return { score, keptFrames, headingCoverage, orbitDeg: 0, pathSeconds };
    }
    const binDeg = 360 / SCAN_HEADING_BINS_OBJECT;
    const orbitDeg = this.orbitVisited.size * binDeg;
    const headingCoverage = this.orbitVisited.size / SCAN_HEADING_BINS_OBJECT;
    // A full orbit at ≥ 3 frames per 10° bin is a complete object scan.
    const density = Math.min(1, keptFrames / (SCAN_HEADING_BINS_OBJECT * 3));
    const score = Math.min(1, 0.75 * headingCoverage + 0.25 * density);
    return { score, keptFrames, headingCoverage, orbitDeg, pathSeconds: 0 };
  }

  /** One-line live coaching for the HUD, derived from the recent drop pattern. */
  coachLine(): string {
    if (this.capReached) return "Frame cap reached — tap Finish";
    const recent = this.recentDrops;
    const count = (r: DropReason) => recent.filter((x) => x === r).length;
    if (count("moving") >= 3 || count("blurry") >= 3) return "Move slower";
    if (count("duplicate") >= 4) {
      return this.mode === "object" ? "Keep circling the machine" : "Keep walking — more overlap";
    }
    const cov = this.coverage();
    if (this.mode === "object") return `Orbit ${Math.round(cov.headingCoverage * 100)}% complete`;
    if (this.kept.length === 0) return "Start walking slowly";
    if (cov.headingCoverage < 0.5) return "Turn to cover every wall";
    return `Walkthrough ${Math.round(cov.score * 100)}% complete`;
  }
}
