import { describe, it, expect } from "vitest";
import {
  buildPlanReasoningPayload,
  buildRulesFallback,
  mergePlanReasoning,
  validatePlanReasoning,
} from "../features/build-mode/lib/planReasoning";
import { requestPlanReasoning } from "../features/build-mode/api/planReasoningClient";
import { shouldShowBlueprintDebugLabels } from "../features/build-mode/lib/debugLabels";
import type {
  BlueprintFrame,
  BuildUserIntent,
  PlanReasoningPayload,
} from "../features/build-mode/types";

const PAYLOAD: PlanReasoningPayload = {
  sessionId: "s1",
  workflowMode: "plan",
  goalText: "Help me assemble this PCB board",
  taskType: "build",
  selectedLabel: "pcb board",
  coordinateSystem: {
    type: "normalized-crop-2d",
    xRange: [0, 1],
    yRange: [0, 1],
    origin: "top-left",
  },
};

const baseFrame = (): BlueprintFrame => ({
  sessionId: "s1",
  frameId: "f-0",
  timestampMs: 0,
  outline: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ],
  anchors: [{ id: "a", x: 0.2, y: 0.2 }],
  maskSource: "yolo26-seg",
});

describe("Plan reasoning — strict validation + coordinate clamping", () => {
  it("clamps every x/y into 0..1 and keeps known shapes", () => {
    const r = validatePlanReasoning({
      status: "ok",
      source: "deepseek",
      detectedIntent: "assemble pcb",
      suggestedGoals: ["Identify these parts", ""],
      nextAction: "align the board",
      aiNotes: [{ id: "n1", type: "next-step", text: "align", x: 2, y: -1 }],
      planSteps: [{ id: "p1", title: "T", instruction: "do", x: 1.5, y: 0.5, status: "active" }],
      planOverlays: [{ id: "o1", type: "target", x: 9, y: -3 }],
      virtualBlueprintPoints: [{ id: "v1", role: "alignment-point", x: 5, y: 5 }],
    })!;
    expect(r.aiNotes[0].x).toBe(1);
    expect(r.aiNotes[0].y).toBe(0);
    expect(r.planSteps[0].x).toBe(1);
    expect(r.planOverlays[0].x).toBe(1);
    expect(r.planOverlays[0].y).toBe(0);
    expect(r.virtualBlueprintPoints[0].x).toBe(1);
    expect(r.suggestedGoals).toEqual(["Identify these parts"]); // empty dropped
  });

  it("drops unknown overlay types and coerces unknown point roles to anchor", () => {
    const r = validatePlanReasoning({
      planSteps: [{ id: "p1", title: "T", instruction: "do", x: 0.5, y: 0.5, status: "active" }],
      planOverlays: [
        { id: "ok", type: "arrow", from: { x: 0.1, y: 0.1 }, to: { x: 0.2, y: 0.2 } },
        { id: "weird", type: "mystery-overlay", x: 0.5, y: 0.5 },
      ],
      virtualBlueprintPoints: [{ id: "v", role: "frobnicate", x: 0.4, y: 0.4 }],
    })!;
    expect(r.planOverlays).toHaveLength(1);
    expect(r.planOverlays[0].type).toBe("arrow");
    expect(r.virtualBlueprintPoints[0].role).toBe("anchor");
  });

  it("returns null for non-objects so the caller can fall back", () => {
    expect(validatePlanReasoning(null)).toBeNull();
    expect(validatePlanReasoning("nope")).toBeNull();
    expect(validatePlanReasoning(42)).toBeNull();
  });
});

describe("Plan reasoning — local rules fallback", () => {
  it("produces a usable plan (steps + overlays + virtual points) without network", () => {
    const r = buildRulesFallback(PAYLOAD);
    expect(r.status).toBe("fallback");
    expect(r.source).toBe("rules");
    expect(r.planSteps.length).toBeGreaterThanOrEqual(3);
    expect(r.planSteps[0].status).toBe("active");
    expect(r.planOverlays.length).toBeGreaterThan(0);
    expect(r.virtualBlueprintPoints.length).toBeGreaterThan(0);
    expect(r.suggestedGoals.length).toBeGreaterThan(0);
    for (const p of r.virtualBlueprintPoints) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });

  it("a dangerous goal yields safety-first guidance + warning points", () => {
    const r = buildRulesFallback({
      ...PAYLOAD,
      taskType: "repair",
      goalText: "rewire this live electrical panel",
    });
    expect(r.safetyWarning).toBeTruthy();
    expect(r.nextAction.toLowerCase()).toMatch(/safe/);
    expect(r.virtualBlueprintPoints.some((p) => p.role === "warning-point")).toBe(true);
  });
});

describe("Plan reasoning — merge keeps worker geometry, adds reasoning", () => {
  it("never replaces the crop/outline/mask; fills reasoning fields", () => {
    const frame = baseFrame();
    const resp = buildRulesFallback(PAYLOAD);
    const merged = mergePlanReasoning(frame, resp);
    // worker geometry preserved
    expect(merged.outline).toEqual(frame.outline);
    expect(merged.anchors).toEqual(frame.anchors);
    expect(merged.maskSource).toBe("yolo26-seg");
    // reasoning merged in
    expect(merged.planSteps!.length).toBeGreaterThan(0);
    expect(merged.planOverlays!.length).toBeGreaterThan(0);
    expect(merged.virtualBlueprintPoints!.length).toBeGreaterThan(0);
    expect(merged.reasoningSource).toBe("rules");
    expect(merged.currentPlanStepIndex).toBe(0);
  });

  it("empty reasoning arrays leave the worker frame's values intact", () => {
    const frame = {
      ...baseFrame(),
      planSteps: [{ id: "w", title: "W", instruction: "x", status: "active" as const }],
    };
    const merged = mergePlanReasoning(frame, {
      status: "fallback",
      source: "rules",
      detectedIntent: "",
      suggestedGoals: [],
      nextAction: "",
      aiNotes: [],
      planSteps: [],
      planOverlays: [],
      virtualBlueprintPoints: [],
    });
    expect(merged.planSteps).toEqual(frame.planSteps); // worker steps kept
    expect(merged.virtualBlueprintPoints).toEqual([]);
  });
});

describe("Plan reasoning — payload builder", () => {
  it("builds a compact image-free payload from the intent + frame", () => {
    const intent: BuildUserIntent = { taskType: "build", text: "assemble pcb", confirmed: true };
    const p = buildPlanReasoningPayload({
      sessionId: "abc",
      intent,
      frame: baseFrame(),
      selectedLabel: "pcb board",
      detectedEntities: [{ label: "pcb board", confidence: 0.8, source: "yolo26" }],
    });
    expect(p.workflowMode).toBe("plan");
    expect(p.goalText).toBe("assemble pcb");
    expect(p.taskType).toBe("build");
    expect(p.selectedLabel).toBe("pcb board");
    expect(p.blueprintFrame?.maskSource).toBe("yolo26-seg");
    expect(p.coordinateSystem.type).toBe("normalized-crop-2d");
    // never carries an image
    expect(JSON.stringify(p)).not.toContain("image_b64");
  });
});

describe("Plan reasoning — client uses Supabase, never DeepSeek directly", () => {
  it("invokes the 'plan-reasoning' Edge Function (not api.deepseek.com)", async () => {
    const calls: string[] = [];
    const fakeInvoke = async (name: string) => {
      calls.push(name);
      return {
        data: {
          status: "ok",
          source: "deepseek",
          detectedIntent: "assemble",
          suggestedGoals: ["Help assemble these pieces"],
          nextAction: "align",
          aiNotes: [{ id: "n", type: "next-step", text: "align", x: 0.5, y: 0.5 }],
          planSteps: [
            { id: "p1", title: "T", instruction: "align", x: 0.5, y: 0.5, status: "active" },
          ],
          planOverlays: [{ id: "o", type: "target", x: 0.5, y: 0.5 }],
          virtualBlueprintPoints: [{ id: "v", role: "target-position", x: 0.5, y: 0.5 }],
        },
        error: null,
      };
    };
    const r = await requestPlanReasoning(PAYLOAD, fakeInvoke);
    expect(calls).toEqual(["plan-reasoning"]);
    expect(r.source).toBe("deepseek");
    expect(r.planSteps).toHaveLength(1);
  });

  it("falls back to local rules when the function returns a fallback marker (missing key)", async () => {
    const r = await requestPlanReasoning(PAYLOAD, async () => ({
      data: { status: "fallback", source: "rules" },
      error: null,
    }));
    expect(r.source).toBe("rules");
    expect(r.status).toBe("fallback");
    expect(r.planSteps.length).toBeGreaterThan(0); // local templates filled it
  });

  it("falls back when the function errors or returns invalid JSON", async () => {
    const onError = await requestPlanReasoning(PAYLOAD, async () => ({
      data: null,
      error: { message: "boom" },
    }));
    expect(onError.source).toBe("rules");
    const onGarbage = await requestPlanReasoning(PAYLOAD, async () => ({
      data: "not-an-object",
      error: null,
    }));
    expect(onGarbage.source).toBe("rules");
    expect(onGarbage.planSteps.length).toBeGreaterThan(0);
  });
});

describe("Blueprint debug labels are hidden by default", () => {
  it("only shows debug labels when explicitly enabled (and in dev)", () => {
    expect(shouldShowBlueprintDebugLabels(false)).toBe(false);
    expect(shouldShowBlueprintDebugLabels(undefined)).toBe(false);
    // vitest runs in dev mode, so an explicit opt-in is honored there
    expect(shouldShowBlueprintDebugLabels(true)).toBe(import.meta.env.DEV);
  });
});
