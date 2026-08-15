import { describe, expect, it } from "vitest";
import { draftRiskFromIncident } from "./reasoningClient";
import type { IncidentRow } from "@/integrations/supabase/db";

function incident(over: Partial<IncidentRow> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    hazard_type: "forklift_proximity" as const,
    severity: "high" as const,
    message: "Forklift passed within a metre of two workers.",
    zone_label: "Loading bay",
    detection_id: "d1",
    occurred_at: "2026-08-01T10:00:00Z",
    ...over,
  };
}

describe("draftRiskFromIncident — deterministic prefill at the reasoning seam", () => {
  it("titles from the hazard label + zone and carries the incident message", () => {
    const d = draftRiskFromIncident(incident());
    expect(d.title).toMatch(/Loading bay/);
    expect(d.description).toContain("Forklift passed within a metre");
    expect(d.description).toContain("approved incident");
    expect(d.hazard_type).toBe("forklift_proximity");
    expect(d.zone_label).toBe("Loading bay");
    expect(d.status).toBe("open");
  });

  it("maps qualitative severity to conservative 1–5 scores", () => {
    expect(draftRiskFromIncident(incident({ severity: "critical" }))).toMatchObject({
      likelihood: 4,
      severity: 5,
    });
    expect(draftRiskFromIncident(incident({ severity: "low" }))).toMatchObject({
      likelihood: 2,
      severity: 2,
    });
  });

  it("keeps camera provenance for detection-initiated incidents, manual otherwise", () => {
    expect(draftRiskFromIncident(incident()).source).toBe("camera");
    expect(draftRiskFromIncident(incident({ detection_id: null })).source).toBe("manual");
  });
});
