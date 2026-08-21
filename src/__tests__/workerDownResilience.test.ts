import { afterEach, describe, expect, it, vi } from "vitest";
import type { DetectSession } from "../lib/detection/backendVisionHttpDetector";

/**
 * Worker-down resilience (demo hardening): consecutive /detect failures are
 * counted on BackendStatus so Live can show a non-blocking "Vision service
 * reconnecting…" banner, and one success resets the streak. The camera loop
 * itself never tears down — detect() keeps returning [] throughout.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

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

const fakeVideo = {
  readyState: 2,
  videoWidth: 640,
  videoHeight: 480,
} as unknown as HTMLVideoElement;
const session: DetectSession = { token: "tok.sig", expiresAt: null };

const okResponse = {
  ok: true,
  status: 200,
  async json() {
    return {
      entities: [],
      poses: [],
      backend: "yolo26",
      tasks: ["det"],
      model: "YOLO26",
      inference_ms: 20,
      img_w: 640,
      img_h: 480,
    };
  },
  async text() {
    return "";
  },
} as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consecutive /detect failure streak", () => {
  it("counts failures, keeps the loop alive, and resets on success", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");

    // Controllable clock so cadence (250ms) + transient backoff (2s) elapse
    // instantly between pumps.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    // Switchable transport: network failure first, healthy later.
    let failing = true;
    const fetchImpl = (async () => {
      if (failing) throw new Error("network down");
      return okResponse;
    }) as unknown as typeof fetch;

    await withFakeDocument(async () => {
      const det = new BackendVisionHttpDetector({
        detectUrl: "https://gw.example/detect",
        sessionProvider: async () => session,
        fetchImpl,
      });
      await det.start();

      const pump = async () => {
        clock += 5_000; // > cadence and > backoff
        const out = det.detect({
          video: fakeVideo,
          timestamp: clock,
          enabledHazards: [],
          sensitivity: 0.5,
        });
        expect(out).toEqual([]); // dry-run contract holds even while failing
        await flush();
        await flush();
      };

      await pump();
      await pump();
      await pump();

      const failed = det.getBackendStatus();
      expect(failed.state).toBe("error");
      expect(failed.consecutiveFailures).toBe(3); // banner threshold reached

      failing = false; // worker comes back
      await pump();

      const healthy = det.getBackendStatus();
      expect(healthy.state).toBe("ready");
      expect(healthy.consecutiveFailures).toBe(0); // streak fully reset
      det.stop();
    });
  });
});

describe("composer drafting degradation", () => {
  it("composerRespond returns kind 'error' on invoke failure (review opens editable)", async () => {
    vi.doMock("@/integrations/supabase/own-client", () => ({
      supabase: {
        functions: {
          invoke: async () => {
            throw new Error("edge function unreachable");
          },
        },
      },
    }));
    const { composerRespond } = await import("../features/report-composer/lib/reasoningClient");
    await expect(composerRespond({ text: "near miss", media: [] })).resolves.toEqual({
      kind: "error",
    });
    vi.doUnmock("@/integrations/supabase/own-client");
  });
});
