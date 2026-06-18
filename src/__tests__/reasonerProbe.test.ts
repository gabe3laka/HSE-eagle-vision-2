import { describe, expect, it } from "vitest";
import {
  buildReasonerProbe,
  buildReasonerDiagnostic,
} from "@/components/live/ReasonerContractProbe";
import { parseDetectRiskFields } from "@/lib/detection/backendVisionHttpDetector";

describe("buildReasonerProbe — structured reasoner_status + scene_context", () => {
  it("detects Qwen contribution from object reasoner_status + scene_context, even with zero scene_risks", () => {
    const resp = {
      reasoner_status: { enabled: true, mode: "qwen_vl", state: "ready" },
      scene_context: { summary: "scaffold work" },
    };
    const parsed = parseDetectRiskFields(resp);
    const probe = buildReasonerProbe(parsed, resp, null);
    expect(probe.qwenDetected).toBe(true);
    expect(probe.endToEndWorking).toBe(false); // no scene_risks → not end-to-end
    expect(probe.summary.reasoner.reasonerStatus).toBe("ready");
    expect(probe.summary.reasoner.sceneContextPresent).toBe(true);
  });

  it("does NOT report Qwen ready for an unknown structured status", () => {
    const resp = {
      reasoner_status: { foo: "bar" },
      scene_context: { summary: "x" },
    };
    const parsed = parseDetectRiskFields(resp);
    const probe = buildReasonerProbe(parsed, resp, null);
    expect(probe.qwenDetected).toBe(false);
    expect(probe.summary.reasoner.reasonerStatus).toBeNull();
  });

  it("surfaces raw reasoner fields when parsedRisk is null", () => {
    const resp = {
      reasoner_status: "ready",
      scene_context: { summary: "x" },
      semantic_corrections: [{ explanation: "fix" }],
    };
    const probe = buildReasonerProbe(null, resp, null);
    expect(probe.summary.reasoner.reasonerStatus).toBe("ready");
    expect(probe.summary.reasoner.sceneContextPresent).toBe(true);
    expect(probe.summary.reasoner.semanticCorrections).toBe(1);
    expect(probe.qwenDetected).toBe(true);
  });
});

describe("buildReasonerDiagnostic — detection vs Qwen state messages", () => {
  it("detection working + qwen unavailable → 'not available' message", () => {
    const resp = {
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.9 }],
      reasoner_status: "unavailable",
    };
    const parsed = parseDetectRiskFields(resp);
    const diag = buildReasonerDiagnostic(buildReasonerProbe(parsed, resp, null));
    expect(diag.detectionOk).toBe(true);
    expect(diag.qwenState).toBe("unavailable");
    expect(diag.message).toMatch(/Detection is working.*Qwen reasoning is not available/);
  });

  it("detection working + qwen queued → 'queued/throttled' message", () => {
    const resp = {
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.9 }],
      reasoner_status: "queued",
    };
    const parsed = parseDetectRiskFields(resp);
    const diag = buildReasonerDiagnostic(buildReasonerProbe(parsed, resp, null));
    expect(diag.detectionOk).toBe(true);
    expect(diag.qwenState).toBe("queued");
    expect(diag.message).toMatch(/queued\/throttled/);
  });

  it("detection working + qwen ready + 0 scene_risks → 'no active scene risks' message", () => {
    const resp = {
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.9 }],
      reasoner_status: "ready",
      scene_context: { summary: "desk scene" },
    };
    const parsed = parseDetectRiskFields(resp);
    const diag = buildReasonerDiagnostic(buildReasonerProbe(parsed, resp, null));
    expect(diag.detectionOk).toBe(true);
    expect(diag.qwenState).toBe("ready");
    expect(diag.sceneRisks).toBe(0);
    expect(diag.message).toMatch(/no active scene risks/i);
  });
});
