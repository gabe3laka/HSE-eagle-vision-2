import { describe, it, expect } from "vitest";
import {
  CaptureScheduler,
  headingDelta,
  laplacianVariance,
  meanAbsDiff,
} from "../features/site-scan/lib/captureEngine";
import { fitLongestSide, rgbaToGray } from "../features/site-scan/lib/frameGrab";
import {
  SCAN_CAPTURE_INTERVAL_MS,
  SCAN_MAT_SPEC,
  SCAN_MAX_FRAMES_OBJECT,
  SCAN_MAX_FRAMES_SITE,
  SCAN_THUMB_H,
  SCAN_THUMB_W,
  isSiteScanEnabled,
  normalizeScanApiUrl,
} from "../features/site-scan/config";
import { scanResultToRow } from "../features/site-scan/hooks/useScanJobs";
import {
  STUB_JOB_POLLS_UNTIL_DONE,
  finishScanSession,
  getScanJob,
  resetScanStub,
  startScanSession,
  uploadScanFrame,
} from "../features/site-scan/api/scanClient";
import type { FrameCandidate } from "../features/site-scan/types";

// -- synthetic thumbnails ----------------------------------------------------

const W = SCAN_THUMB_W;
const H = SCAN_THUMB_H;

/** Deterministic pseudo-random (LCG) so every run sees the same pixels. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** A sharp checkerboard-ish texture with a per-seed phase (high Laplacian). */
function sharpThumb(seed: number, shift = 0): Uint8Array {
  const out = new Uint8Array(W * H);
  const rnd = lcg(seed);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const checker = ((x + shift) >> 2) + (y >> 2);
      out[y * W + x] = (checker & 1 ? 200 : 40) + Math.floor(rnd() * 20);
    }
  }
  return out;
}

/** A flat/blurred frame (low Laplacian variance). */
function blurryThumb(level = 128): Uint8Array {
  const out = new Uint8Array(W * H);
  out.fill(level);
  return out;
}

function cand(ts: number, gray: Uint8Array): FrameCandidate {
  return { ts, gray, width: W, height: H };
}

// -- helpers -----------------------------------------------------------------

describe("captureEngine — image helpers", () => {
  it("laplacianVariance is high for texture and ~0 for flat frames", () => {
    expect(laplacianVariance(sharpThumb(1), W, H)).toBeGreaterThan(1000);
    expect(laplacianVariance(blurryThumb(), W, H)).toBeLessThan(1);
    expect(laplacianVariance(new Uint8Array(4), 2, 2)).toBe(0);
  });

  it("meanAbsDiff is 0 for identical and large for different thumbnails", () => {
    const a = sharpThumb(1);
    expect(meanAbsDiff(a, a)).toBe(0);
    expect(meanAbsDiff(a, sharpThumb(2, 2))).toBeGreaterThan(20);
    expect(meanAbsDiff([], [])).toBe(255);
  });

  it("headingDelta wraps correctly", () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(10, 350)).toBe(-20);
    expect(headingDelta(0, 180)).toBe(180);
    expect(headingDelta(90, 90)).toBe(0);
  });

  it("frameGrab pure helpers: fitLongestSide + rgbaToGray", () => {
    expect(fitLongestSide(3840, 2160)).toEqual({ w: 1920, h: 1080 });
    expect(fitLongestSide(1280, 720)).toEqual({ w: 1280, h: 720 });
    expect(fitLongestSide(0, 10)).toEqual({ w: 0, h: 0 });
    const gray = rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255], 2);
    expect(gray[0]).toBe(255);
    expect(gray[1]).toBe(0);
  });
});

// -- scheduler ----------------------------------------------------------------

describe("CaptureScheduler — cadence", () => {
  it("keeps at most one frame per SCAN_CAPTURE_INTERVAL_MS", () => {
    const s = new CaptureScheduler({ mode: "site" });
    const kept: number[] = [];
    // Offer a distinct sharp frame every 100 ms for 7 s.
    for (let i = 0; i < 70; i++) {
      const d = s.offer(cand(i * 100, sharpThumb(i, i)));
      if (d.keep) kept.push(i * 100);
    }
    expect(kept[0]).toBe(0);
    for (let k = 1; k < kept.length; k++) {
      expect(kept[k] - kept[k - 1]).toBeGreaterThanOrEqual(SCAN_CAPTURE_INTERVAL_MS);
    }
    expect(kept.length).toBe(10); // 0, 700, 1400, ... 6300
    expect(s.dropCounts.too_soon).toBe(60);
    expect(s.keptFrames.map((f) => f.seq)).toEqual([...Array(10).keys()]);
  });
});

describe("CaptureScheduler — blur + motion drop", () => {
  it("drops blurry frames and reports the reason", () => {
    const s = new CaptureScheduler({ mode: "site" });
    const d1 = s.offer(cand(0, blurryThumb()));
    expect(d1).toMatchObject({ keep: false, reason: "blurry" });
    const d2 = s.offer(cand(0, sharpThumb(1)));
    expect(d2.keep).toBe(true);
    expect(s.dropCounts.blurry).toBe(1);
  });

  it("drops frames while the IMU reports motion, then recovers", () => {
    const s = new CaptureScheduler({ mode: "site", motionSettleMs: 250 });
    s.pushStability({ ts: 1000, isMoving: true, accelerationMagnitude: 4 });
    expect(s.offer(cand(1100, sharpThumb(1))).reason).toBe("moving");
    expect(s.offer(cand(1200, sharpThumb(1))).reason).toBe("moving");
    // 300 ms after the last motion sample the frame is accepted again.
    expect(s.offer(cand(1300, sharpThumb(1))).keep).toBe(true);
    expect(s.coachLine()).not.toBe("");
  });

  it("coach line says 'Move slower' after repeated motion/blur drops", () => {
    const s = new CaptureScheduler({ mode: "site" });
    for (let i = 0; i < 4; i++) s.offer(cand(i * 1000, blurryThumb()));
    expect(s.coachLine()).toBe("Move slower");
  });
});

describe("CaptureScheduler — duplicates", () => {
  it("drops a near-identical frame unless the heading swung", () => {
    const s = new CaptureScheduler({ mode: "site" });
    const a = sharpThumb(7);
    expect(s.offer(cand(0, a)).keep).toBe(true);
    const d = s.offer(cand(1000, a));
    expect(d).toMatchObject({ keep: false, reason: "duplicate" });
    expect(d.diff).toBe(0);
    // Same pixels but the compass turned 10° → not a duplicate.
    s.pushOrientation({ ts: 2000, headingDeg: 10, pitchDeg: null });
    const s2 = new CaptureScheduler({ mode: "site" });
    s2.pushOrientation({ ts: 0, headingDeg: 0, pitchDeg: null });
    expect(s2.offer(cand(0, a)).keep).toBe(true);
    s2.pushOrientation({ ts: 1000, headingDeg: 10, pitchDeg: null });
    expect(s2.offer(cand(1000, a)).keep).toBe(true);
  });
});

describe("CaptureScheduler — caps", () => {
  it("enforces SCAN_MAX_FRAMES_SITE and SCAN_MAX_FRAMES_OBJECT", () => {
    for (const [mode, cap] of [
      ["site", SCAN_MAX_FRAMES_SITE],
      ["object", SCAN_MAX_FRAMES_OBJECT],
    ] as const) {
      const s = new CaptureScheduler({ mode });
      let ts = 0;
      for (let i = 0; i < cap + 25; i++) {
        s.offer(cand(ts, sharpThumb(i, i % 16)));
        ts += SCAN_CAPTURE_INTERVAL_MS;
      }
      expect(s.keptFrames.length).toBe(cap);
      expect(s.capReached).toBe(true);
      expect(s.dropCounts.cap_reached).toBe(25);
      expect(s.coachLine()).toMatch(/cap reached/i);
    }
  });

  it("honours an explicit maxFrames override (worker-provided)", () => {
    const s = new CaptureScheduler({ mode: "object", maxFrames: 3 });
    for (let i = 0; i < 6; i++) s.offer(cand(i * 1000, sharpThumb(i, i)));
    expect(s.keptFrames.length).toBe(3);
  });
});

describe("CaptureScheduler — coverage math", () => {
  it("object orbit coverage grows with heading sweep and hits 100% at 360°", () => {
    const s = new CaptureScheduler({ mode: "object" });
    let ts = 0;
    let i = 0;
    const at = (deg: number) => {
      s.pushOrientation({ ts, headingDeg: deg, pitchDeg: -10 });
      s.offer(cand(ts, sharpThumb(i, i)));
      ts += SCAN_CAPTURE_INTERVAL_MS;
      i++;
    };
    for (let deg = 0; deg <= 140; deg += 10) at(deg); // 0..140 → 15 of 36 bins
    const c1 = s.coverage();
    expect(c1.headingCoverage).toBeCloseTo(15 / 36, 5);
    expect(c1.orbitDeg).toBe(150);
    expect(s.coachLine()).toBe("Orbit 42% complete");
    for (let deg = 140; deg < 360; deg += 5) at(deg);
    const c2 = s.coverage();
    expect(c2.headingCoverage).toBe(1);
    expect(c2.orbitDeg).toBe(360);
    expect(c2.score).toBeGreaterThan(0.85); // full orbit, ~55% frame density
    // Heading wrap: 350 → 5 counts as the 0° bin, not a 345° jump.
    expect(headingDelta(350, 5)).toBe(15);
    // Every kept frame carries its heading + pitch tags.
    expect(s.keptFrames.every((f) => typeof f.headingDeg === "number")).toBe(true);
    expect(s.keptFrames[0].pitchDeg).toBe(-10);
  });

  it("site coverage combines path length (frames) with turn coverage (sectors)", () => {
    const s = new CaptureScheduler({ mode: "site" });
    let ts = 0;
    for (let i = 0; i < 60; i++) {
      s.pushOrientation({ ts, headingDeg: (i * 6) % 360, pitchDeg: null });
      s.offer(cand(ts, sharpThumb(i, i)));
      ts += SCAN_CAPTURE_INTERVAL_MS;
    }
    const c = s.coverage();
    expect(c.keptFrames).toBe(60);
    expect(c.pathSeconds).toBeCloseTo((60 * SCAN_CAPTURE_INTERVAL_MS) / 1000, 5);
    expect(c.headingCoverage).toBe(1); // 0..354° in 6° steps covers all 12 sectors
    expect(c.score).toBeCloseTo(0.6 * (60 / 240) + 0.4, 5);
    expect(c.orbitDeg).toBe(0);
  });
});

describe("CaptureScheduler — determinism", () => {
  it("same inputs → same kept frames (seq, ts, tags) and same coverage", () => {
    const run = () => {
      const s = new CaptureScheduler({ mode: "object" });
      const rnd = lcg(42);
      let ts = 0;
      for (let i = 0; i < 400; i++) {
        ts += 50 + Math.floor(rnd() * 200);
        if (rnd() < 0.15) s.pushStability({ ts, isMoving: true, accelerationMagnitude: 5 });
        s.pushOrientation({ ts, headingDeg: (i * 1.7) % 360, pitchDeg: (rnd() - 0.5) * 20 });
        const thumb = rnd() < 0.2 ? blurryThumb() : sharpThumb(i, i % 9);
        s.offer(cand(ts, thumb));
      }
      return {
        kept: s.keptFrames.map((f) => ({ ...f })),
        cov: s.coverage(),
        drops: { ...s.dropCounts },
      };
    };
    const a = run();
    const b = run();
    expect(a.kept.length).toBeGreaterThan(20);
    expect(a).toEqual(b);
    // Every drop reason actually occurred in this synthetic run.
    expect(a.drops.moving).toBeGreaterThan(0);
    expect(a.drops.blurry).toBeGreaterThan(0);
    expect(a.drops.too_soon).toBeGreaterThan(0);
  });
});

// -- config / stub / persistence shape --------------------------------------

describe("site-scan config", () => {
  it("is OFF unless VITE_SITE_SCAN_ENABLED is exactly 'true'", () => {
    expect(isSiteScanEnabled({})).toBe(false);
    expect(isSiteScanEnabled({ VITE_SITE_SCAN_ENABLED: "1" })).toBe(false);
    expect(isSiteScanEnabled({ VITE_SITE_SCAN_ENABLED: "true" })).toBe(true);
  });

  it("normalizes the worker origin and strips a leaked /capture path", () => {
    expect(normalizeScanApiUrl(" https://w.example/ ")).toBe("https://w.example");
    expect(normalizeScanApiUrl("https://w.example/capture/session/start")).toBe(
      "https://w.example",
    );
    expect(normalizeScanApiUrl("")).toBeNull();
  });

  it("pins the shared Scan Mat spec (the worker's mat_spec.py mirrors these)", () => {
    expect(SCAN_MAT_SPEC).toEqual({
      squaresX: 7,
      squaresY: 5,
      squareLengthM: 0.04,
      markerLengthM: 0.03,
      dictionary: "DICT_5X5_100",
      version: 1,
    });
  });
});

describe("scanClient stub worker", () => {
  it("runs a full session → job → canned result without a network", async () => {
    resetScanStub();
    const session = await startScanSession("object");
    expect(session.backendMode).toBe("stub");
    expect(session.maxFrames).toBe(SCAN_MAX_FRAMES_OBJECT);
    for (let i = 0; i < 45; i++) {
      const r = await uploadScanFrame(session, { seq: i, ts: i * 700 }, new Blob(["x"]));
      expect(r.frameCount).toBe(i + 1);
    }
    const { jobId } = await finishScanSession(session);
    let job = await getScanJob(session, jobId);
    expect(["queued", "running"]).toContain(job.status);
    for (let p = 1; p < STUB_JOB_POLLS_UNTIL_DONE; p++) job = await getScanJob(session, jobId);
    expect(job.status).toBe("done");
    expect(job.result).toMatchObject({
      status: "done",
      metric: true,
      object_anchor_id: "OBJ_STUB0000",
      map_code: null,
      frame_count: 45,
    });
  });
});

describe("scan_sessions row shaping", () => {
  it("maps a done result to a metric row and an error to status=error", () => {
    const ok = scanResultToRow(
      "u1",
      "site",
      "job_1",
      120,
      {
        status: "done",
        metric: true,
        artifact_url: "https://x/site.ply",
        map_code: "MAP_1",
        object_anchor_id: null,
        mat_frames: 30,
        reproj_error: 0.5,
        frame_count: 118,
      },
      null,
    );
    expect(ok).toEqual({
      owner_id: "u1",
      type: "site",
      status: "done",
      frame_count: 118,
      mat_detected: true,
      artifact_url: "https://x/site.ply",
      map_code: "MAP_1",
      object_anchor_id: null,
      error: null,
      worker_job_id: "job_1",
    });
    const bad = scanResultToRow("u1", "object", "job_2", 50, null, "job_timeout");
    expect(bad).toMatchObject({
      status: "error",
      frame_count: 50,
      mat_detected: false,
      error: "job_timeout",
    });
  });
});
