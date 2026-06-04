import { describe, it, expect } from "vitest";
import { RiskEngine } from "./riskEngine";
import type { HazardType, Observation } from "./types";

function obs(hazardType: HazardType, confidence = 0.7): Observation {
  return { hazardType, confidence, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 } };
}

describe("RiskEngine", () => {
  it("records a brief blip silently, surfacing nothing", () => {
    const e = new RiskEngine();
    const a = e.update([obs("unsafe_lift")], 0); // low → silent dashboard record only
    expect(a.filter((x) => !x.silent)).toHaveLength(0); // nothing surfaced
    expect(a.every((x) => x.silent)).toBe(true);
  });

  it("escalates a sustained hazard low → medium → high", () => {
    const e = new RiskEngine();
    const collected: string[] = [];
    let highIsIncident = false;
    // simulate ~8fps frames for 2 seconds
    for (let t = 0; t <= 2000; t += 100) {
      for (const a of e.update([obs("unsafe_lift")], t)) {
        collected.push(a.severity);
        if (a.severity === "high") highIsIncident = a.isIncident;
      }
    }
    expect(collected).toContain("medium");
    expect(collected).toContain("high");
    expect(highIsIncident).toBe(true);
  });

  it("fires immediately for a collision-path hazard", () => {
    const e = new RiskEngine();
    const alerts = e.update([obs("forklift_proximity", 0.85)], 0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].isIncident).toBe(true);
  });

  it("resets a track after the hazard disappears", () => {
    const e = new RiskEngine();
    e.update([obs("unsafe_lift")], 0);
    e.update([], 100); // gone this frame
    // reappears much later → starts fresh at low, so nothing surfaced
    const after = e.update([obs("unsafe_lift")], 3000);
    expect(after.filter((a) => !a.silent)).toHaveLength(0);
  });

  it("tracks two person_proximity pairs independently by trackKey", () => {
    const e = new RiskEngine();
    const prox = (key: string): Observation => ({
      hazardType: "person_proximity",
      confidence: 0.7,
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
      trackKey: key,
    });
    // pair p1-p2 persists for 700 ms; pair p1-p3 only appears on the last frame
    for (let t = 0; t < 700; t += 100) e.update([prox("p1-p2")], t);
    e.update([prox("p1-p2"), prox("p1-p3")], 700);
    expect(e.currentSeverity("person_proximity", "p1-p2")).toBe("medium");
    expect(e.currentSeverity("person_proximity", "p1-p3")).toBe("low");
    // the bare hazard key (no trackKey) has no track of its own
    expect(e.currentSeverity("person_proximity")).toBeNull();
  });

  it("tracks unsafe_lift per person via trackKey", () => {
    const e = new RiskEngine();
    const lift = (key: string): Observation => ({
      hazardType: "unsafe_lift",
      confidence: 0.7,
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
      trackKey: key,
    });
    // p1 lifts unsafely for 1.7 s → high; p2 appears only on the last frame → low
    for (let t = 0; t <= 1700; t += 100) {
      e.update(t < 1700 ? [lift("p1")] : [lift("p1"), lift("p2")], t);
    }
    expect(e.currentSeverity("unsafe_lift", "p1")).toBe("high");
    expect(e.currentSeverity("unsafe_lift", "p2")).toBe("low");
  });
});
