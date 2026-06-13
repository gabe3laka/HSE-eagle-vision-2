import { describe, it, expect } from "vitest";
import {
  deriveRisksFromIncidents,
  likelihoodFromCount,
  riskLevel,
  riskScore,
  severityScore,
  type RiskIncidentInput,
} from "../features/safety/lib/riskModel";

describe("risk model — severity mapping (1..5 from the DB severity enum)", () => {
  it("maps the four severity levels", () => {
    expect(severityScore("unsafe_lift", "low")).toBe(2);
    expect(severityScore("unsafe_lift", "medium")).toBe(3);
    expect(severityScore("unsafe_lift", "high")).toBe(4);
    expect(severityScore("unsafe_lift", "critical")).toBe(5);
  });

  it("floors immediate-critical hazards (forklift / fall) at >= 4", () => {
    expect(severityScore("forklift_proximity", "low")).toBe(4);
    expect(severityScore("fall_risk", "medium")).toBe(4);
    expect(severityScore("forklift_proximity", "critical")).toBe(5);
  });
});

describe("risk model — likelihood banding", () => {
  it("bands incident frequency into 1..5", () => {
    expect(likelihoodFromCount(0)).toBe(1);
    expect(likelihoodFromCount(1)).toBe(2);
    expect(likelihoodFromCount(2)).toBe(2);
    expect(likelihoodFromCount(5)).toBe(3);
    expect(likelihoodFromCount(10)).toBe(4);
    expect(likelihoodFromCount(25)).toBe(5);
  });
});

describe("risk model — score & level bands", () => {
  it("scores likelihood × severity (HSE example S4 × L3 = 12 → High)", () => {
    expect(riskScore(3, 4)).toBe(12);
    expect(riskLevel(12)).toBe("high");
  });

  it("bands the full 1..25 range", () => {
    expect(riskLevel(4)).toBe("low");
    expect(riskLevel(5)).toBe("medium");
    expect(riskLevel(9)).toBe("medium");
    expect(riskLevel(10)).toBe("high");
    expect(riskLevel(15)).toBe("high");
    expect(riskLevel(16)).toBe("critical");
    expect(riskLevel(25)).toBe("critical");
  });
});

describe("risk model — derive risks from incident history", () => {
  const now = new Date("2026-06-13T00:00:00Z").getTime();
  const day = 24 * 60 * 60 * 1000;
  const mk = (over: Partial<RiskIncidentInput>): RiskIncidentInput => ({
    hazard_type: "restricted_zone",
    severity: "medium",
    occurred_at: new Date(now - day).toISOString(),
    resolved: false,
    ...over,
  });

  it("groups by hazard, uses worst severity, and sorts by score desc", () => {
    const risks = deriveRisksFromIncidents(
      [
        mk({ hazard_type: "restricted_zone", severity: "high" }),
        mk({ hazard_type: "restricted_zone", severity: "medium", zone_label: "Bay 2" }),
        mk({ hazard_type: "ppe_missing", severity: "low" }),
      ],
      now,
    );
    expect(risks).toHaveLength(2);
    expect(risks[0].score).toBeGreaterThanOrEqual(risks[1].score);

    const zone = risks.find((r) => r.hazardType === "restricted_zone")!;
    expect(zone.totalCount).toBe(2);
    expect(zone.severity).toBe(4); // worst observed = high
    expect(zone.likelihood).toBe(2); // 2 incidents in the window
    expect(zone.zones).toContain("Bay 2");
  });

  it("counts only in-window incidents for likelihood, but keeps the all-time total", () => {
    const risks = deriveRisksFromIncidents(
      [
        mk({ occurred_at: new Date(now - day).toISOString() }),
        mk({ occurred_at: new Date(now - 200 * day).toISOString() }),
      ],
      now,
    );
    expect(risks[0].totalCount).toBe(2);
    expect(risks[0].count).toBe(1);
    expect(risks[0].likelihood).toBe(2);
  });
});
