import { describe, it, expect } from "vitest";
import { SimulatedDetector } from "./simulatedDetector";
import type { DetectorInput, Observation } from "./types";

describe("SimulatedDetector", () => {
  it("emits hazards with no trackKey/source (simulated path unaffected by the tracker change)", async () => {
    const det = new SimulatedDetector();
    await det.start();
    const base: Omit<DetectorInput, "timestamp"> = {
      video: null,
      enabledHazards: [], // empty → simulator uses all hazards
      sensitivity: 0.5,
    };
    let last: Observation[] = [];
    // the simulator force-seeds an episode at tick 10, so the 10th frame returns ≥1
    for (let t = 1; t <= 10; t++) last = det.detect({ ...base, timestamp: t });
    expect(last.length).toBeGreaterThan(0);
    for (const o of last) {
      expect(o.trackKey).toBeUndefined();
      expect(o.source).toBeUndefined();
      expect(typeof o.hazardType).toBe("string");
    }
    det.stop();
  });
});
