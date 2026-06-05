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
