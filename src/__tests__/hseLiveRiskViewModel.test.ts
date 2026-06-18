import { describe, expect, it } from "vitest";
import {
  HSE_PRIORITY_RISK_LIMIT,
  boxLabelForEntity,
  buildHseLiveRiskViewModel,
  effectiveRiskLevel,
  friendlyHazardLabel,
  itemNameForEntity,
} from "@/lib/detection/hseLiveRiskViewModel";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import type { SceneRisk } from "@/lib/detection/riskTypes";

const NOW = 1_700_000_000_000;

function entity(over: Partial<BackendEntity> & { label?: string }): BackendEntity {
  return {
    label: "cup",
    class_id: 41,
    confidence: 0.8,
    bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    ...over,
  };
}

function risk(over: Partial<SceneRisk>): SceneRisk {
  return {
    hazard: "object_near_edge",
    risk_level: "YELLOW",
    risk_score: 5,
    track_id: "t1",
    produced_by: "rules+vlm",
    visual_evidence: ["cup overhangs edge"],
    should_alert: true,
    ...over,
  };
}

function parsedRisk(risks: SceneRisk[]): ParsedDetectRisk {
  return {
    sceneRisks: risks,
    degraded: false,
    warnings: [],
    reasonerStatus: "ok",
  };
}

describe("hseLiveRiskViewModel — labels", () => {
  it("friendlyHazardLabel converts known hazard ids", () => {
    expect(friendlyHazardLabel("object_near_edge")).toBe("Object near edge");
    expect(friendlyHazardLabel("unsafe_posture")).toBe("Unsafe posture");
    expect(friendlyHazardLabel("worker_near_vehicle")).toBe("Worker near vehicle");
    expect(friendlyHazardLabel("ppe_missing")).toBe("PPE missing");
    expect(friendlyHazardLabel("slip_trip")).toBe("Slip/trip risk");
    expect(friendlyHazardLabel(undefined)).toBe("Hazard");
    expect(friendlyHazardLabel("custom_thing")).toBe("Custom thing");
  });

  it("itemNameForEntity prefers semantic/display/label/class_name", () => {
    expect(
      itemNameForEntity(
        entity({ label: "obj42" }) as BackendEntity & Record<string, unknown>,
      ),
    ).toBe("obj42");
    expect(itemNameForEntity(entity({ label: "" }))).toBe("detected item");
  });

  it("boxLabelForEntity returns item name only in hse-risk-only mode", () => {
    const e = entity({ label: "cup", risk_level: "YELLOW" });
    expect(boxLabelForEntity(e, true, "hse-risk-only")).toBe("cup");
    expect(boxLabelForEntity(e, true, "normal")).toBeNull();
    const dbg = boxLabelForEntity(e, true, "debug") ?? "";
    expect(dbg).toContain("cup");
    expect(dbg).toContain("YELLOW");
    // No risk words leak into hse-risk-only label.
    const label = boxLabelForEntity(e, true, "hse-risk-only") ?? "";
    expect(label).not.toMatch(/YELLOW|GREEN|stale|resolving|track/i);
  });
});

describe("hseLiveRiskViewModel — effectiveRiskLevel", () => {
  it("never downgrades a linked YELLOW+ to GREEN", () => {
    expect(
      effectiveRiskLevel({ linkedSceneHighest: "YELLOW", risk: { hazard: "x", risk_level: "GREEN" } }),
    ).toBe("YELLOW");
  });

  it("requires evidence to promote object_near_edge", () => {
    expect(effectiveRiskLevel({ risk: { hazard: "object_near_edge" } })).toBeNull();
    expect(
      effectiveRiskLevel({
        risk: { hazard: "object_near_edge", risk_score: 5, should_alert: true },
      }),
    ).toBe("YELLOW");
  });
});

describe("hseLiveRiskViewModel — builder", () => {
  it("dedupes by hazard+track and caps the priority list to 10", () => {
    const risks: SceneRisk[] = [];
    for (let i = 0; i < 14; i += 1) {
      risks.push(
        risk({
          risk_id: `r${i}`,
          track_id: `t${i}`,
          hazard: "object_near_edge",
          risk_level: i < 4 ? "RED" : "YELLOW",
        }),
      );
    }
    // Two duplicates of the same risk_id should collapse.
    risks.push(risk({ risk_id: "r0", track_id: "t0" }));
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsedRisk(risks),
      nowMs: NOW,
    });
    expect(vm.priorityRisks.length).toBe(HSE_PRIORITY_RISK_LIMIT);
    // RED first.
    expect(vm.priorityRisks[0]?.level).toBe("RED");
    expect(vm.groupedRiskCount).toBeGreaterThanOrEqual(HSE_PRIORITY_RISK_LIMIT);
  });

  it("filters out weak/generic object_near_edge risks without evidence", () => {
    const weak: SceneRisk = {
      hazard: "object_near_edge",
      risk_level: "YELLOW",
      track_id: "tweak",
      produced_by: "rules",
      risk_score: 1,
    };
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsedRisk([weak]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks.length).toBe(0);
  });

  it("emits no priority risks when there are no worker scene risks and local alerts are disabled", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: null,
      localActiveAlerts: [
        {
          key: "local-1",
          id: "1",
          severity: "high",
          category: "proximity",
          title: "Worker near vehicle",
          shortMessage: "Move away",
          spokenMessage: "Move away",
          recommendedAction: "step back",
          confidence: 0.9,
          relatedTrackIds: [],
          wearablePattern: "double-tap",
          reasoningSource: "rules",
          state: "active",
          firstFiredMs: NOW,
          lastFiredMs: NOW,
          lastSeenMs: NOW,
        },
      ],
      nowMs: NOW,
      localAlertsEnabled: false,
    });
    expect(vm.priorityRisks.length).toBe(0);
    expect(vm.shouldUseLocalFallback).toBe(false);
  });

  it("uses local alerts when localAlertsEnabled and no worker risks", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: null,
      localActiveAlerts: [
        {
          key: "local-1",
          id: "1",
          severity: "high",
          category: "proximity",
          title: "x",
          shortMessage: "x",
          spokenMessage: "x",
          recommendedAction: "x",
          confidence: 0.9,
          relatedTrackIds: [],
          wearablePattern: "double-tap",
          reasoningSource: "rules",
          state: "active",
          firstFiredMs: NOW,
          lastFiredMs: NOW,
          lastSeenMs: NOW,
        },
      ],
      nowMs: NOW,
      localAlertsEnabled: true,
    });
    expect(vm.shouldUseLocalFallback).toBe(true);
    expect(vm.priorityRisks.length).toBe(1);
    expect(vm.priorityRisks[0]?.source).toBe("Local fallback");
  });

  it("hides poses without nearby person entity or insufficient keypoints", () => {
    const pose: BackendPose = {
      confidence: 0.9,
      keypoints: [{ name: "hand_index", x: 0.5, y: 0.5, score: 0.9 }],
    };
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [pose],
      parsedRisk: null,
      nowMs: NOW,
    });
    expect(vm.overlayPoses.length).toBe(0);
    expect(vm.hiddenPoseReasons.length).toBeGreaterThan(0);
  });

  it("produces a clean Qwen reasoner badge", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: { sceneRisks: [], degraded: false, warnings: [], reasonerStatus: "ok" },
      nowMs: NOW,
    });
    expect(vm.reasonerBadge.label).toMatch(/Qwen/);
  });
});
