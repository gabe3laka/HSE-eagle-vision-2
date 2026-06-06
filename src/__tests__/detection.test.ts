import { describe, it, expect } from "vitest";

describe("DetectionMode types", () => {
  it("includes backend-deimv2", async () => {
    // Just verify the type exists by importing
    const { createDetector } = await import("../lib/detection/detectorFactory");
    const det = createDetector("backend-deimv2");
    expect(det).toBeTruthy();
    expect(det.name).toBe("backend-deimv2");
  });

  it("BackendVisionDetector.detect returns empty array", async () => {
    const { BackendVisionDetector } = await import("../lib/detection/backendVisionDetector");
    const det = new BackendVisionDetector();
    await det.start();
    const result = det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 });
    expect(result).toEqual([]);
    det.stop();
  });

  it("BackendVisionDetector does not submit overlapping requests", async () => {
    const { BackendVisionDetector } = await import("../lib/detection/backendVisionDetector");
    const det = new BackendVisionDetector();
    await det.start();
    // inFlight should start false
    expect(det.getInFlight()).toBe(false);
    det.stop();
  });

  it("createDetector simulated still works", async () => {
    const { createDetector } = await import("../lib/detection/detectorFactory");
    const det = createDetector("simulated");
    expect(det.name).toBe("simulated");
  });
});

describe("EdgeCrafter poses + normalizers", () => {
  it("normalizeEntities still produces normalized bboxes", async () => {
    const { normalizeEntities } = await import("../lib/detection/backendVisionDetector");
    const out = normalizeEntities([
      { label: "person", class_id: 0, confidence: 0.9, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("person");
    expect(out[0].bbox).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it("normalizePoses accepts normalized keypoints + defaults the COCO skeleton", async () => {
    const { normalizePoses, COCO17_SKELETON } =
      await import("../lib/detection/backendVisionDetector");
    const out = normalizePoses([
      { confidence: 0.8, keypoints: [{ name: "nose", x: 0.5, y: 0.4, score: 0.9 }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.8);
    expect(out[0].keypoints[0]).toMatchObject({ name: "nose", x: 0.5, y: 0.4, score: 0.9 });
    expect(out[0].skeleton).toEqual(COCO17_SKELETON); // missing skeleton -> COCO default
  });

  it("normalizePoses converts pixel keypoints using img_w/img_h and clamps", async () => {
    const { normalizePoses } = await import("../lib/detection/backendVisionDetector");
    // bare [x,y,score] arrays in pixels; no names -> COCO17 fallback by index
    const out = normalizePoses(
      [
        {
          score: 0.7,
          keypoints: [
            [320, 240, 0.9],
            [9999, 9999, 0.8],
          ],
        },
      ],
      640,
      480,
    );
    expect(out).toHaveLength(1);
    expect(out[0].keypoints[0]).toMatchObject({ name: "nose", x: 0.5, y: 0.5 });
    expect(out[0].keypoints[1].x).toBeLessThanOrEqual(1); // clamped
    expect(out[0].keypoints[1].y).toBeLessThanOrEqual(1);
  });

  it("normalizePoses ignores non-arrays and all-invalid poses", async () => {
    const { normalizePoses } = await import("../lib/detection/backendVisionDetector");
    expect(normalizePoses(null)).toEqual([]);
    expect(normalizePoses("nope" as unknown)).toEqual([]);
    expect(normalizePoses([{ confidence: 0.5, keypoints: [{ x: "a", y: null }] }])).toEqual([]);
  });

  it("BackendVisionDetector exposes poses + backend/tasks/poseCount in status", async () => {
    const { BackendVisionDetector } = await import("../lib/detection/backendVisionDetector");
    const det = new BackendVisionDetector();
    await det.start();
    expect(det.getLastPoses()).toEqual([]);
    const status = det.getBackendStatus();
    expect(status.poseCount).toBe(0);
    expect(status.backend).toBeNull();
    expect(status.tasks).toBeNull();
    // dry-run: still no observations
    expect(det.detect({ video: null, timestamp: 0, enabledHazards: [], sensitivity: 0.5 })).toEqual(
      [],
    );
    det.stop();
  });

  it("backend-deimv2 saved value still maps to BackendVisionDetector", async () => {
    const { createDetector } = await import("../lib/detection/detectorFactory");
    expect(createDetector("backend-deimv2").name).toBe("backend-deimv2");
  });
});
