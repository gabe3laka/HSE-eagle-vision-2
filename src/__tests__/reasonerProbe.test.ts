import { describe, expect, it } from "vitest";
import { buildReasonerProbe } from "@/components/live/ReasonerContractProbe";
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
