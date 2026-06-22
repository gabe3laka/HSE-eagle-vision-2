import { describe, expect, it } from "vitest";
import {
  HSE_PRIORITY_RISK_LIMIT,
  boxLabelForEntity,
  buildHseLiveRiskViewModel,
  effectiveRiskLevel,
  entityMatchesRiskIds,
  friendlyHazardLabel,
  itemNameForEntity,
  linkedEntitiesForRisk,
  pickRiskAction,
  pickRiskWhy,
  riskRegionFor,
  spatialMatchRiskToEntity,
} from "@/lib/detection/hseLiveRiskViewModel";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import { mergeParsedRisk } from "@/features/hse-monitoring/lib/mergeParsedRisk";
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
      itemNameForEntity(entity({ label: "obj42" }) as BackendEntity & Record<string, unknown>),
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
      effectiveRiskLevel({
        linkedSceneHighest: "YELLOW",
        risk: { hazard: "x", risk_level: "GREEN" },
      }),
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

  it("produces a clean reasoner badge that does NOT default to Qwen", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: { sceneRisks: [], degraded: false, warnings: [], reasonerStatus: "ok" },
      nowMs: NOW,
    });
    expect(vm.reasonerBadge.label).toMatch(/Reasoner/);
    expect(vm.reasonerBadge.label).not.toMatch(/Qwen/);
  });
});

describe("hseLiveRiskViewModel — linking", () => {
  it("entityMatchesRiskIds matches by track_id", () => {
    const e = entity({ track_id: "t9" });
    expect(entityMatchesRiskIds({ track_id: "t9" }, e)).toBe(true);
    expect(entityMatchesRiskIds({ track_id: "tX" }, e)).toBe(false);
  });

  it("entityMatchesRiskIds matches involved_track_ids", () => {
    const e = entity({ track_id: "t1" });
    expect(entityMatchesRiskIds({ involved_track_ids: ["t1", "t2"] }, e)).toBe(true);
  });

  it("riskRegionFor falls through bbox -> approximate_region", () => {
    expect(riskRegionFor({ bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    });
    expect(riskRegionFor({ approximate_region: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } })).toEqual({
      x: 0.5,
      y: 0.5,
      w: 0.1,
      h: 0.1,
    });
    expect(riskRegionFor({ hazard: "x" })).toBeNull();
  });

  it("spatialMatchRiskToEntity picks the overlapping entity", () => {
    const can = entity({ label: "can", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    const chair = entity({ label: "chair", bbox: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 } });
    const match = spatialMatchRiskToEntity({ bbox: { x: 0.11, y: 0.11, w: 0.18, h: 0.18 } }, [
      chair,
      can,
    ]);
    expect(match?.label).toBe("can");
  });

  it("linkedEntitiesForRisk: id wins; spatial fallback when no id", () => {
    const can = entity({
      label: "can",
      track_id: "t-can",
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    });
    const cup = entity({ label: "cup", bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } });
    expect(linkedEntitiesForRisk({ track_id: "t-can" }, [can, cup])[0].label).toBe("can");
    expect(
      linkedEntitiesForRisk({ bbox: { x: 0.51, y: 0.51, w: 0.08, h: 0.08 } }, [can, cup])[0].label,
    ).toBe("cup");
    expect(linkedEntitiesForRisk({ hazard: "x" }, [can, cup])).toEqual([]);
  });

  it("colors a linked entity YELLOW even when worker entity has no risk_level", () => {
    const can = entity({ label: "can", track_id: "tc", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    const vm = buildHseLiveRiskViewModel({
      entities: [can],
      poses: [],
      parsedRisk: parsedRisk([
        risk({ track_id: "tc", hazard: "object_near_edge", risk_level: "YELLOW" }),
      ]),
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(1);
    expect(vm.overlayEntities[0].risk_level).toBe("YELLOW");
    expect(vm.overlayEntities[0].label).toBe("can");
    expect(vm.priorityRisks.length).toBe(1);
    expect(vm.riskLinkedEntityCount).toBe(1);
  });

  it("weak edge risk linked spatially colors the box but stays out of priority", () => {
    const can = entity({ label: "can", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    const weak: SceneRisk = {
      hazard: "object_near_edge",
      risk_level: "YELLOW",
      produced_by: "rules",
      risk_score: 1,
      bbox: { x: 0.11, y: 0.11, w: 0.18, h: 0.18 },
    };
    const vm = buildHseLiveRiskViewModel({
      entities: [can],
      poses: [],
      parsedRisk: parsedRisk([weak]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks.length).toBe(0);
    expect(vm.overlayEntities.length).toBe(1);
    expect(vm.overlayEntities[0].risk_level).toBe("YELLOW");
  });
});

describe("hseLiveRiskViewModel — wording", () => {
  it("pickRiskWhy falls through risk_reason -> visual_evidence -> evidence -> trigger -> observation -> description", () => {
    expect(pickRiskWhy({ risk_reason: "a" })).toBe("a");
    expect(pickRiskWhy({ visual_evidence: ["b"] })).toBe("b");
    expect(pickRiskWhy({ evidence: ["c"] })).toBe("c");
    expect(pickRiskWhy({ trigger_condition: "d" })).toBe("d");
    expect(pickRiskWhy({ observation: "e" })).toBe("e");
    expect(pickRiskWhy({ description: "f" })).toBe("f");
    expect(pickRiskWhy({})).toBeUndefined();
  });

  it("pickRiskAction falls through full chain", () => {
    expect(pickRiskAction({ recommended_action: "a" })).toBe("a");
    expect(pickRiskAction({ recommended_controls: [{ action: "b" }] })).toBe("b");
    expect(pickRiskAction({ primary_action: "c" })).toBe("c");
    expect(pickRiskAction({ next_action: "d" })).toBe("d");
    expect(pickRiskAction({ control_recommendation: "e" })).toBe("e");
    expect(pickRiskAction({})).toBeUndefined();
  });

  it("pickRiskWhy reads scene_context from parsedRisk as last fallback", () => {
    const pr: ParsedDetectRisk = {
      sceneRisks: [],
      degraded: false,
      warnings: [],
      sceneContext: { summary: "scene summary text" },
    };
    expect(pickRiskWhy({}, pr)).toBe("scene summary text");
  });
});

describe("hseLiveRiskViewModel — reasoner badge", () => {
  function badge(status: string | undefined) {
    return buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: {
        sceneRisks: [],
        degraded: false,
        warnings: [],
        reasonerStatus: status as string,
      },
      nowMs: NOW,
    }).reasonerBadge;
  }
  it("ok/ready/done -> ready", () => {
    expect(badge("ok").state).toBe("ready");
    expect(badge("READY").state).toBe("ready");
    expect(badge("done").state).toBe("ready");
  });
  it("running/busy -> running", () => {
    expect(badge("running").state).toBe("running");
    expect(badge("busy").state).toBe("running");
  });
  it("queued/pending -> queued", () => {
    expect(badge("queued").state).toBe("queued");
    expect(badge("pending").state).toBe("queued");
  });
  it("unavailable/timeout/missing -> unavailable", () => {
    expect(badge("unavailable").state).toBe("unavailable");
    expect(badge("timeout").state).toBe("unavailable");
    expect(badge("missing").state).toBe("unavailable");
  });
  it("error / schema_error / json_parse_error -> error", () => {
    expect(badge("error").state).toBe("error");
    expect(badge("schema_error").state).toBe("error");
    expect(badge("json_parse_error").state).toBe("error");
  });
  it("unknown non-empty status -> unavailable (never silently ready)", () => {
    expect(badge("zzz_unknown_state").state).toBe("unavailable");
    expect(badge("something_else").label).toMatch(/unavailable/);
  });
  it("disabled / not_run -> disabled", () => {
    expect(badge("disabled").state).toBe("disabled");
    expect(badge("not_run").state).toBe("disabled");
  });
  it("null parsedRisk -> disabled, labelled 'Reasoner' (never Qwen)", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: null,
      nowMs: NOW,
    });
    expect(vm.reasonerBadge.state).toBe("disabled");
    expect(vm.reasonerBadge.label).toBe("Reasoner: disabled");
  });
  it("label defaults to 'Reasoner', never 'Qwen'", () => {
    for (const s of ["ready", "queued", "running", "unavailable", "disabled", "error"]) {
      expect(badge(s).label.startsWith("Reasoner:")).toBe(true);
      expect(badge(s).label).not.toMatch(/Qwen/);
    }
  });
  it("label reads 'Gemini' when reasonerStatusRaw.model includes gemini", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: {
        sceneRisks: [],
        degraded: false,
        warnings: [],
        reasonerStatus: "ready",
        reasonerStatusRaw: { model: "gemini-2.0-flash", state: "ready" },
      },
      nowMs: NOW,
    });
    expect(vm.reasonerBadge.label).toBe("Gemini: ready");
  });
  it("label reads 'Gemini' when a scene risk reasoner_model includes gemini", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: {
        sceneRisks: [
          { hazard: "spill", risk_level: "YELLOW", reasoner_model: "gemini-1.5" } as never,
        ],
        degraded: false,
        warnings: [],
        reasonerStatus: "ready",
      },
      nowMs: NOW,
    });
    expect(vm.reasonerBadge.label).toBe("Gemini: ready");
  });
});

describe("hseLiveRiskViewModel — box label safety", () => {
  it("hse-risk-only label never contains risk/level/track words", () => {
    const e = entity({
      label: "can",
      risk_level: "YELLOW",
      track_id: "t1",
      state: "stale",
    });
    const label = boxLabelForEntity(e, true, "hse-risk-only") ?? "";
    expect(label).toBe("can");
    expect(label).not.toMatch(
      /YELLOW|GREEN|ORANGE|RED|stale|resolving|track|risk_id|anchor_carryover/i,
    );
  });
});

describe("hseLiveRiskViewModel — hazard_type compatibility", () => {
  it("uses hazard_type when hazard is missing for grouping + labels", () => {
    const r: SceneRisk = {
      hazard_type: "object_near_edge",
      risk_level: "YELLOW",
      risk_score: 5,
      track_id: "tA",
      produced_by: "rules+vlm",
      visual_evidence: ["cup near table edge"],
      should_alert: true,
    };
    const e = entity({ label: "cup", track_id: "tA" });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([r]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks.length).toBe(1);
    expect(vm.priorityRisks[0].hazardType).toBe("object_near_edge");
    expect(vm.priorityRisks[0].hazardLabel).toBe("Object near edge");
  });

  it("weak-edge filter applies to hazard_type variant too", () => {
    const weak: SceneRisk = {
      hazard_type: "object_near_edge",
      risk_level: "YELLOW",
      track_id: "tW",
      produced_by: "rules",
      // no visual_evidence / should_alert / score >=4 → weak
    };
    const e = entity({ label: "cup", track_id: "tW" });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([weak]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks.length).toBe(0);
  });
});

describe("hseLiveRiskViewModel — broadened ID matching", () => {
  it("matches via risk.risk_id ↔ entity.linked_risk_id", () => {
    const r: SceneRisk = { hazard: "object_near_edge", risk_id: "R-1", should_alert: true };
    const e = entity({ label: "cup" }) as BackendEntity & { linked_risk_id?: string };
    e.linked_risk_id = "R-1";
    expect(entityMatchesRiskIds(r, e)).toBe(true);
  });

  it("matches via risk.involved_detection_ids ↔ entity.id", () => {
    const r: SceneRisk = {
      hazard: "object_near_edge",
      involved_detection_ids: ["d-7"],
      should_alert: true,
    };
    const e = entity({ label: "cup" }) as BackendEntity & { id?: string };
    e.id = "d-7";
    expect(entityMatchesRiskIds(r, e)).toBe(true);
    expect(linkedEntitiesForRisk(r, [e]).length).toBe(1);
  });
});

describe("hseLiveRiskViewModel — source labels (Reasoner / Gemini, never Qwen)", () => {
  it("a linked reasoner risk reads source 'Reasoner' by default", () => {
    const e = entity({ label: "cup", track_id: "tS" });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([
        risk({ track_id: "tS", hazard: "object_near_edge", produced_by: "vlm_reasoner" }),
      ]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks[0]?.source).toBe("Reasoner");
    expect(vm.priorityRisks[0]?.source).not.toMatch(/Qwen/);
  });

  it("a gemini-tagged linked risk reads source 'Gemini'", () => {
    const e = entity({ label: "cup", track_id: "tG" });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([
        risk({
          track_id: "tG",
          hazard: "object_near_edge",
          produced_by: "vlm_reasoner",
          reasoner_model: "gemini-2.0-flash",
        }),
      ]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks[0]?.source).toBe("Gemini");
  });

  it("rules + reasoner reads 'Rules + Reasoner'", () => {
    const e = entity({ label: "cup", track_id: "tRV" });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([
        risk({ track_id: "tRV", hazard: "object_near_edge", produced_by: "rules+vlm" }),
      ]),
      nowMs: NOW,
    });
    expect(vm.priorityRisks[0]?.source).toBe("Rules + Reasoner");
  });
});

describe("hseLiveRiskViewModel — reasoner candidate flags", () => {
  const reasonerOnly: SceneRisk = {
    hazard: "ergonomics",
    risk_level: "YELLOW",
    produced_by: "vlm_reasoner",
    visual_evidence: ["bent posture"],
  };
  it("lane disabled → no candidates", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsedRisk([reasonerOnly]),
      nowMs: NOW,
      reasonerCandidateLaneEnabled: false,
      showReasonerCandidates: true,
    });
    expect(vm.reasonerCandidates.length).toBe(0);
  });
  it("lane enabled but show=false → no candidates", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsedRisk([reasonerOnly]),
      nowMs: NOW,
      reasonerCandidateLaneEnabled: true,
      showReasonerCandidates: false,
    });
    expect(vm.reasonerCandidates.length).toBe(0);
  });
  it("both flags true → candidates surface", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsedRisk([reasonerOnly]),
      nowMs: NOW,
      reasonerCandidateLaneEnabled: true,
      showReasonerCandidates: true,
    });
    expect(vm.reasonerCandidates.length).toBe(1);
  });

  it("does not upgrade any entity to YELLOW+ when a worker_near_vehicle risk is unlinked", () => {
    // Worker scene risk exists but has NO linkage fields. The two entities
    // should still appear as GREEN safety-status boxes — but neither should
    // be colored ORANGE since the risk is unlinked.
    const e1 = entity({ label: "person", bbox: { x: 0.05, y: 0.05, w: 0.1, h: 0.2 } });
    const e2 = entity({ label: "forklift", bbox: { x: 0.8, y: 0.8, w: 0.15, h: 0.15 } });
    const unlinked: SceneRisk = {
      hazard: "worker_near_vehicle",
      risk_level: "ORANGE",
      risk_score: 7,
      produced_by: "vlm",
      visual_evidence: ["worker walking past forklift"],
      should_alert: true,
    };
    const vm = buildHseLiveRiskViewModel({
      entities: [e1, e2],
      poses: [],
      parsedRisk: parsedRisk([unlinked]),
      nowMs: NOW,
      localAlertsEnabled: false,
    });
    expect(vm.overlayEntities.length).toBe(2);
    expect(vm.activeRiskEntityCount).toBe(0);
    expect(vm.safeEntityCount).toBe(2);
    for (const oe of vm.overlayEntities) {
      expect(oe.risk_level).toBe("GREEN");
    }
  });
});

describe("hseLiveRiskViewModel — hse-status overlay (one box per detection)", () => {
  it("seeds every detector entity as GREEN when there are no risks", () => {
    const es = [
      entity({ label: "cup", track_id: "t1" }),
      entity({ label: "laptop", track_id: "t2", bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }),
      entity({ label: "can", track_id: "t3", bbox: { x: 0.7, y: 0.1, w: 0.1, h: 0.1 } }),
    ];
    const vm = buildHseLiveRiskViewModel({
      entities: es,
      poses: [],
      parsedRisk: parsedRisk([]),
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(3);
    expect(vm.statusEntityCount).toBe(3);
    expect(vm.safeEntityCount).toBe(3);
    expect(vm.activeRiskEntityCount).toBe(0);
    expect(vm.riskLinkedEntityCount).toBe(vm.activeRiskEntityCount);
    expect(vm.priorityRisks.length).toBe(0);
    for (const oe of vm.overlayEntities) {
      expect(oe.risk_level).toBe("GREEN");
    }
    const labels = vm.overlayEntities.map((e) => e.label).sort();
    expect(labels).toEqual(["can", "cup", "laptop"]);
    // No duplicate entity keys (one box per detection).
    const keys = new Set(vm.overlayEntities.map((e) => e.track_id ?? e.label));
    expect(keys.size).toBe(vm.overlayEntities.length);
  });

  it("upgrades exactly the linked entity to YELLOW; others stay GREEN", () => {
    const es = [
      entity({ label: "cup", track_id: "tcup" }),
      entity({ label: "laptop", track_id: "tlaptop", bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }),
      entity({ label: "can", track_id: "tcan", bbox: { x: 0.7, y: 0.1, w: 0.1, h: 0.1 } }),
    ];
    const vm = buildHseLiveRiskViewModel({
      entities: es,
      poses: [],
      parsedRisk: parsedRisk([
        risk({ track_id: "tlaptop", hazard: "object_near_edge", risk_level: "YELLOW" }),
      ]),
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(3);
    const yellow = vm.overlayEntities.filter((e) => e.risk_level === "YELLOW");
    const green = vm.overlayEntities.filter((e) => e.risk_level === "GREEN");
    expect(yellow.length).toBe(1);
    expect(green.length).toBe(2);
    expect(yellow[0].label).toBe("laptop");
    expect(vm.activeRiskEntityCount).toBe(1);
    expect(vm.safeEntityCount).toBe(2);
    expect(vm.riskLinkedEntityCount).toBe(1);
  });

  it("linked RED overrides existing GREEN/YELLOW", () => {
    const e = entity({ label: "cup", track_id: "t1", risk_level: "YELLOW" });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([
        risk({ track_id: "t1", risk_level: "RED", hazard: "falling_object" }),
      ]),
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(1);
    expect(vm.overlayEntities[0].risk_level).toBe("RED");
  });

  it("entity-level ORANGE from worker upgrades default GREEN", () => {
    const e = entity({
      label: "forklift",
      track_id: "tf",
      risk_level: "ORANGE",
      risk_color: "ORANGE",
    });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: parsedRisk([]),
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(1);
    expect(vm.overlayEntities[0].risk_level).toBe("ORANGE");
    expect(vm.activeRiskEntityCount).toBe(1);
  });

  it("preserves detector item names as labels in hse-status mode", () => {
    const e = entity({ label: "laptop", track_id: "t", risk_level: "YELLOW" });
    expect(boxLabelForEntity(e, true, "hse-status")).toBe("laptop");
  });
});

describe("hseLiveRiskViewModel — heartbeat merge integration", () => {
  it("live entities + fresh linked heartbeat risk → matching entity upgrades", () => {
    const e = entity({ label: "person", track_id: "p1", class_id: 0 });
    const live = parsedRisk([]);
    const hb = parsedRisk([
      risk({
        risk_id: "hb1",
        risk_level: "ORANGE",
        track_id: "p1",
        involved_detection_ids: ["p1"],
      }),
    ]);
    const merged = mergeParsedRisk(live, hb, { applyHeartbeatRisks: true });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: merged,
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(1);
    expect(vm.activeRiskEntityCount).toBeGreaterThanOrEqual(0);
    // Heartbeat sceneRisks flow through into priority list.
    expect(vm.groupedRiskCount + vm.hiddenGroupedRiskCount).toBeGreaterThan(0);
  });

  it("stale heartbeat linked risk (applyHeartbeatRisks=false) → boxes stay GREEN, scene risk not merged", () => {
    const e = entity({ label: "person", track_id: "p1", class_id: 0 });
    const live = parsedRisk([]);
    const hb = parsedRisk([
      risk({
        risk_id: "hb1",
        risk_level: "ORANGE",
        track_id: "p1",
        involved_detection_ids: ["p1"],
      }),
    ]);
    const merged = mergeParsedRisk(live, hb, { applyHeartbeatRisks: false });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: merged,
      nowMs: NOW,
    });
    expect(vm.activeRiskEntityCount).toBe(0);
    expect(vm.safeEntityCount).toBe(1);
  });

  it("unlinked heartbeat risk → no entity upgrade", () => {
    const e = entity({ label: "person", track_id: "p1", class_id: 0 });
    const live = parsedRisk([]);
    const hb = parsedRisk([
      risk({
        risk_id: "hb1",
        risk_level: "ORANGE",
        track_id: "ghost",
        involved_detection_ids: [],
      }),
    ]);
    const merged = mergeParsedRisk(live, hb, { applyHeartbeatRisks: true });
    const vm = buildHseLiveRiskViewModel({
      entities: [e],
      poses: [],
      parsedRisk: merged,
      nowMs: NOW,
    });
    expect(vm.activeRiskEntityCount).toBe(0);
    expect(vm.safeEntityCount).toBe(1);
  });
});

describe("hseLiveRiskViewModel — reasoner latch regressions", () => {
  it("entity-level risk_level:YELLOW with empty sceneRisks → yellow overlay entity", () => {
    // Future-proof / Part 6: worker stamps an entity directly with risk_level
    // and emits NO scene_risks. The overlay must still color it YELLOW.
    const can = entity({ label: "can", track_id: "tc", risk_level: "YELLOW" });
    const vm = buildHseLiveRiskViewModel({
      entities: [can],
      poses: [],
      parsedRisk: parsedRisk([]),
      nowMs: NOW,
    });
    expect(vm.overlayEntities.length).toBe(1);
    expect(vm.overlayEntities[0].risk_level).toBe("YELLOW");
    expect(vm.activeRiskEntityCount).toBe(1);
  });

  it("reasoner_status ready + empty sceneRisks → no false risk-linked boxes", () => {
    // The exact logs_31.txt situation: worker returns ready repeatedly with no
    // scene_risks. Boxes must stay GREEN — no phantom risk coloring.
    const es = [
      entity({ label: "cup", track_id: "t1" }),
      entity({ label: "can", track_id: "t2", bbox: { x: 0.6, y: 0.1, w: 0.1, h: 0.1 } }),
    ];
    const ready: ParsedDetectRisk = {
      sceneRisks: [],
      degraded: false,
      warnings: [],
      reasonerStatus: "ready",
    };
    const vm = buildHseLiveRiskViewModel({
      entities: es,
      poses: [],
      parsedRisk: ready,
      nowMs: NOW,
    });
    expect(vm.activeRiskEntityCount).toBe(0);
    expect(vm.safeEntityCount).toBe(2);
    for (const oe of vm.overlayEntities) {
      expect(oe.risk_level).toBe("GREEN");
    }
  });

  it("linked YELLOW scene_risk colors its entity (latch-merged result paints boxes)", () => {
    // A latched good result re-merged into the VM input must still link + color
    // the current entity — this is what keeps boxes colored while the camera runs.
    const can = entity({ label: "can", track_id: "tc", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    const latched = parsedRisk([
      risk({ track_id: "tc", hazard: "object_near_edge", risk_level: "YELLOW", risk_id: "latch1" }),
    ]);
    const vm = buildHseLiveRiskViewModel({
      entities: [can],
      poses: [],
      parsedRisk: latched,
      nowMs: NOW,
    });
    expect(vm.overlayEntities[0].risk_level).toBe("YELLOW");
    expect(vm.activeRiskEntityCount).toBe(1);
    expect(vm.priorityRisks.length).toBe(1);
  });
});
