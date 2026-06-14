import { describe, it, expect } from "vitest";
import {
  applyObjectStates,
  applyStepStatuses,
  clampStepIndex,
  completeStep,
  nextStep,
  previousStep,
  resetSteps,
  setActiveStep,
} from "../features/build-mode/lib/planStepNav";
import {
  applyAssemblyPlanToScene,
  buildPlanSceneBlueprint,
} from "../features/build-mode/lib/sceneBlueprint";
import type {
  ExtractCandidate,
  PlanSceneBlueprint,
  SelectedRegion,
} from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0, y: 0, w: 1, h: 1 };

function cand(id: string, label: string, x: number): ExtractCandidate {
  return {
    id,
    label,
    bbox: { x, y: 0.4, w: 0.1, h: 0.1 },
    source: "yolo26-entity",
    confidence: 0.9,
  };
}

/** A 3-object scene with a real 3-step plan (each step moves one object). */
function scene(): PlanSceneBlueprint {
  const base = buildPlanSceneBlueprint({
    region: REGION,
    candidates: [cand("a", "board", 0.1), cand("b", "cable", 0.4), cand("c", "screw", 0.7)],
  });
  return applyAssemblyPlanToScene(base, [
    {
      objectId: "obj-1",
      title: "Place board",
      instruction: "center the board",
      to: { x: 0.5, y: 0.5 },
    },
    {
      objectId: "obj-2",
      title: "Route cable",
      instruction: "route the cable",
      to: { x: 0.6, y: 0.5 },
    },
    {
      objectId: "obj-3",
      title: "Fit screw",
      instruction: "fit the screw",
      to: { x: 0.7, y: 0.5 },
      safetyNote: "mind sharp edges",
    },
  ]);
}

describe("planStepNav — clampStepIndex", () => {
  it("clamps into 0..n-1 and handles empty", () => {
    expect(clampStepIndex(-3, 3)).toBe(0);
    expect(clampStepIndex(9, 3)).toBe(2);
    expect(clampStepIndex(1, 3)).toBe(1);
    expect(clampStepIndex(2, 0)).toBe(0);
  });
});

describe("planStepNav — status + object state stamping", () => {
  it("applyStepStatuses: active = index, earlier completed, later pending", () => {
    const s = scene();
    const stamped = applyStepStatuses(s.assemblySteps, 1);
    expect(stamped.map((x) => x.status)).toEqual(["completed", "active", "pending"]);
  });

  it("applyObjectStates: active object 'moving', completed 'placed', safety 'warning'", () => {
    const s = scene();
    // active = step 2 (index 2) which has a safetyNote → its object warns,
    // earlier objects placed.
    const objs = applyObjectStates(s.objects, s.assemblySteps, 2);
    const byId = new Map(objs.map((o) => [o.id, o.state]));
    expect(byId.get("obj-1")).toBe("placed");
    expect(byId.get("obj-2")).toBe("placed");
    expect(byId.get("obj-3")).toBe("warning");
  });

  it("the active non-safety object is 'moving'", () => {
    const s = scene();
    const objs = applyObjectStates(s.objects, s.assemblySteps, 0);
    expect(objs.find((o) => o.id === "obj-1")!.state).toBe("moving");
    expect(objs.find((o) => o.id === "obj-2")!.state).toBe("idle");
  });
});

describe("planStepNav — user-gated navigation (no auto-advance)", () => {
  it("nextStep marks the previous completed and the next active", () => {
    const s = scene();
    expect(s.currentStepIndex).toBe(0);
    const n1 = nextStep(s);
    expect(n1.currentStepIndex).toBe(1);
    expect(n1.assemblySteps[0].status).toBe("completed");
    expect(n1.assemblySteps[1].status).toBe("active");
    expect(n1.assemblySteps[2].status).toBe("pending");
  });

  it("nextStep clamps on the last step (never runs past the plan)", () => {
    let s = scene();
    s = nextStep(s); // 1
    s = nextStep(s); // 2 (last)
    s = nextStep(s); // clamp at 2
    expect(s.currentStepIndex).toBe(2);
    expect(s.assemblySteps[2].status).toBe("active");
    expect(s.assemblySteps.slice(0, 2).every((x) => x.status === "completed")).toBe(true);
  });

  it("previousStep walks back and clamps on the first step", () => {
    let s = scene();
    s = nextStep(s); // 1
    const back = previousStep(s);
    expect(back.currentStepIndex).toBe(0);
    expect(back.assemblySteps[0].status).toBe("active");
    expect(previousStep(back).currentStepIndex).toBe(0); // clamp
  });

  it("completeStep advances exactly one step (no timer-driven jumps)", () => {
    const s = scene();
    const after = completeStep(s);
    expect(after.currentStepIndex).toBe(1);
    // pure: calling it again is the ONLY way to advance — no hidden auto-advance.
    expect(completeStep(after).currentStepIndex).toBe(2);
  });

  it("resetSteps returns to step 1 with all later pending", () => {
    let s = scene();
    s = nextStep(nextStep(s)); // at last
    const reset = resetSteps(s);
    expect(reset.currentStepIndex).toBe(0);
    expect(reset.assemblySteps[0].status).toBe("active");
    expect(reset.assemblySteps.slice(1).every((x) => x.status === "pending")).toBe(true);
  });

  it("setActiveStep is pure — it returns a new scene and never mutates the input", () => {
    const s = scene();
    const snapshot = JSON.stringify(s);
    const moved = setActiveStep(s, 2);
    expect(JSON.stringify(s)).toBe(snapshot); // original untouched
    expect(moved).not.toBe(s);
    expect(moved.currentStepIndex).toBe(2);
  });

  it("exactly one step is active at any index", () => {
    const s = scene();
    for (let i = 0; i < s.assemblySteps.length; i++) {
      const moved = setActiveStep(s, i);
      expect(moved.assemblySteps.filter((x) => x.status === "active")).toHaveLength(1);
    }
  });
});
