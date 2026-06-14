import { describe, it, expect } from "vitest";
import {
  applyAssemblyPlanToScene,
  buildAssemblyStepsAndTimeline,
  buildPlanSceneBlueprint,
  candidateToSceneObject,
  estimatePlanConfidence,
  inferPlanObjectRole,
  planRoleDisplayLabel,
} from "../features/build-mode/lib/sceneBlueprint";
import type { PlanObjectRole } from "../features/build-mode/types";
import {
  buildPlanReasoningPayload,
  resolveAssemblyPlan,
  validatePlanReasoning,
} from "../features/build-mode/lib/planReasoning";
import type {
  BlueprintFrame,
  BuildUserIntent,
  ExtractCandidate,
  PlanAssemblyPlanItem,
  PlanReasoningResponse,
  SelectedRegion,
} from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

function candidate(
  id: string,
  label: string,
  bbox: SelectedRegion,
  extra: Partial<ExtractCandidate> = {},
): ExtractCandidate {
  return { id, label, bbox, source: "yolo26-entity", confidence: 0.8, ...extra };
}

describe("Holographic scene — buildPlanSceneBlueprint", () => {
  const candidates = [
    candidate("c1", "PCB board", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
    candidate("c2", "USB cable", { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }),
    candidate("c3", "screwdriver", { x: 0.8, y: 0.2, w: 0.1, h: 0.1 }),
  ];

  it("converts N candidates into N scene objects with stable ids", () => {
    const scene = buildPlanSceneBlueprint({ region: REGION, candidates });
    expect(scene.version).toBe("plan-scene-v1");
    expect(scene.objects).toHaveLength(3);
    expect(scene.objects.map((o) => o.id)).toEqual(["obj-1", "obj-2", "obj-3"]);
    expect(scene.region).toEqual(REGION);
  });

  it("currentStepIndex starts at 0 and placeholder steps cover every object", () => {
    const scene = buildPlanSceneBlueprint({ region: REGION, candidates });
    expect(scene.currentStepIndex).toBe(0);
    expect(scene.assemblySteps.length).toBe(3);
    expect(scene.assemblySteps[0].status).toBe("active");
    expect(scene.assemblySteps.slice(1).every((s) => s.status === "pending")).toBe(true);
    expect(scene.animationTimeline.length).toBeGreaterThan(0);
  });

  it("clamps out-of-range coords into 0..1 and computes the bbox center + current", () => {
    const scene = buildPlanSceneBlueprint({
      region: REGION,
      candidates: [candidate("x", "board", { x: -0.5, y: 1.4, w: 2, h: 2 })],
    });
    const o = scene.objects[0];
    for (const v of [o.bbox.x, o.bbox.y, o.bbox.w, o.bbox.h, o.center.x, o.center.y]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(o.current).toEqual({ x: o.center.x, y: o.center.y });
    expect(o.state).toBe("idle");
  });

  it("preserves label/confidence/maskContour and derives an outline from the mask", () => {
    const mask = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.2, y: 0.3 },
    ];
    const o = candidateToSceneObject(
      candidate("m", "sensor module", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { maskContour: mask }),
      0,
    );
    expect(o.label).toBe("sensor module");
    expect(o.confidence).toBe(0.8);
    expect(o.maskContour).toHaveLength(3);
    expect(o.outline).toEqual(o.maskContour);
  });

  it("an empty candidate set yields zero objects but still a usable placeholder plan", () => {
    const scene = buildPlanSceneBlueprint({ region: REGION, candidates: [] });
    expect(scene.objects).toHaveLength(0);
    expect(scene.assemblySteps.length).toBe(1); // "Scan the scene"
    expect(scene.currentStepIndex).toBe(0);
  });
});

describe("Holographic scene — inferPlanObjectRole", () => {
  it.each([
    ["USB cable", "cable"],
    ["ribbon wire", "cable"],
    ["PCB board", "primary-part"],
    ["laptop", "primary-part"],
    ["sensor module", "primary-part"],
    ["USB connector", "connector"],
    ["display port", "connector"],
    ["M3 screw", "fastener"],
    ["hex bolt", "fastener"],
    ["nut", "fastener"],
    ["utility knife", "hazard"],
    ["scissors", "hazard"],
    ["razor blade", "hazard"],
    ["screwdriver", "tool"],
    ["needle-nose pliers", "tool"],
    ["mounting bracket", "support"],
    ["tripod stand", "support"],
    ["banana", "unknown"],
    ["", "unknown"],
  ] as const)("maps %s → %s", (label, role) => {
    expect(inferPlanObjectRole(label)).toBe(role);
  });

  it("is case-insensitive and lets cable win over connector words", () => {
    expect(inferPlanObjectRole("USB CONNECTOR CABLE")).toBe("cable");
    expect(inferPlanObjectRole("Pcb Board")).toBe("primary-part");
  });
});

describe("Holographic scene — planRoleDisplayLabel (Detected Objects subtitles)", () => {
  it.each([
    ["primary-part", "PRIMARY PART"],
    ["tool", "TOOL"],
    ["connector", "CONNECTOR"],
    ["cable", "CABLE"],
    ["fastener", "FASTENER"],
    ["support", "SUPPORT"],
    ["hazard", "HAZARD"],
    ["unknown", "OBJECT"],
  ] as const)("maps role %s → %s", (role, label) => {
    expect(planRoleDisplayLabel(role)).toBe(label);
  });

  it("covers every PlanObjectRole with a non-empty UPPERCASE label", () => {
    const roles: PlanObjectRole[] = [
      "primary-part",
      "tool",
      "connector",
      "cable",
      "fastener",
      "support",
      "hazard",
      "unknown",
    ];
    for (const r of roles) {
      const label = planRoleDisplayLabel(r);
      expect(label.length).toBeGreaterThan(0);
      expect(label).toBe(label.toUpperCase());
    }
  });
});

describe("Holographic scene — estimatePlanConfidence (heuristic %)", () => {
  it("rates DeepSeek (ok) reasoning higher than the rules fallback", () => {
    const ok = estimatePlanConfidence({ reasoningStatus: "ok", objects: [] });
    const fallback = estimatePlanConfidence({ reasoningStatus: "fallback", objects: [] });
    expect(ok).toBeGreaterThan(fallback);
    expect(ok).toBeCloseTo(0.9, 5);
    expect(fallback).toBeCloseTo(0.6, 5);
  });

  it("defaults to a neutral mid value when idle / no reasoning yet", () => {
    expect(estimatePlanConfidence({})).toBeCloseTo(0.5, 5);
    expect(estimatePlanConfidence({ reasoningStatus: "idle", objects: [] })).toBeCloseTo(0.5, 5);
  });

  it("nudges up for confident detections and down for weak ones (bounded ±0.06)", () => {
    const strong = estimatePlanConfidence({
      reasoningStatus: "ok",
      objects: [{ confidence: 1 }, { confidence: 1 }],
    });
    const weak = estimatePlanConfidence({
      reasoningStatus: "ok",
      objects: [{ confidence: 0.1 }, { confidence: 0.1 }],
    });
    expect(strong).toBeGreaterThan(0.9);
    expect(strong).toBeLessThanOrEqual(0.96);
    expect(weak).toBeLessThan(0.9);
    expect(weak).toBeGreaterThanOrEqual(0.84);
  });

  it("ignores non-finite confidences and always clamps to 0..1", () => {
    const v = estimatePlanConfidence({
      reasoningStatus: "ok",
      objects: [{ confidence: NaN }, { confidence: undefined }, { confidence: 0.9 }],
    });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("Holographic scene — assembly steps + timeline mapping", () => {
  const objects = buildPlanSceneBlueprint({
    region: REGION,
    candidates: [
      candidate("c1", "board", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
      candidate("c2", "cable", { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }),
    ],
  }).objects;

  it("maps an assemblyPlan into ordered steps, clamping from/to", () => {
    const plan: PlanAssemblyPlanItem[] = [
      {
        objectId: "obj-1",
        title: "Place board",
        instruction: "Move the board to the center",
        from: { x: 0.2, y: 0.2 },
        to: { x: 5, y: -2 },
      },
      { objectId: "obj-2", title: "Route cable", instruction: "Route the cable along the edge" },
    ];
    const { assemblySteps, animationTimeline } = buildAssemblyStepsAndTimeline(plan, objects);
    expect(assemblySteps).toHaveLength(2);
    expect(assemblySteps[0].id).toBe("step-1");
    expect(assemblySteps[0].index).toBe(0);
    expect(assemblySteps[0].status).toBe("active");
    expect(assemblySteps[1].status).toBe("pending");
    // to clamped 0..1
    expect(assemblySteps[0].to).toEqual({ x: 1, y: 0 });
    // a moving step produces move/arrow/target keyframes
    expect(animationTimeline.some((k) => k.type === "move-object")).toBe(true);
    expect(animationTimeline.some((k) => k.type === "show-arrow")).toBe(true);
  });

  it("a step referencing a missing objectId does not crash and produces no move", () => {
    const plan: PlanAssemblyPlanItem[] = [
      {
        objectId: "ghost-999",
        title: "Phantom",
        instruction: "no such object",
        to: { x: 0.5, y: 0.5 },
      },
    ];
    const { assemblySteps, animationTimeline } = buildAssemblyStepsAndTimeline(plan, objects);
    expect(assemblySteps[0].objectId).toBeUndefined(); // unknown id dropped
    expect(animationTimeline.some((k) => k.type === "move-object")).toBe(false);
    // still has a callout for the instruction
    expect(animationTimeline.some((k) => k.type === "show-callout")).toBe(true);
  });

  it("applyAssemblyPlanToScene stamps targets on moved objects and resets to step 0", () => {
    const scene = buildPlanSceneBlueprint({
      region: REGION,
      candidates: [
        candidate("c1", "board", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
        candidate("c2", "cable", { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }),
      ],
    });
    const updated = applyAssemblyPlanToScene(scene, [
      {
        objectId: "obj-1",
        title: "Center board",
        instruction: "center it",
        to: { x: 0.5, y: 0.5 },
      },
    ]);
    const board = updated.objects.find((o) => o.id === "obj-1")!;
    const cable = updated.objects.find((o) => o.id === "obj-2")!;
    expect(board.target).toEqual({ x: 0.5, y: 0.5 });
    expect(cable.target).toBeUndefined();
    expect(updated.currentStepIndex).toBe(0);
    expect(updated.assemblySteps).toHaveLength(1);
  });
});

describe("Holographic scene — resolveAssemblyPlan bridges the reasoning shapes", () => {
  function resp(partial: Partial<PlanReasoningResponse>): PlanReasoningResponse {
    return {
      status: "ok",
      source: "deepseek",
      detectedIntent: "",
      suggestedGoals: [],
      nextAction: "",
      aiNotes: [],
      planSteps: [],
      planOverlays: [],
      virtualBlueprintPoints: [],
      ...partial,
    };
  }

  it("uses assemblyPlan when present", () => {
    const plan = resolveAssemblyPlan(
      resp({
        assemblyPlan: [{ objectId: "obj-1", title: "T", instruction: "do it" }],
        planSteps: [{ id: "p1", title: "ignored", instruction: "ignored", status: "active" }],
      }),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].objectId).toBe("obj-1");
    expect(plan[0].title).toBe("T");
  });

  it("falls back to mapping planSteps (+ arrow overlay for from/to) when no assemblyPlan", () => {
    const plan = resolveAssemblyPlan(
      resp({
        planSteps: [
          {
            id: "p1",
            title: "Align",
            instruction: "align the part",
            x: 0.5,
            y: 0.5,
            status: "active",
          },
        ],
        planOverlays: [
          {
            id: "o1",
            type: "arrow",
            stepId: "p1",
            from: { x: 0.2, y: 0.2 },
            to: { x: 0.7, y: 0.7 },
          },
        ],
      }),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].title).toBe("Align");
    expect(plan[0].from).toEqual({ x: 0.2, y: 0.2 });
    expect(plan[0].to).toEqual({ x: 0.7, y: 0.7 });
  });

  it("pulls `to` from a target overlay when there is no arrow", () => {
    const plan = resolveAssemblyPlan(
      resp({
        planSteps: [{ id: "p1", title: "Set", instruction: "set it", status: "active" }],
        planOverlays: [{ id: "o1", type: "target", stepId: "p1", x: 0.4, y: 0.6 }],
      }),
    );
    expect(plan[0].to).toEqual({ x: 0.4, y: 0.6 });
    expect(plan[0].from).toBeUndefined();
  });
});

describe("Plan reasoning — assemblyPlan validation (backward compatible)", () => {
  it("parses and clamps an optional assemblyPlan, ignoring junk entries", () => {
    const r = validatePlanReasoning({
      planSteps: [{ id: "p1", title: "T", instruction: "do", x: 0.5, y: 0.5, status: "active" }],
      assemblyPlan: [
        { objectId: "obj-1", title: "Move", instruction: "move it", to: { x: 2, y: -1 } },
        { nope: true },
        { title: "", instruction: "" },
      ],
    })!;
    expect(r.assemblyPlan).toHaveLength(1);
    expect(r.assemblyPlan![0].to).toEqual({ x: 1, y: 0 });
  });

  it("an OLD single-object blueprint response (no assemblyPlan) still validates", () => {
    const r = validatePlanReasoning({
      status: "ok",
      source: "deepseek",
      detectedIntent: "inspect",
      suggestedGoals: ["Inspect for damage"],
      nextAction: "look closely",
      aiNotes: [{ id: "n", type: "next-step", text: "look", x: 0.5, y: 0.5 }],
      planSteps: [
        { id: "p1", title: "Check", instruction: "check it", x: 0.5, y: 0.5, status: "active" },
      ],
      planOverlays: [{ id: "o", type: "highlight", x: 0.5, y: 0.5 }],
      virtualBlueprintPoints: [],
    })!;
    expect(r).not.toBeNull();
    expect(r.planSteps).toHaveLength(1);
    expect(r.assemblyPlan).toBeUndefined(); // additive — absent means absent
  });
});

describe("Plan reasoning — payload includes the scene objects when present", () => {
  const frame = (): BlueprintFrame => ({
    sessionId: "s1",
    frameId: "f-0",
    timestampMs: 0,
    outline: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ],
    anchors: [],
    maskSource: "none",
  });
  const intent: BuildUserIntent = { taskType: "build", text: "assemble", confirmed: true };

  it("adds objects + scene{mode,coordinateSystem} but stays image-free", () => {
    const sceneObjects = buildPlanSceneBlueprint({
      region: REGION,
      candidates: [
        candidate("c1", "board", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
        candidate("c2", "cable", { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }),
      ],
    }).objects;
    const p = buildPlanReasoningPayload({ sessionId: "s1", intent, frame: frame(), sceneObjects });
    expect(p.objects).toHaveLength(2);
    expect(p.objects![0]).toMatchObject({ id: "obj-1", label: "board", role: "primary-part" });
    expect(p.scene).toEqual({
      mode: "table-layout",
      coordinateSystem: "normalized 0..1 crop-local",
    });
    expect(JSON.stringify(p)).not.toContain("image_b64");
  });

  it("omits objects/scene when no scene objects are supplied (single-object path)", () => {
    const p = buildPlanReasoningPayload({ sessionId: "s1", intent, frame: frame() });
    expect(p.objects).toBeUndefined();
    expect(p.scene).toBeUndefined();
  });
});
