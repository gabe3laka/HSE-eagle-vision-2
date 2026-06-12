import { describe, it, expect } from "vitest";
import {
  advanceHold,
  INITIAL_HOLD_STATE,
  isRecordTargetPhase,
  isStopTargetPhase,
  RECORD_HOLD_MS,
} from "../features/build-mode/lib/holdToTrigger";
import type { HoldState } from "../features/build-mode/lib/holdToTrigger";
import {
  isReplyableCallout,
  MAX_VISIBLE_CALLOUTS,
  prioritizeCallouts,
} from "../features/build-mode/lib/calloutLayout";
import { MAX_VISIBLE_POINTS, selectVisiblePoints } from "../features/build-mode/lib/virtualPoints";
import {
  buildPseudoPointCloud,
  pseudoPointsForFrame,
} from "../features/build-mode/lib/pseudoPointCloud";
import {
  buildPlanReasoningPayload,
  buildRulesFallback,
  mergePlanReasoning,
  validatePlanReasoning,
} from "../features/build-mode/lib/planReasoning";
import { pointCloudProvider } from "../features/build-mode/lib/pointCloudProvider";
import { rehydrateSavedBlueprint } from "../features/build-mode/lib/sourceAssets";
import type {
  BlueprintFrame,
  BlueprintNote,
  SavedBlueprint,
  VirtualBlueprintPoint,
} from "../features/build-mode/types";

// ── Record/Stop pinch-hold machine ──────────────────────────────────────────

const HOLD_IN = {
  inside: true,
  armed: true,
  pinchArmed: true,
  inGrace: false,
};

function runHold(
  steps: Array<{ at: number; pinch: boolean; inside?: boolean }>,
  holdMs = RECORD_HOLD_MS,
): HoldState {
  let s: HoldState = { ...INITIAL_HOLD_STATE };
  for (const step of steps) {
    s = advanceHold(
      s,
      { ...HOLD_IN, now: step.at, pinchActive: step.pinch, inside: step.inside ?? true },
      holdMs,
    );
  }
  return s;
}

describe("Record/Stop targets — pinch-hold machine", () => {
  it("record/stop targets only exist in their phases", () => {
    expect(isRecordTargetPhase("pinned")).toBe(true);
    expect(isRecordTargetPhase("placing")).toBe(false);
    expect(isRecordTargetPhase("idle")).toBe(false);
    expect(isStopTargetPhase("recording")).toBe(true);
    expect(isStopTargetPhase("pinned")).toBe(false);
  });

  it("a pinch HELD for the full duration fires", () => {
    const s = runHold([
      { at: 0, pinch: true },
      { at: 300, pinch: true },
      { at: RECORD_HOLD_MS, pinch: true },
    ]);
    expect(s.fired).toBe(true);
  });

  it("an early pinch release does NOT fire and restarts the clock", () => {
    const s = runHold([
      { at: 0, pinch: true },
      { at: 300, pinch: false }, // released at 300ms — pinch hold aborted
    ]);
    expect(s.fired).toBe(false);
    expect(s.mode).toBe("dwell");
    // the dwell restarted at t=300, so t=700 (full duration from pinch start)
    // still does not fire…
    const later = advanceHold(
      s,
      { ...HOLD_IN, now: RECORD_HOLD_MS, pinchActive: false },
      RECORD_HOLD_MS,
    );
    expect(later.fired).toBe(false);
    // …and only a full dwell from the restart triggers.
    const done = advanceHold(
      later,
      { ...HOLD_IN, now: 300 + RECORD_HOLD_MS, pinchActive: false },
      RECORD_HOLD_MS,
    );
    expect(done.fired).toBe(true);
  });

  it("a fingertip dwell fires after the full duration", () => {
    const s = runHold([
      { at: 0, pinch: false },
      { at: RECORD_HOLD_MS - 1, pinch: false },
    ]);
    expect(s.fired).toBe(false);
    const done = runHold([
      { at: 0, pinch: false },
      { at: RECORD_HOLD_MS, pinch: false },
    ]);
    expect(done.fired).toBe(true);
  });

  it("leaving the target resets; unarmed/grace input stays neutral", () => {
    const mid = runHold([
      { at: 0, pinch: true },
      { at: 400, pinch: true, inside: false }, // left the target
    ]);
    expect(mid).toEqual(INITIAL_HOLD_STATE);
    const graced = advanceHold(
      { ...INITIAL_HOLD_STATE },
      { now: 100, inside: true, pinchActive: true, armed: true, pinchArmed: true, inGrace: true },
    );
    expect(graced.progress).toBe(0);
    const unarmed = advanceHold(
      { ...INITIAL_HOLD_STATE },
      { now: 100, inside: true, pinchActive: true, armed: false, pinchArmed: true, inGrace: false },
    );
    expect(unarmed.progress).toBe(0);
  });
});

// ── Callout priority + tap-to-reply ─────────────────────────────────────────

const note = (type: BlueprintNote["type"], i: number): BlueprintNote => ({
  id: `${type}-${i}`,
  type,
  text: `${type} ${i}`,
  x: 0.5,
  y: 0.5,
  timestampMs: 0,
});

describe("Plan callouts — priority cap + reply behavior", () => {
  it("caps visible callouts at 3, safety first", () => {
    const picked = prioritizeCallouts([
      note("observation", 1),
      note("instruction", 2),
      note("quality", 3),
      note("safety", 4),
      note("next-step", 5),
      note("intent", 6),
    ]);
    expect(picked).toHaveLength(MAX_VISIBLE_CALLOUTS);
    expect(picked.map((n) => n.type)).toEqual(["safety", "next-step", "intent"]);
  });

  it("plan goal/intent/next-step callouts reply; others expand", () => {
    expect(isReplyableCallout("plan", "intent")).toBe(true);
    expect(isReplyableCallout("plan", "next-step")).toBe(true);
    expect(isReplyableCallout("plan", "observation")).toBe(false);
    expect(isReplyableCallout("build", "intent")).toBe(false); // Build never replies
  });
});

// ── Virtual point visibility ────────────────────────────────────────────────

const vp = (id: string, linkedStepId?: string): VirtualBlueprintPoint => ({
  id,
  role: "anchor",
  x: 0.5,
  y: 0.5,
  linkedStepId,
});

describe("Virtual blueprint points — visibility policy", () => {
  it("caps at 6 with active-step points first and emphasized", () => {
    const points = [
      vp("other-1", "step-2"),
      vp("free-1"),
      vp("active-1", "step-1"),
      vp("other-2", "step-2"),
      vp("free-2"),
      vp("active-2", "step-1"),
      vp("other-3", "step-2"),
      vp("free-3"),
    ];
    const visible = selectVisiblePoints(points, "step-1");
    expect(visible).toHaveLength(MAX_VISIBLE_POINTS);
    expect(visible[0].point.linkedStepId).toBe("step-1");
    expect(visible[0].active).toBe(true);
    expect(visible[1].point.linkedStepId).toBe("step-1");
    // points linked to OTHER steps are faded
    const faded = visible.find((v) => v.point.linkedStepId === "step-2");
    if (faded) expect(faded.active).toBe(false);
  });

  it("handles empty input safely", () => {
    expect(selectVisiblePoints(undefined, "s")).toEqual([]);
    expect(selectVisiblePoints([], undefined)).toEqual([]);
  });
});

// ── Pseudo point cloud (2.5D local fallback) ────────────────────────────────

describe("pseudoPointCloud — local 2.5D points from contour", () => {
  const contour = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.7 },
    { x: 0.2, y: 0.7 },
  ];

  it("produces contour points, anchors, centroid and a longest-edge point", () => {
    const cloud = buildPseudoPointCloud({ maskContour: contour });
    expect(cloud.contourPoints.length).toBeGreaterThanOrEqual(4);
    expect(cloud.anchors).toHaveLength(4);
    expect(cloud.centroid.role).toBe("alignment-point");
    expect(cloud.centroid.x).toBeCloseTo(0.5, 5);
    expect(cloud.edgePoints[0].role).toBe("alignment-point");
    for (const p of [...cloud.contourPoints, ...cloud.anchors]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });

  it("pseudoPointsForFrame returns a compact (≤6) honest fallback set", () => {
    const frame = { outline: contour, anchors: [] } as unknown as BlueprintFrame;
    const points = pseudoPointsForFrame(frame);
    expect(points.length).toBeLessThanOrEqual(6);
    expect(points.length).toBeGreaterThan(0);
  });
});

// ── Validation caps + payload history/depth ─────────────────────────────────

describe("Plan reasoning — caps + follow-up payload", () => {
  it("caps steps at 8, overlays at 12, points at 20", () => {
    const mk = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
    const r = validatePlanReasoning({
      planSteps: mk(11, (i) => ({
        id: `p${i}`,
        title: "t",
        instruction: "do",
        x: 0.5,
        y: 0.5,
        status: "pending",
      })),
      planOverlays: mk(15, (i) => ({ id: `o${i}`, type: "target", x: 0.5, y: 0.5 })),
      virtualBlueprintPoints: mk(25, (i) => ({ id: `v${i}`, role: "anchor", x: 0.5, y: 0.5 })),
    })!;
    expect(r.planSteps).toHaveLength(8);
    expect(r.planOverlays).toHaveLength(12);
    expect(r.virtualBlueprintPoints).toHaveLength(20);
  });

  it("includes followUpText + capped history; depth switches the coordinate system", () => {
    const frame = {
      outline: [],
      anchors: [],
      depthPoints: [{ x: 0.45, y: 0.42, z: 0.58 }],
    } as unknown as BlueprintFrame;
    const history = Array.from({ length: 9 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      text: `t${i}`,
    }));
    const p = buildPlanReasoningPayload({
      sessionId: "s",
      intent: { taskType: "build", text: "assemble", confirmed: true },
      frame,
      followUpText: "what about the cables?",
      history,
    });
    expect(p.followUpText).toBe("what about the cables?");
    expect(p.history).toHaveLength(6); // capped to the last 6 turns
    expect(p.history![5].text).toBe("t8");
    expect(p.depthPoints).toHaveLength(1);
    expect(p.coordinateSystem.type).toBe("normalized-crop-2d-plus-optional-depth");
    expect(p.coordinateSystem.zMeaning).toContain("pseudo-depth");
  });

  it("without depth the coordinate system stays plain 2D", () => {
    const p = buildPlanReasoningPayload({
      sessionId: "s",
      intent: { taskType: "inspect", confirmed: true },
      frame: { outline: [], anchors: [] } as unknown as BlueprintFrame,
    });
    expect(p.coordinateSystem.type).toBe("normalized-crop-2d");
    expect(p.depthPoints).toBeUndefined();
  });
});

// ── Point-E stays out of the live loop ──────────────────────────────────────

describe("Point-E provider — reserved for the future, never called live", () => {
  it("generating a full local plan never touches the point-cloud provider", () => {
    const before = pointCloudProvider.callCount;
    const payload = buildPlanReasoningPayload({
      sessionId: "s",
      intent: { taskType: "build", text: "assemble this PCB", confirmed: true },
      frame: { outline: [], anchors: [] } as unknown as BlueprintFrame,
    });
    const resp = buildRulesFallback(payload);
    mergePlanReasoning(
      { sessionId: "s", frameId: "f", timestampMs: 0, outline: [], anchors: [] },
      resp,
    );
    expect(pointCloudProvider.callCount).toBe(before); // untouched
  });
});

// ── Back-compat: older saved blueprints ─────────────────────────────────────

describe("Saved blueprints — older saves without virtual points still load", () => {
  it("rehydrates a pre-virtualBlueprintPoints save unchanged", () => {
    const oldFrame: BlueprintFrame = {
      sessionId: "s",
      frameId: "f-0",
      timestampMs: 0,
      outline: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
      anchors: [{ id: "a", x: 0.2, y: 0.2 }],
    };
    const saved: SavedBlueprint = {
      id: "old-1",
      name: "Old save",
      workflowMode: "build",
      createdAt: "2026-01-01T00:00:00Z",
      region: { x: 0.2, y: 0.3, w: 0.4, h: 0.3 },
      placement: null,
      baseFrame: oldFrame,
      frames: [oldFrame],
      sourceAsset: null,
    };
    const { baseFrame, frames } = rehydrateSavedBlueprint(saved);
    expect(baseFrame.outline).toEqual(oldFrame.outline);
    expect(baseFrame.virtualBlueprintPoints).toBeUndefined(); // absent, not invented
    expect(frames).toHaveLength(1);
  });
});
