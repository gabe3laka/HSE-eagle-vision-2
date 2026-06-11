import { describe, it, expect } from "vitest";
import {
  interpolateFrames,
  mockAiNotes,
  mockBlueprintFrame,
  mockPlanSteps,
} from "../features/build-mode/lib/blueprint";
import { sendBuildFrame, startBuildSession } from "../features/build-mode/api/buildModeClient";
import type { BuildUserIntent, SelectedRegion } from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };
const BUILD_INTENT: BuildUserIntent = { taskType: "build", confirmed: true };
const INSPECT_INTENT: BuildUserIntent = { taskType: "inspect", confirmed: true };

describe("Plan Mode — guided step progression (mock)", () => {
  it("starts on step 1 active, rest pending", () => {
    const { steps, currentIndex } = mockPlanSteps(0);
    expect(currentIndex).toBe(0);
    expect(steps[0].status).toBe("active");
    for (const s of steps.slice(1)) expect(s.status).toBe("pending");
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it("advances every 9 keyframes, completing earlier steps", () => {
    const { steps, currentIndex } = mockPlanSteps(9 * 2);
    expect(currentIndex).toBe(2);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("completed");
    expect(steps[2].status).toBe("active");
  });

  it("clamps on the final step instead of running past the template", () => {
    const a = mockPlanSteps(9999);
    expect(a.currentIndex).toBe(a.steps.length - 1);
    expect(a.steps[a.currentIndex].status).toBe("active");
    expect(a.steps.slice(0, -1).every((s) => s.status === "completed")).toBe(true);
  });

  it("steps have stable ids, titles, instructions and 0..1 marker coords", () => {
    const { steps } = mockPlanSteps(5);
    for (const [i, s] of steps.entries()) {
      expect(s.id).toBe(`plan-${i + 1}`);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.instruction.length).toBeGreaterThan(0);
      if (s.x != null) expect(s.x).toBeGreaterThanOrEqual(0);
      if (s.x != null) expect(s.x).toBeLessThanOrEqual(1);
      if (s.y != null) expect(s.y).toBeGreaterThanOrEqual(0);
      if (s.y != null) expect(s.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("Build/Plan — AI notes on mock frames", () => {
  it("always produces at least instruction + observation notes inside 0..1", () => {
    for (const i of [0, 3, 14]) {
      const notes = mockAiNotes(i, "build");
      expect(notes.length).toBeGreaterThanOrEqual(2);
      for (const n of notes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(1);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeLessThanOrEqual(1);
        expect(n.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("plan notes lead with a next-step note; build notes with an instruction", () => {
    expect(mockAiNotes(1, "plan")[0].type).toBe("next-step");
    expect(mockAiNotes(1, "build")[0].type).toBe("instruction");
  });
});

describe("Build/Plan — mockBlueprintFrame AI fields", () => {
  it("CONFIRMED plan frames carry guided steps + a hedged next action", () => {
    const f = mockBlueprintFrame("s", 9, 2997, REGION, "plan", BUILD_INTENT);
    expect(f.workflowMode).toBe("plan");
    expect(f.maskSource).toBe("none");
    expect(f.planSteps!.length).toBeGreaterThanOrEqual(3);
    expect(f.currentPlanStepIndex).toBe(1); // frame 9 → second step
    const active = f.planSteps![f.currentPlanStepIndex!];
    expect(active.status).toBe("active");
    expect(f.nextAction).toBe(`Possible next step: ${active.instruction}`);
    expect(f.detectedIntent).toContain("Confirmed goal: build");
    expect(f.planOverlays!.length).toBeGreaterThan(0);
    expect(f.aiNotes!.length).toBeGreaterThanOrEqual(1);
  });

  it("UNCONFIRMED plan frames are bare — no generic guidance before intent", () => {
    const f = mockBlueprintFrame("s", 9, 2997, REGION, "plan");
    expect(f.planSteps).toBeUndefined();
    expect(f.planOverlays).toBeUndefined();
    expect(f.nextAction).toBeUndefined();
    expect(f.aiNotes).toEqual([]);
    expect(f.importance).toBe("low");
    expect(f.detectedIntent).toContain("Waiting");
  });

  it("build frames carry notes + next action but no plan steps", () => {
    const f = mockBlueprintFrame("s", 4, 1332, REGION, "build");
    expect(f.workflowMode).toBe("build");
    expect(f.planSteps).toBeUndefined();
    expect(f.currentPlanStepIndex).toBeUndefined();
    expect(f.nextAction).toContain("Possible next action");
    expect(f.detectedIntent).toContain("appears to be documenting");
    expect(f.activityLabel!.length).toBeGreaterThan(0);
    expect(f.importance === "medium" || f.importance === "high").toBe(true);
  });

  it("a confirmed intent names the goal; the next-step note carries the step", () => {
    const confirmed = mockBlueprintFrame("s", 1, 333, REGION, "plan", INSPECT_INTENT);
    expect(confirmed.detectedIntent).toContain("Confirmed goal: inspect");
    const next = confirmed.aiNotes!.find((n) => n.type === "next-step");
    expect(next).toBeTruthy();
    expect(next!.text).toContain("Possible next step");
  });

  it("rule-based notes use cautious language", () => {
    const buildNotes = mockAiNotes(0, "build");
    expect(buildNotes[0].text).toBe("The user appears to be working near this point");
    expect(buildNotes[1].text).toContain("appears to be");
    const f = mockBlueprintFrame("s", 0, 0, REGION, "plan", INSPECT_INTENT);
    expect(f.nextAction).toContain("Possible next step");
  });

  it("defaults to build when the workflow argument is omitted (back-compat)", () => {
    const f = mockBlueprintFrame("s", 0, 0, REGION);
    expect(f.workflowMode).toBe("build");
    expect(f.planSteps).toBeUndefined();
  });

  it("is deterministic per (index, workflow)", () => {
    expect(mockBlueprintFrame("s", 8, 2664, REGION, "plan")).toEqual(
      mockBlueprintFrame("s", 8, 2664, REGION, "plan"),
    );
  });

  it("a safety note escalates importance to high and sets the warning", () => {
    // frameIndex % 10 === 5 injects the safety note in build mode
    const f = mockBlueprintFrame("s", 5, 1665, REGION, "build");
    expect(f.safetyWarning).toBeTruthy();
    expect(f.importance).toBe("high");
  });
});

describe("Build/Plan — transient crop + AI fields survive replay interpolation", () => {
  it("interpolated frames keep the nearest keyframe's crop and guidance", () => {
    const a = {
      ...mockBlueprintFrame("s", 0, 0, REGION, "plan", BUILD_INTENT),
      sourceImageB64: "QUJD",
      sourceImageSize: { w: 384, h: 288 },
      sourceImageMode: "transient" as const,
    };
    const b = {
      ...mockBlueprintFrame("s", 9, 3000, REGION, "plan", BUILD_INTENT),
      sourceImageB64: "REVG",
      sourceImageSize: { w: 384, h: 288 },
      sourceImageMode: "transient" as const,
    };
    const early = interpolateFrames(a, b, 0.2);
    expect(early.sourceImageB64).toBe("QUJD");
    expect(early.planSteps).toEqual(a.planSteps);
    const late = interpolateFrames(a, b, 0.8);
    expect(late.sourceImageB64).toBe("REVG");
    expect(late.currentPlanStepIndex).toBe(b.currentPlanStepIndex);
    expect(late.sourceImageMode).toBe("transient");
  });
});

describe("Build/Plan — mock API client threads workflowMode", () => {
  it("plan sessions return plan frames on the same /build/* mock lifecycle", async () => {
    const session = await startBuildSession("plan");
    expect(session.backendMode).toBe("mock");
    expect(session.workflowMode).toBe("plan");
    const frame = await sendBuildFrame(
      session,
      {
        sessionId: session.sessionId,
        frameId: "f-0",
        timestampMs: 0,
        selectedRegion: REGION,
        image_b64: "QUJD",
        workflowMode: "plan",
        userIntent: BUILD_INTENT,
      },
      0,
    );
    expect(frame.workflowMode).toBe("plan");
    expect(frame.planSteps!.length).toBeGreaterThanOrEqual(3);
    expect(frame.nextAction).toBeTruthy();
  });

  it("startBuildSession defaults to the build workflow", async () => {
    const session = await startBuildSession();
    expect(session.workflowMode).toBe("build");
    const frame = await sendBuildFrame(
      session,
      {
        sessionId: session.sessionId,
        frameId: "f-0",
        timestampMs: 0,
        selectedRegion: REGION,
        image_b64: "QUJD",
      },
      0,
    );
    expect(frame.workflowMode).toBe("build");
    expect(frame.planSteps).toBeUndefined();
  });
});
