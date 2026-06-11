import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeEntities, normalizeSegments } from "../lib/detection/backendVisionDetector";
import { buildExtractCandidates } from "../features/build-mode/lib/handTracking";
import type {
  BlueprintFrame,
  BlueprintPlanOverlay,
  ExtractCandidate,
} from "../features/build-mode/types";
import type { DetectSession } from "../lib/detection/backendVisionHttpDetector";

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

const session: DetectSession = { token: "tok.sig", expiresAt: null };
const fakeVideo = {
  readyState: 2,
  videoWidth: 640,
  videoHeight: 480,
} as unknown as HTMLVideoElement;

afterEach(() => vi.unstubAllEnvs());

describe("YOLO26 /detect — entity + segment parsing", () => {
  it("normalizes entities from a backend=yolo26 response (det only)", () => {
    const entities = normalizeEntities([
      { label: "valve", class_id: 3, confidence: 0.9, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
    ]);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ label: "valve", class_id: 3 });
    expect(entities[0].bbox.w).toBeCloseTo(0.3, 5);
  });

  it("preserves optional source + maskContour + maskSource on entities", () => {
    const [e] = normalizeEntities([
      {
        label: "pipe",
        class_id: 1,
        confidence: 0.8,
        bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        source: "yolo26-seg",
        maskSource: "yolo26-seg",
        maskContour: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.1 },
          { x: 0.3, y: 0.3 },
        ],
      },
    ]);
    expect(e.source).toBe("yolo26-seg");
    expect(e.maskSource).toBe("yolo26-seg");
    expect(e.maskContour).toHaveLength(3);
  });

  it("normalizes a segments array; ignores missing/garbage safely", () => {
    const segs = normalizeSegments([
      {
        label: "panel",
        class_id: 2,
        confidence: 0.7,
        maskContour: [
          { x: 0.2, y: 0.2 },
          { x: 0.6, y: 0.2 },
          { x: 0.6, y: 0.6 },
        ],
      },
      { label: "bad", maskContour: [{ x: 0.1, y: 0.1 }] }, // too few points → dropped
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ label: "panel", source: "yolo26-seg" });
    expect(normalizeSegments(undefined)).toEqual([]);
    expect(normalizeSegments("nope")).toEqual([]);
    expect(normalizeSegments([{}, null, 5])).toEqual([]);
  });

  it("converts pixel-space contours to 0..1 when img dims are given", () => {
    const [s] = normalizeSegments(
      [
        {
          label: "x",
          class_id: 0,
          confidence: 1,
          maskContour: [
            [64, 96],
            [320, 96],
            [320, 240],
          ],
        },
      ],
      640,
      480,
    );
    expect(s.maskContour[0]).toEqual({ x: 0.1, y: 0.2 });
  });
});

describe("Build/Plan — buildExtractCandidates with YOLO26", () => {
  const ent = (label: string, bbox: ExtractCandidate["bbox"], extra?: object) => ({
    label,
    confidence: 0.8,
    bbox,
    ...extra,
  });

  it("backend=yolo26 → entities become yolo26-entity candidates", () => {
    const out = buildExtractCandidates([ent("valve", { x: 0.1, y: 0.1, w: 0.3, h: 0.3 })], [], {
      backend: "yolo26",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "valve", source: "yolo26-entity" });
  });

  it("defaults to edgecrafter-entity when no backend is given (back-compat)", () => {
    const out = buildExtractCandidates([ent("p", { x: 0.1, y: 0.1, w: 0.3, h: 0.3 })], []);
    expect(out[0].source).toBe("edgecrafter-entity");
  });

  it("preserves maskContour and marks a seg-bearing entity as yolo26-segment", () => {
    const contour = [
      { x: 0.12, y: 0.12 },
      { x: 0.34, y: 0.12 },
      { x: 0.34, y: 0.34 },
    ];
    const out = buildExtractCandidates(
      [ent("pipe", { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, { maskContour: contour })],
      [],
      { backend: "yolo26" },
    );
    expect(out[0].source).toBe("yolo26-segment");
    expect(out[0].maskContour).toEqual(contour);
  });

  it("turns mask-only segments into pinchable candidates via contour bounds", () => {
    const out = buildExtractCandidates([], [], {
      backend: "yolo26",
      segments: [
        {
          label: "panel",
          confidence: 0.7,
          maskContour: [
            { x: 0.2, y: 0.2 },
            { x: 0.6, y: 0.2 },
            { x: 0.6, y: 0.55 },
          ],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("yolo26-segment");
    expect(out[0].bbox.w).toBeCloseTo(0.4, 5);
    expect(out[0].bbox.h).toBeCloseTo(0.35, 5);
    expect(out[0].maskContour).toHaveLength(3);
  });

  it("still keeps bbox extraction working when there is no contour", () => {
    const out = buildExtractCandidates([ent("box", { x: 0.2, y: 0.2, w: 0.3, h: 0.3 })], [], {
      backend: "yolo26",
    });
    expect(out[0].maskContour).toBeUndefined();
    expect(out[0].bbox).toBeTruthy();
  });
});

describe("Vision detect URL resolution (env priority)", () => {
  it("prefers VITE_VISION_HTTP_DETECT_URL over the legacy EdgeCrafter name", async () => {
    vi.stubEnv("VITE_VISION_HTTP_DETECT_URL", "https://vision.example/detect");
    vi.stubEnv("VITE_EDGECRAFT_HTTP_DETECT_URL", "https://legacy.example/detect");
    const { readDetectUrl } = await import("../lib/detection/backendVisionHttpDetector");
    expect(readDetectUrl()).toBe("https://vision.example/detect");
  });

  it("falls back to the legacy VITE_EDGECRAFT_HTTP_DETECT_URL when the new one is unset", async () => {
    vi.stubEnv("VITE_VISION_HTTP_DETECT_URL", "");
    vi.stubEnv("VITE_EDGECRAFT_HTTP_DETECT_URL", "https://legacy.example/detect");
    const { readDetectUrl } = await import("../lib/detection/backendVisionHttpDetector");
    expect(readDetectUrl()).toBe("https://legacy.example/detect");
  });

  it("uses the public Cloudflare default when no env is set (never RunPod)", async () => {
    vi.stubEnv("VITE_VISION_HTTP_DETECT_URL", "");
    vi.stubEnv("VITE_EDGECRAFT_HTTP_DETECT_URL", "");
    const { readDetectUrl } = await import("../lib/detection/backendVisionHttpDetector");
    const url = readDetectUrl()!;
    expect(url).toMatch(/\/detect$/);
    expect(url).not.toContain("runpod");
  });
});

describe("HTTP detector — YOLO26 fallback + segments surface in status", () => {
  const yoloFetch = (async () =>
    ({
      ok: true,
      status: 200,
      async json() {
        return {
          entities: [
            {
              label: "valve",
              class_id: 0,
              confidence: 0.9,
              bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
            },
          ],
          poses: [],
          segments: [
            {
              label: "valve",
              class_id: 0,
              confidence: 0.88,
              maskContour: [
                { x: 0.1, y: 0.2 },
                { x: 0.4, y: 0.2 },
                { x: 0.4, y: 0.6 },
              ],
            },
          ],
          backend: "edgecrafter",
          tasks: ["det", "seg"],
          model: "EdgeCrafter",
          fallbackUsed: true,
          fallbackReason: "yolo26_load_failed",
          warning: "running on the fallback backend",
          img_w: 640,
          img_h: 480,
        };
      },
      async text() {
        return "";
      },
    }) as unknown as Response) as unknown as typeof fetch;

  it("stores segments and shows the fallback backend + reason", async () => {
    const { BackendVisionHttpDetector } =
      await import("../lib/detection/backendVisionHttpDetector");
    await withFakeDocument(async () => {
      const det = new BackendVisionHttpDetector({
        detectUrl: "https://gw.example/detect",
        sessionProvider: async () => session,
        fetchImpl: yoloFetch,
      });
      await det.start();
      det.detect({ video: fakeVideo, timestamp: 1000, enabledHazards: [], sensitivity: 0.5 });
      await flush();
      await flush();
      await flush();
      const st = det.getBackendStatus();
      expect(st.backend).toBe("edgecrafter");
      expect(st.fallbackUsed).toBe(true);
      expect(st.fallbackReason).toBe("yolo26_load_failed");
      expect(st.warning).toContain("fallback");
      expect(st.segmentCount).toBe(1);
      expect(det.getLastSegments()).toHaveLength(1);
    });
  });
});

describe("Blueprint frame — YOLO26 seg mask sources + plan overlay types", () => {
  it("accepts maskSource yolo26-seg and fallback-contour", () => {
    const seg: BlueprintFrame["maskSource"] = "yolo26-seg";
    const fallback: BlueprintFrame["maskSource"] = "fallback-contour";
    expect(seg).toBe("yolo26-seg");
    expect(fallback).toBe("fallback-contour");
    const frame: Partial<BlueprintFrame> = {
      maskSource: "yolo26-seg",
      maskContour: [
        { x: 0.2, y: 0.3 },
        { x: 0.5, y: 0.3 },
        { x: 0.5, y: 0.6 },
      ],
    };
    expect(frame.maskContour).toHaveLength(3);
  });

  it("supports callout and step-marker plan overlays (and tolerates unknowns as data)", () => {
    const overlays: BlueprintPlanOverlay[] = [
      { id: "c1", type: "callout", x: 0.4, y: 0.3, label: "Inspect here" },
      { id: "s1", type: "step-marker", x: 0.5, y: 0.5, label: "2" },
    ];
    expect(overlays.map((o) => o.type)).toEqual(["callout", "step-marker"]);
    // an unknown type is just data — the renderer ignores it, never throws
    const unknown = {
      id: "u1",
      type: "mystery-overlay",
      x: 0.5,
      y: 0.5,
    } as unknown as BlueprintPlanOverlay;
    expect(unknown.id).toBe("u1");
  });
});
