import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StreamSocketLike } from "../lib/detection/backendVisionStreamClient";

const VISION = JSON.stringify({
  type: "vision",
  camera_id: "browser-test",
  frame_id: 7,
  backend: "edgecrafter",
  tasks: ["det", "pose"],
  model: "EdgeCrafter",
  entities: [
    { label: "person", class_id: 0, confidence: 0.9, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
  ],
  poses: [{ confidence: 0.8, keypoints: [{ name: "nose", x: 0.5, y: 0.4, score: 0.9 }] }],
  inference_ms: 123,
  img_w: 640,
  img_h: 480,
  end_to_end_latency_ms: 220,
});

describe("EdgeCrafter stream mode (beta)", () => {
  it("factory maps the mode and detect() returns [] (no RiskEngine observations)", async () => {
    const { createDetector } = await import("../lib/detection/detectorFactory");
    const det = createDetector("backend-edgecrafter-stream");
    expect(det.name).toBe("backend-edgecrafter-stream");
    await det.start();
    expect(det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 })).toEqual(
      [],
    );
    det.stop();
  });

  it("reports 'not configured' when no stream URL is set", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const c = new BackendVisionStreamClient({ url: null });
    expect(c.configured).toBe(false);
    expect(c.getState().state).toBe("unconfigured");

    const { BackendVisionStreamDetector } =
      await import("../lib/detection/backendVisionStreamDetector");
    const det = new BackendVisionStreamDetector(c);
    await det.start();
    const st = det.getBackendStatus();
    expect(st.transport).toBe("ws");
    expect(st.wsConfigured).toBe(false);
    expect(st.streamState).toBe("unconfigured");
    expect(st.error).toBe("stream_url_not_configured");
    // dry-run: still no observations even when unconfigured
    expect(det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 })).toEqual(
      [],
    );
    det.stop();
  });

  it("parses connected/warming/ready", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const c = new BackendVisionStreamClient({ url: "ws://test.local/ws/vision" });
    c.handleMessage(JSON.stringify({ type: "connected" }));
    expect(c.getState().state).toBe("connected");
    c.handleMessage(JSON.stringify({ type: "warming" }));
    expect(c.getState().state).toBe("warming");
    expect(c.getState().modelReady).toBe(false);
    c.handleMessage(
      JSON.stringify({ type: "ready", backend: "edgecrafter", tasks: ["det", "pose"] }),
    );
    const s = c.getState();
    expect(s.state).toBe("ready");
    expect(s.modelReady).toBe(true);
    expect(s.backend).toBe("edgecrafter");
    expect(s.tasks).toEqual(["det", "pose"]);
  });

  it("parses vision messages and updates entities + poses", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const c = new BackendVisionStreamClient({ url: "ws://test.local/ws/vision" });
    c.handleMessage(VISION);
    expect(c.getLastEntities()).toHaveLength(1);
    expect(c.getLastEntities()[0].label).toBe("person");
    expect(c.getLastPoses()).toHaveLength(1);
    expect(c.getLastPoses()[0].keypoints[0]).toMatchObject({ name: "nose", x: 0.5, y: 0.4 });
    const s = c.getState();
    expect(s.backend).toBe("edgecrafter");
    expect(s.tasks).toEqual(["det", "pose"]);
    expect(s.model).toBe("EdgeCrafter");
    expect(s.lastInferenceMs).toBe(123);
    expect(s.lastFrameId).toBe(7);
    expect(s.visionCount).toBe(1);
  });

  it("parses metrics messages", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const c = new BackendVisionStreamClient({ url: "ws://test.local/ws/vision" });
    c.handleMessage(
      JSON.stringify({
        type: "metrics",
        received_fps: 5,
        processed_fps: 4.8,
        dropped_frames: 3,
        avg_inference_ms: 140,
        avg_end_to_end_latency_ms: 280,
        current_queue_depth: 0,
        model_ready: true,
        backend: "edgecrafter",
        tasks: ["det", "pose"],
      }),
    );
    const s = c.getState();
    expect(s.receivedFps).toBe(5);
    expect(s.processedFps).toBe(4.8);
    expect(s.droppedFrames).toBe(3);
    expect(s.currentQueueDepth).toBe(0);
    expect(s.avgInferenceMs).toBe(140);
    expect(s.avgEndToEndLatencyMs).toBe(280);
    expect(s.modelReady).toBe(true);
  });

  it("stream detector surfaces entities/poses + metrics via getBackendStatus", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const { BackendVisionStreamDetector } =
      await import("../lib/detection/backendVisionStreamDetector");
    const c = new BackendVisionStreamClient({ url: "ws://test.local/ws/vision" });
    const det = new BackendVisionStreamDetector(c);
    await det.start();
    c.handleMessage(VISION);
    c.handleMessage(
      JSON.stringify({
        type: "metrics",
        received_fps: 5,
        processed_fps: 4.8,
        dropped_frames: 3,
        avg_inference_ms: 140,
        avg_end_to_end_latency_ms: 280,
        current_queue_depth: 2,
        model_ready: true,
        backend: "edgecrafter",
        tasks: ["det", "pose"],
      }),
    );
    expect(det.getLastEntities()).toHaveLength(1);
    expect(det.getLastPoses()).toHaveLength(1);
    const st = det.getBackendStatus();
    expect(st.transport).toBe("ws");
    expect(st.entityCount).toBe(1);
    expect(st.poseCount).toBe(1);
    expect(st.backend).toBe("edgecrafter");
    expect(st.model).toBe("EdgeCrafter");
    expect(st.receivedFps).toBe(5);
    expect(st.processedFps).toBe(4.8);
    expect(st.droppedFrames).toBe(3);
    expect(st.currentQueueDepth).toBe(2);
    expect(st.avgEndToEndLatencyMs).toBe(280);
    // dry-run: detector still emits no observations
    expect(det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 })).toEqual(
      [],
    );
    det.stop();
  });

  it("records invalid JSON + error frames without throwing", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const c = new BackendVisionStreamClient({ url: "ws://test.local/ws/vision" });
    expect(() => c.handleMessage("this is not json {")).not.toThrow();
    expect(c.getState().lastError).toBe("invalid_json");
    c.handleMessage(JSON.stringify({ type: "error", error: "model_not_ready" }));
    expect(c.getState().lastError).toBe("model_not_ready");
    expect(c.getState().errorCount).toBeGreaterThanOrEqual(2);
  });

  it("does not affect the HTTP dry-run detector (still returns [])", async () => {
    const { createDetector } = await import("../lib/detection/detectorFactory");
    const det = createDetector("backend-deimv2");
    expect(det.name).toBe("backend-deimv2");
    await det.start();
    expect(det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 })).toEqual(
      [],
    );
    det.stop();
  });
});

describe("EdgeCrafter stream — Supabase token flow + frontend secret safety", () => {
  function fakeSocket(): StreamSocketLike {
    return {
      readyState: 1,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send() {},
      close() {},
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("missing stream URL does not request a token or connect", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const order: string[] = [];
    const c = new BackendVisionStreamClient({
      url: null,
      tokenProvider: async () => {
        order.push("token");
        return "tok";
      },
      webSocketFactory: (u) => {
        order.push(`ws:${u}`);
        return fakeSocket();
      },
    });
    c.connect();
    await flush();
    await flush();
    expect(order).toEqual([]); // never fetched a token, never opened a socket
    expect(c.getState().state).toBe("unconfigured");
  });

  it("requests a token BEFORE connecting and opens the gateway with ?token=", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    const order: string[] = [];
    const openedUrls: string[] = [];
    const c = new BackendVisionStreamClient({
      url: "wss://gw.example/ws/vision",
      tokenProvider: async (cameraId) => {
        order.push(`token:${cameraId}`);
        return "tok.sig";
      },
      webSocketFactory: (u) => {
        order.push("ws");
        openedUrls.push(u);
        return fakeSocket();
      },
    });
    c.connect();
    await flush();
    await flush();
    expect(order).toEqual(["token:browser-test", "ws"]); // token minted before socket
    expect(openedUrls).toEqual(["wss://gw.example/ws/vision?token=tok.sig"]);
  });

  it("token failure -> state error / stream_token_failed, no socket opened", async () => {
    const { BackendVisionStreamClient } =
      await import("../lib/detection/backendVisionStreamClient");
    let wsCalls = 0;
    const c = new BackendVisionStreamClient({
      url: "wss://gw.example/ws/vision",
      tokenProvider: async () => {
        throw new Error("boom");
      },
      webSocketFactory: () => {
        wsCalls += 1;
        return fakeSocket();
      },
    });
    c.connect();
    await flush();
    await flush();
    expect(wsCalls).toBe(0);
    expect(c.getState().state).toBe("error");
    expect(c.getState().lastError).toBe("stream_token_failed");
  });

  it("not authenticated -> lastError not_authenticated, no socket opened", async () => {
    const { BackendVisionStreamClient, StreamAuthError } =
      await import("../lib/detection/backendVisionStreamClient");
    let wsCalls = 0;
    const c = new BackendVisionStreamClient({
      url: "wss://gw.example/ws/vision",
      tokenProvider: async () => {
        throw new StreamAuthError();
      },
      webSocketFactory: () => {
        wsCalls += 1;
        return fakeSocket();
      },
    });
    c.connect();
    await flush();
    await flush();
    expect(wsCalls).toBe(0);
    expect(c.getState().state).toBe("error");
    expect(c.getState().lastError).toBe("not_authenticated");
  });

  it("buildStreamUrl appends ?token= (URL-encoded)", async () => {
    const { buildStreamUrl } = await import("../lib/detection/backendVisionStreamClient");
    expect(buildStreamUrl("wss://gw.example/ws/vision", "a.b.c")).toBe(
      "wss://gw.example/ws/vision?token=a.b.c",
    );
    const withQuery = buildStreamUrl("wss://gw.example/ws/vision?x=1", "t k");
    expect(withQuery).toContain("x=1");
    expect(withQuery).toContain("token=t%20k");
  });

  it("frontend src/ contains no RunPod key or signing-secret references", () => {
    const forbidden = ["RUNPOD_API_KEY", "STREAM_SESSION_SIGNING_SECRET", "rpa_"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (
          /\.(ts|tsx|js|jsx)$/.test(name) &&
          !p.includes("__tests__") &&
          !name.includes(".test.")
        ) {
          const text = readFileSync(p, "utf8");
          for (const bad of forbidden) if (text.includes(bad)) offenders.push(`${p} :: ${bad}`);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
