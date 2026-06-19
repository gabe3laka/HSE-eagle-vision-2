import { describe, it, expect } from "vitest";
import type { DetectSession } from "../lib/detection/backendVisionHttpDetector";

const flush = () => new Promise((r) => setTimeout(r, 0));

// A tiny fake <canvas> so the detector can "capture" a frame in the node test
// env (jsdom/happy-dom are unavailable here). Returns a fixed base64 payload.
function withFakeDocument<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => "data:image/jpeg;base64,QUJD",
    }),
  };
  return fn().finally(() => {
    g.document = prev;
  });
}

const okFetch = (calls: { url: string; body: string }[]) =>
  (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          entities: [
            {
              label: "person",
              class_id: 0,
              confidence: 0.9,
              bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
            },
          ],
          poses: [{ confidence: 0.8, keypoints: [{ name: "nose", x: 0.5, y: 0.4, score: 0.9 }] }],
          backend: "edgecrafter",
          tasks: ["det", "pose"],
          model: "EdgeCrafter",
          inference_ms: 42,
          img_w: 640,
          img_h: 480,
        };
      },
      async text() {
        return "";
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;

const fakeVideo = {
  readyState: 2,
  videoWidth: 640,
  videoHeight: 480,
} as unknown as HTMLVideoElement;
const session: DetectSession = { token: "tok.sig", expiresAt: null };

describe("EdgeCrafter HTTP — fast dry run (backend-edgecrafter-http)", () => {
  it("factory maps the mode and detect() returns [] (no RiskEngine observations)", async () => {
    const { createDetector } = await import("../lib/detection/detectorFactory");
    const det = createDetector("backend-edgecrafter-http");
    expect(det.name).toBe("backend-edgecrafter-http");
    expect(det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 })).toEqual(
      [],
    );
  });

  it("reports transport http-cloudflare and a ~4 fps target", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");
    const det = new BackendVisionHttpDetector({
      detectUrl: "https://gw.example/detect",
      sessionProvider: async () => session,
      fetchImpl: okFetch([]),
    });
    const st = det.getBackendStatus();
    expect(st.transport).toBe("http-cloudflare");
    expect(st.targetFps).toBe(4);
    expect(st.requestCount).toBe(0);
  });

  it("readDetectUrl resolves a browser-safe gateway URL (default or env override)", async () => {
    const { readDetectUrl } = await import("../lib/detection/backendVisionHttpDetector");
    const url = readDetectUrl();
    expect(typeof url).toBe("string");
    expect(url).toMatch(/\/detect$/);
    expect(url).not.toContain("runpod"); // never the raw RunPod endpoint
  });

  it("POSTs the newest frame to /detect with ?token= and normalizes entities + poses", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");
    const calls: { url: string; body: string }[] = [];
    await withFakeDocument(async () => {
      const det = new BackendVisionHttpDetector({
        detectUrl: "https://gw.example/detect",
        sessionProvider: async () => session,
        fetchImpl: okFetch(calls),
      });
      await det.start();
      det.detect({ video: fakeVideo, timestamp: 1000, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      await flush();

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://gw.example/detect?token=tok.sig");
      expect(calls[0].body).toContain("image_b64");

      const st = det.getBackendStatus();
      expect(st.state).toBe("ready");
      expect(st.backend).toBe("edgecrafter");
      expect(st.tasks).toEqual(["det", "pose"]);
      expect(st.model).toBe("EdgeCrafter");
      expect(st.lastInferenceMs).toBe(42); // server-measured inference
      expect(st.lastLatencyMs).not.toBeNull(); // round-trip latency recorded
      expect(st.responseCount).toBe(1);
      expect(det.getLastEntities()).toHaveLength(1);
      expect(det.getLastEntities()[0].label).toBe("person");
      expect(det.getLastPoses()).toHaveLength(1);

      // dry-run: still no Observations
      expect(
        det.detect({ video: null, timestamp: 2000, enabledHazards: [], sensitivity: 0.5 }),
      ).toEqual([]);
      det.stop();
    });
  });

  it("never queues a stale frame: a second frame within the cadence is skipped", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");
    const calls: { url: string; body: string }[] = [];
    await withFakeDocument(async () => {
      const det = new BackendVisionHttpDetector({
        detectUrl: "https://gw.example/detect",
        sessionProvider: async () => session,
        fetchImpl: okFetch(calls),
      });
      await det.start();
      det.detect({ video: fakeVideo, timestamp: 1000, enabledHazards: [], sensitivity: 0.5 });
      // 100ms later — inside the 333ms cadence -> must NOT submit again
      det.detect({ video: fakeVideo, timestamp: 1100, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      await flush();
      expect(calls).toHaveLength(1);
      det.stop();
    });
  });

  it("surfaces token failures without sending a frame (no fetch)", async () => {
    const { BackendVisionHttpDetector, DetectAuthError } =
      await import("../lib/detection/backendVisionHttpDetector");
    const calls: { url: string; body: string }[] = [];
    await withFakeDocument(async () => {
      const det = new BackendVisionHttpDetector({
        detectUrl: "https://gw.example/detect",
        sessionProvider: async () => {
          throw new DetectAuthError();
        },
        fetchImpl: okFetch(calls),
      });
      await det.start();
      det.detect({ video: fakeVideo, timestamp: 1000, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      await flush();
      expect(calls).toHaveLength(0); // no frame POSTed without a token
      expect(det.getBackendStatus().error).toBe("not_authenticated");
      det.stop();
    });
  });

  it("does not affect the simulated default detector", async () => {
    const { createDetector } = await import("../lib/detection/detectorFactory");
    expect(createDetector("simulated").name).toBe("simulated");
  });
});

describe("clampNumber + capture env knobs", () => {
  it("clampNumber returns fallback on NaN and clamps to [lo, hi]", async () => {
    const { clampNumber } = await import("../lib/detection/backendVisionHttpDetector");
    expect(clampNumber(Number.NaN, 256, 1280, 512)).toBe(512);
    expect(clampNumber(100, 256, 1280, 512)).toBe(256);
    expect(clampNumber(9999, 256, 1280, 512)).toBe(1280);
    expect(clampNumber(640, 256, 1280, 512)).toBe(640);
    expect(clampNumber(0.2, 0.4, 0.92, 0.7)).toBe(0.4);
    expect(clampNumber(0.95, 0.4, 0.92, 0.7)).toBe(0.92);
  });

  it("captureVideoFrameBase64 honors maxSide + quality and preserves aspect", async () => {
    const { captureVideoFrameBase64 } = await import("../lib/detection/backendVisionHttpDetector");
    await withFakeDocument(async () => {
      const vid = { videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
      // Pass targetAspect: null so the cover-crop path doesn't run in node tests.
      const res = captureVideoFrameBase64(vid, {
        maxSide: 960,
        quality: 0.8,
        targetAspect: null,
      });
      expect(res).not.toBeNull();
      const { cw, ch } = res!;
      expect(Math.max(cw, ch)).toBeLessThanOrEqual(960);
      // 1920×1080 → max side capped at 960 → 960×540 (aspect preserved).
      expect(cw).toBe(960);
      expect(ch).toBe(540);
    });
  });
});
