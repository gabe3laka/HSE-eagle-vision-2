import { describe, it, expect } from "vitest";
import {
  derivePlanStage,
  intentLabel,
  isDangerousTask,
  mockBlueprintFrame,
  mockPlanOverlays,
  mockPlanSteps,
  stepTemplateForIntent,
} from "../features/build-mode/lib/blueprint";
import { chooseCalloutSide, layoutCallouts } from "../features/build-mode/lib/calloutLayout";
import type { BlueprintNote, BuildUserIntent, SelectedRegion } from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };

describe("Plan Mode — dangerous-task safety behaviour", () => {
  const danger: BuildUserIntent = {
    taskType: "repair",
    text: "how do I rewire this electrical panel",
    confirmed: true,
  };

  it("flags dangerous free-text intents", () => {
    expect(isDangerousTask(danger)).toBe(true);
    expect(
      isDangerousTask({ taskType: "repair", text: "fix the wobbly leg", confirmed: true }),
    ).toBe(false);
    expect(isDangerousTask(null)).toBe(false);
    expect(isDangerousTask({ confirmed: true })).toBe(false);
  });

  it("leads with safety/inspection steps, never risky direct actions", () => {
    const steps = stepTemplateForIntent(danger);
    expect(steps[0].instruction.toLowerCase()).toMatch(/isolated|safe/);
    // no step tells the user to directly operate on live hardware
    for (const s of steps) {
      expect(s.instruction.toLowerCase()).not.toMatch(/connect the wires|touch the wir/);
    }
  });

  it("a dangerous plan frame shows a safety warning + warning-zone overlay, high importance", () => {
    const f = mockBlueprintFrame("s", 0, 0, REGION, "plan", danger);
    expect(f.safetyWarning).toBeTruthy();
    expect(f.importance).toBe("high");
    expect(f.nextAction).toMatch(/confirm it is safe/i);
    expect(f.planOverlays!.some((o) => o.type === "warning-zone")).toBe(true);
    expect(f.aiNotes!.some((n) => n.type === "safety")).toBe(true);
  });
});

describe("Plan Mode — intent labels + per-task templates", () => {
  it("labels task types and free text", () => {
    expect(intentLabel({ taskType: "inspect", confirmed: true })).toBe("inspect");
    expect(intentLabel({ taskType: "install-remove", confirmed: true })).toBe("install / remove");
    expect(intentLabel({ taskType: "custom", text: "fix the latch", confirmed: true })).toBe(
      "fix the latch",
    );
    expect(intentLabel(null)).toBe("task");
  });

  it("inspect/identify intents use their own step templates", () => {
    const inspect = stepTemplateForIntent({ taskType: "inspect", confirmed: true });
    expect(inspect[0].instruction.toLowerCase()).toContain("check");
    const generic = stepTemplateForIntent({ taskType: "troubleshoot", confirmed: true });
    expect(generic.length).toBeGreaterThanOrEqual(3); // falls back to the safe generic flow
  });
});

describe("Plan Mode — visual overlays", () => {
  it("emits an arrow into the active step plus a target/highlight/warning", () => {
    const { steps, currentIndex } = mockPlanSteps(9, { taskType: "build", confirmed: true });
    const overlays = mockPlanOverlays(steps, currentIndex, { taskType: "build", confirmed: true });
    expect(overlays.some((o) => o.type === "arrow")).toBe(true);
    expect(overlays.some((o) => o.type === "target")).toBe(true);
    const arrow = overlays.find((o) => o.type === "arrow")!;
    expect(arrow.from).toBeTruthy();
    expect(arrow.to).toBeTruthy();
  });

  it("inspect intent highlights instead of targeting", () => {
    const intent: BuildUserIntent = { taskType: "inspect", confirmed: true };
    const { steps, currentIndex } = mockPlanSteps(0, intent);
    const overlays = mockPlanOverlays(steps, currentIndex, intent);
    expect(overlays.some((o) => o.type === "highlight")).toBe(true);
    // step 0 has no previous step → no arrow yet
    expect(overlays.some((o) => o.type === "arrow")).toBe(false);
  });
});

describe("Plan Mode — derivePlanStage", () => {
  const D = { generating: false };
  it("no ghost yet → selecting object", () => {
    expect(
      derivePlanStage({ phase: "idle", hasBaseFrame: false, intentConfirmed: false, ...D }),
    ).toBe("plan_selecting_object");
    expect(
      derivePlanStage({ phase: "extracting", hasBaseFrame: false, intentConfirmed: false, ...D }),
    ).toBe("plan_selecting_object");
  });
  it("ghost without intent → waiting for intent", () => {
    expect(
      derivePlanStage({ phase: "placing", hasBaseFrame: true, intentConfirmed: false, ...D }),
    ).toBe("plan_waiting_for_intent");
  });
  it("intent confirmed, frame in flight → generating", () => {
    expect(
      derivePlanStage({
        phase: "pinned",
        hasBaseFrame: true,
        intentConfirmed: true,
        generating: true,
      }),
    ).toBe("plan_generating_steps");
  });
  it("intent confirmed, steps ready → guiding; review → review", () => {
    expect(
      derivePlanStage({ phase: "pinned", hasBaseFrame: true, intentConfirmed: true, ...D }),
    ).toBe("plan_guiding");
    expect(
      derivePlanStage({ phase: "review", hasBaseFrame: true, intentConfirmed: true, ...D }),
    ).toBe("plan_review");
  });
});

describe("Plan Mode — external callout placement", () => {
  const notes: BlueprintNote[] = [
    { id: "n1", type: "next-step", text: "Align the part", x: 0.5, y: 0.3, timestampMs: 0 },
    { id: "n2", type: "safety", text: "Mind your fingers", x: 0.5, y: 0.12, timestampMs: 0 },
  ];

  it("places cards on the side of the ghost with the most room", () => {
    // ghost hugging the left → cards go right
    expect(chooseCalloutSide({ x: 0.02, y: 0.3, w: 0.3, h: 0.3 })).toBe("right");
    // ghost hugging the right → cards go left
    expect(chooseCalloutSide({ x: 0.68, y: 0.3, w: 0.3, h: 0.3 })).toBe("left");
    // ghost spanning the width → no horizontal room → bottom
    expect(chooseCalloutSide({ x: 0.05, y: 0.2, w: 0.9, h: 0.5 })).toBe("bottom");
  });

  it("keeps card text outside the crop and spreads stacked cards apart", () => {
    const bounds = { x: 0.05, y: 0.3, w: 0.35, h: 0.4 };
    const placed = layoutCallouts(bounds, notes);
    expect(placed).toHaveLength(2);
    for (const c of placed) {
      expect(c.side).toBe("right");
      expect(c.connect.x).toBeGreaterThan(bounds.x + bounds.w); // outside the ghost
    }
    // stacked cards never overlap vertically
    expect(Math.abs(placed[0].connect.y - placed[1].connect.y)).toBeGreaterThanOrEqual(0.15);
  });

  it("drops empty notes", () => {
    const placed = layoutCallouts({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, [
      { id: "e", type: "observation", text: "  ", x: 0.5, y: 0.5, timestampMs: 0 },
    ]);
    expect(placed).toHaveLength(0);
  });
});
