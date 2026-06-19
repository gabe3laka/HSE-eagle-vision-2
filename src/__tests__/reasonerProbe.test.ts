import { describe, it, expect } from "vitest";
import {
  buildReasonerProbe,
  buildReasonerDiagnostic,
  computeQwenDiagnostic,
} from "@/components/live/ReasonerContractProbe";
import {
  parseDetectRiskFields,
  summarizeDetectResponse,
} from "@/lib/detection/backendVisionHttpDetector";

function diagFromResp(resp: unknown, ctx: { forceReasonSent?: boolean } = {}) {
  const parsed = parseDetectRiskFields(resp);
  const summary = summarizeDetectResponse(resp, parsed, ctx);
  return { summary, diag: computeQwenDiagnostic(summary) };
}

describe("buildReasonerProbe — structured reasoner_status + scene_context", () => {
  it("detects Qwen contribution from object reasoner_status + scene_context, even with zero scene_risks", () => {
    const resp = {
      reasoner_status: { enabled: true, mode: "qwen_vl", state: "ready" },
      scene_context: { summary: "scaffold work" },
    };
    const parsed = parseDetectRiskFields(resp);
    const probe = buildReasonerProbe(parsed, resp, null);
    expect(probe.qwenDetected).toBe(true);
    expect(probe.endToEndWorking).toBe(false);
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
    // scene_context still present → result received counts qwenDetected true
    expect(probe.summary.reasoner.reasonerStatus).toBeNull();
    expect(probe.qwenDetected).toBe(true);
  });
});

describe("buildReasonerDiagnostic — legacy wording (back-compat)", () => {
  it("detection + qwen unavailable → 'not available' message", () => {
    const resp = {
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.9 }],
      reasoner_status: "unavailable",
    };
    const parsed = parseDetectRiskFields(resp);
    const diag = buildReasonerDiagnostic(buildReasonerProbe(parsed, resp, null));
    expect(diag.qwenState).toBe("unavailable");
    expect(diag.message).toMatch(/Qwen reasoning is not available/);
  });

  it("detection + qwen queued → 'queued/throttled' message", () => {
    const resp = {
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.9 }],
      reasoner_status: "queued",
    };
    const parsed = parseDetectRiskFields(resp);
    const diag = buildReasonerDiagnostic(buildReasonerProbe(parsed, resp, null));
    expect(diag.qwenState).toBe("queued");
    expect(diag.message).toMatch(/queued\/throttled/);
  });

  it("detection + qwen ready + 0 scene_risks → 'no active scene risks' message", () => {
    const resp = {
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.9 }],
      reasoner_status: "ready",
      scene_context: { summary: "desk scene" },
    };
    const parsed = parseDetectRiskFields(resp);
    const diag = buildReasonerDiagnostic(buildReasonerProbe(parsed, resp, null));
    expect(diag.qwenState).toBe("ready");
    expect(diag.message).toMatch(/no active scene risks/i);
  });
});

describe("computeQwenDiagnostic — strict states + wording", () => {
  it("no risk-aware fields → not_requested, resultReceived=false", () => {
    const { diag } = diagFromResp({ entities: [] });
    expect(diag.state).toBe("not_requested");
    expect(diag.qwenResultReceived).toBe(false);
    expect(diag.message).toMatch(/not requested/i);
  });

  it("warnings includes qwen_unavailable → unavailable + RunPod hint", () => {
    const { diag } = diagFromResp({
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
      warnings: ["qwen_unavailable"],
    });
    expect(diag.state).toBe("unavailable");
    expect(diag.qwenResultReceived).toBe(false);
    expect(diag.qwenUnavailableWarning).toBe(true);
    expect(diag.message).toMatch(/Check RunPod/i);
  });

  it("only temporal_reasoning → resultReceived=false", () => {
    const { diag } = diagFromResp({
      entities: [{ label: "cup", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
      temporal_reasoning: { last_frames: 3 },
    });
    expect(diag.qwenResultReceived).toBe(false);
  });

  it("scene_context present → resultReceived=true", () => {
    const { diag } = diagFromResp({
      entities: [],
      scene_context: { summary: "x" },
    });
    expect(diag.qwenResultReceived).toBe(true);
  });

  it("semantic_corrections > 0 → resultReceived=true", () => {
    const { diag } = diagFromResp({
      entities: [],
      semantic_corrections: [{ explanation: "fix" }],
    });
    expect(diag.qwenResultReceived).toBe(true);
  });

  it("ready + 0 scene_risks → ready_no_scene_risks", () => {
    const { diag } = diagFromResp({
      entities: [],
      reasoner_status: "ready",
      scene_risks: [],
    });
    expect(diag.state).toBe("ready_no_scene_risks");
    expect(diag.qwenResultReceived).toBe(true);
  });

  it("ready + 1 scene_risk → ready_with_scene_risks", () => {
    const { diag } = diagFromResp({
      entities: [],
      reasoner_status: "ready",
      scene_risks: [{ hazard: "blocked_path", risk_level: "YELLOW" }],
    });
    expect(diag.state).toBe("ready_with_scene_risks");
    expect(diag.qwenResultReceived).toBe(true);
  });

  it("raw 'throttled' → normalized 'queued'", () => {
    const { diag } = diagFromResp({ reasoner_status: "throttled" });
    expect(diag.rawReasonerStatus).toBe("throttled");
    expect(diag.state).toBe("queued");
  });

  it("fields present but empty schema → fields_present_empty, message says 'not received'", () => {
    const { diag } = diagFromResp({
      entities: [],
      scene_risks: [],
      warnings: [],
    });
    // schema_version absent, no status, but scene_risks: [] is a risk-aware field
    expect(diag.state).toBe("fields_present_empty");
    expect(diag.qwenResultReceived).toBe(false);
    expect(diag.message).not.toMatch(/scene understanding/i);
    expect(diag.message).toMatch(/not received/i);
  });

  it("forceReasonSent flag propagates from summarizeDetectResponse", () => {
    const { diag } = diagFromResp({}, { forceReasonSent: true });
    expect(diag.forceReasonSent).toBe(true);
  });
});
