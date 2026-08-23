import { describe, expect, it, vi } from "vitest";
import { draftRiskFromIncident } from "./reasoningClient";
import type { IncidentRow } from "@/integrations/supabase/db";

/** composerRespond mapping: the frontend's whole intent routing rides on this
 *  translation of the edge-function payload, so pin every branch. */
describe("composerRespond — response mapping", () => {
  async function withInvoke(payload: unknown) {
    // Reset FIRST: the suite's static import already cached the real module;
    // the mock only takes effect on a fresh import.
    vi.resetModules();
    vi.doMock("@/integrations/supabase/own-client", () => ({
      supabase: { functions: { invoke: async () => ({ data: payload, error: null }) } },
    }));
    const { composerRespond } = await import("./reasoningClient");
    const res = await composerRespond({ text: "x", media: [] });
    vi.doUnmock("@/integrations/supabase/own-client");
    return res;
  }

  it("maps kind 'report' with a draft to a report", async () => {
    const draft = { title: "t", severity: "low" };
    await expect(withInvoke({ status: "ok", kind: "report", draft })).resolves.toEqual({
      kind: "report",
      draft,
    });
  });

  it("maps kind 'answer' to an answer and never a report", async () => {
    await expect(
      withInvoke({ status: "ok", kind: "answer", answer: "A risk assessment is…", draft: null }),
    ).resolves.toEqual({ kind: "answer", answer: "A risk assessment is…" });
  });

  it("maps status 'limit' to limit (guest out of credits — no empty review)", async () => {
    await expect(withInvoke({ status: "limit", draft: null })).resolves.toEqual({ kind: "limit" });
  });

  it("stays backward compatible: legacy payload without kind still yields a report", async () => {
    const draft = { title: "legacy" };
    await expect(withInvoke({ status: "ok", draft })).resolves.toEqual({ kind: "report", draft });
  });

  it("maps empty/garbage payloads to error (caller persists the note manually)", async () => {
    await expect(withInvoke(null)).resolves.toEqual({ kind: "error" });
    await expect(withInvoke({ status: "ok", kind: "answer", answer: "  " })).resolves.toEqual({
      kind: "error",
    });
  });

  it("forwards lensContext in the request body verbatim, and null when absent", async () => {
    vi.resetModules();
    const invoke = vi.fn(async () => ({ data: { status: "ok", kind: "answer", answer: "ok" } }));
    vi.doMock("@/integrations/supabase/own-client", () => ({
      supabase: { functions: { invoke } },
    }));
    const { composerRespond } = await import("./reasoningClient");

    const lensContext = {
      track_id: "t1",
      label: "forklift",
      bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      risk_level: "RED",
      severity: 4,
      likelihood: 3,
      frame_ts: 123,
    };
    await composerRespond({ text: "x", media: [], lensContext });
    expect(invoke).toHaveBeenLastCalledWith(
      "report-draft",
      expect.objectContaining({ body: expect.objectContaining({ lensContext }) }),
    );

    await composerRespond({ text: "x", media: [] });
    expect(invoke).toHaveBeenLastCalledWith(
      "report-draft",
      expect.objectContaining({ body: expect.objectContaining({ lensContext: null }) }),
    );
    vi.doUnmock("@/integrations/supabase/own-client");
  });
});

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
