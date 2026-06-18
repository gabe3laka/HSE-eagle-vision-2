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

  it("reports transport http-cloudflare and the 500 ms cadence target", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");
    const det = new BackendVisionHttpDetector({
      detectUrl: "https://gw.example/detect",
      sessionProvider: async () => session,
      fetchImpl: okFetch([]),
    });
    const st = det.getBackendStatus();
    expect(st.transport).toBe("http-cloudflare");
    expect(st.targetFps).toBeCloseTo(2.0, 1);
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
      const body = JSON.parse(calls[0].body);
      expect(body.image_b64).toBe("QUJD");
      expect(body.conf).toBe(0.2);
      expect(body.img_size).toBe(640);
      expect(body.session_id).toMatch(/^browser-http-/);
      expect(body.frame_id).toBe("1");
      expect(body.camera_id).toBe("browser-http");
      expect(body.scene_hint).toBe("indoor_demo");
      expect(body.site_context).toMatchObject({
        environment_type: "indoor",
        mode: "live_hse_monitoring",
      });
      expect(body.site_context.reasoning_policy).toBeDefined();
      expect(Array.isArray(body.site_context.monitoring_focus)).toBe(true);
      expect(body.site_context.monitoring_focus.length).toBeGreaterThan(0);
      expect(body.site_context.allowed_hazard_focus).toBeUndefined();
      expect(body.camera_context).toMatchObject({
        camera_name: "browser-http",
        location_name: "live_camera",
      });
      expect(body.reasoning_preferences).toMatchObject({
        force_reason: false,
        prefer_low_latency: true,
        target_reasoning_interval_ms: 1500,
        max_candidate_age_ms: 1500,
        require_visual_evidence: true,
        allow_no_active_risk: true,
        avoid_repeating_unconfirmed_risks: true,
        verify_current_frame_before_reusing_cached_risk: true,
      });

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
      // 100ms later: inside the 500ms cadence, so it must not submit again.
      det.detect({ video: fakeVideo, timestamp: 1100, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      await flush();
      expect(calls).toHaveLength(1);
      det.stop();
    });
  });

  it("keeps max one request in flight and does not queue an old frame", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");
    const calls: { url: string; body: string }[] = [];
    let resolveFetch: (() => void) | null = null;
    const slowFetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      await new Promise<void>((resolve) => {
        resolveFetch = resolve;
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return { entities: [], backend: "edgecrafter" };
        },
        async text() {
          return "";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await withFakeDocument(async () => {
      const det = new BackendVisionHttpDetector({
        detectUrl: "https://gw.example/detect",
        sessionProvider: async () => session,
        fetchImpl: slowFetch,
      });
      await det.start();
      det.detect({ video: fakeVideo, timestamp: 1000, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      expect(calls).toHaveLength(1);
      expect(det.getInFlight()).toBe(true);

      det.detect({ video: fakeVideo, timestamp: 2000, enabledHazards: [], sensitivity: 0.5 });
      det.detect({ video: fakeVideo, timestamp: 3000, enabledHazards: [], sensitivity: 0.5 });
      expect(calls).toHaveLength(1);

      resolveFetch?.();
      await flush();
      await flush();
      expect(det.getInFlight()).toBe(false);

      det.detect({ video: fakeVideo, timestamp: 3701, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      expect(calls).toHaveLength(2);
      expect(JSON.parse(calls[1].body).frame_id).toBe("2");
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
