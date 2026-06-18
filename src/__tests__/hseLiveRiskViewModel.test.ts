import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HSE_PRIORITY_RISK_LIMIT,
  buildHseLiveRiskViewModel,
  effectiveRiskLevel,
  filterHsePoses,
  filterOverlayEntities,
  formatHazardLabel,
  formatReasonerBadge,
  groupRisks,
  rankGroupedRisks,
} from "../lib/detection/hseLiveRiskViewModel";
import {
  applyHseRiskSmoothing,
  MIN_VISIBLE_RISK_MS,
  RED_STALE_MAX_MS,
  YELLOW_HARD_MAX_MS,
  YELLOW_RESOLVING_MS,
  type HseRiskSmoothingCache,
} from "../features/hse-monitoring/hooks/useHseLiveRiskViewModel";
import {
  boxColorFor,
  boxLabelForEntity,
  shouldRenderEntityBox,
} from "../components/live/BackendEntityOverlay";
import type { ParsedDetectRisk } from "../lib/detection/backendVisionHttpDetector";
import type { BackendEntity, BackendPose, BBox } from "../lib/detection/types";
import type { HSEActiveAlert } from "../lib/detection/hseTypes";
import type { SceneRisk } from "../lib/detection/riskTypes";
import { SceneRiskPanel } from "../components/live/SceneRiskPanel";

const box = (x = 0.2, y = 0.2, w = 0.2, h = 0.2): BBox => ({ x, y, w, h });

const entity = (over: Partial<BackendEntity> = {}): BackendEntity => ({
  id: "entity-1",
  detection_id: "det-1",
  track_id: "trk-1",
  label: "object",
  class_id: 1,
  confidence: 0.9,
  bbox: box(),
  ...over,
});

const risk = (over: Partial<SceneRisk> = {}): SceneRisk => ({
  risk_id: "risk-1",
  hazard_type: "object_near_edge",
  risk_level: "YELLOW",
  risk_score: 4,
  linked_entity_id: "entity-1",
  recommended_action: "Move the object away from the edge.",
  risk_reason: "Object appears close to an edge.",
  produced_by: "deterministic_risk_engine",
  ...over,
});

const parsed = (over: Partial<ParsedDetectRisk> = {}): ParsedDetectRisk => ({
  sceneRisks: [],
  degraded: false,
  warnings: [],
  ...over,
});

const localAlert = (over: Partial<HSEActiveAlert> = {}): HSEActiveAlert =>
  ({
    key: "local-worker-near-vehicle",
    id: "alert-1",
    severity: "medium",
    category: "proximity",
    title: "Worker near vehicle",
    shortMessage: "Worker near vehicle",
    spokenMessage: "Worker near vehicle",
    recommendedAction: "Keep clear of vehicle routes.",
    confidence: 0.8,
    relatedTrackIds: ["trk-local"],
    wearablePattern: "single",
    reasoningSource: "rules",
    state: "active",
    firstFiredMs: 0,
    lastFiredMs: 0,
    lastSeenMs: 0,
    ...over,
  }) as HSEActiveAlert;

const pose = (score = 0.8): BackendPose => ({
  confidence: 0.9,
  keypoints: Array.from({ length: 8 }, (_, i) => ({
    name: `kp-${i}`,
    x: 0.3 + (i % 2) * 0.04,
    y: 0.3 + Math.floor(i / 2) * 0.04,
    score,
  })),
});

const handOnlyPose = (): BackendPose => ({
  confidence: 0.9,
  keypoints: [
    "wrist",
    "thumb_tip",
    "thumb_ip",
    "index_finger_tip",
    "index_finger_pip",
    "middle_finger_tip",
    "ring_finger_tip",
    "pinky_tip",
  ].map((name, index) => ({
    name,
    x: 0.32 + (index % 3) * 0.025,
    y: 0.55 + Math.floor(index / 3) * 0.025,
    score: 0.9,
  })),
});

const riskNames = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
];

function groupedRiskSet(count: number, over: Partial<SceneRisk> = {}): SceneRisk[] {
  return Array.from({ length: count }, (_, index) =>
    risk({
      risk_id: `risk-${riskNames[index] ?? index}`,
      hazard_type: `risk_${riskNames[index] ?? index}`,
      linked_entity_id: undefined,
      involved_track_ids: [`trk-${index}`],
      recommended_action: `Action ${index}`,
      risk_score: 100 - index,
      risk_level: "YELLOW",
      ...over,
    }),
  );
}

describe("HSE live risk view model", () => {
  it("uses worker scene risks as the visible HSE feed and hides local spam", () => {
    const workerRisk = risk({ risk_id: "edge-1" });
    const vm = buildHseLiveRiskViewModel({
      entities: [entity()],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [workerRisk] }),
      localActiveAlerts: [
        localAlert({ id: "a1" }),
        localAlert({ id: "a2" }),
        localAlert({ id: "a3" }),
        localAlert({ id: "a4" }),
      ],
      nowMs: 1000,
      localAlertsEnabled: true,
    });

    expect(vm.hasWorkerSceneRisks).toBe(true);
    expect(vm.shouldUseLocalFallback).toBe(false);
    expect(vm.priorityRisks).toHaveLength(1);
    expect(vm.priorityRisks[0].title).toBe("Object near edge");
    expect(vm.priorityRisks[0].sourceLabel).toBe("Rules");
  });

  it("keeps local alerts hidden by default and dedupes them when fallback is explicitly enabled", () => {
    const alerts = [localAlert({ id: "a1" }), localAlert({ id: "a2" }), localAlert({ id: "a3" })];
    const disabled = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [] }),
      localActiveAlerts: alerts,
      nowMs: 1000,
      localAlertsEnabled: false,
    });
    expect(disabled.priorityRisks).toEqual([]);
    expect(
      disabled.debugRisks.filter((item) => item.sourceLabel === "Local fallback"),
    ).toHaveLength(3);
    expect(
      disabled.debugRisks.every((item) => item.sourceLabel !== "Local fallback" || item.hidden),
    ).toBe(true);

    const fallback = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [] }),
      localActiveAlerts: alerts,
      nowMs: 1000,
      localAlertsEnabled: true,
    });
    expect(fallback.shouldUseLocalFallback).toBe(true);
    expect(fallback.priorityRisks).toHaveLength(1);
    expect(fallback.priorityRisks[0].sourceLabel).toBe("Local fallback");
  });

  it("returns a maximum of 10 grouped priority risks, not 3", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ sceneRisks: groupedRiskSet(12) }),
      nowMs: 1000,
    });
    expect(HSE_PRIORITY_RISK_LIMIT).toBe(10);
    expect(vm.groupedRisks).toHaveLength(12);
    expect(vm.priorityRisks).toHaveLength(10);
    expect(vm.priorityRisks.map((item) => item.title)).not.toContain("Risk Kilo");
    expect(vm.priorityRisks.map((item) => item.title)).not.toContain("Risk Lima");
  });

  it("ranks RED before ORANGE before YELLOW", () => {
    const groups = groupRisks(
      [
        risk({
          risk_id: "yellow",
          hazard_type: "yellow_risk",
          risk_level: "YELLOW",
          risk_score: 99,
        }),
        risk({ risk_id: "red", hazard_type: "red_risk", risk_level: "RED", risk_score: 1 }),
        risk({
          risk_id: "orange",
          hazard_type: "orange_risk",
          risk_level: "ORANGE",
          risk_score: 50,
        }),
      ],
      [],
    ).sort(rankGroupedRisks);
    expect(groups.map((item) => item.level)).toEqual(["RED", "ORANGE", "YELLOW"]);
  });

  it("ranks Rules + Qwen above rules-only at the same severity", () => {
    const groups = groupRisks(
      [
        risk({
          risk_id: "rules-only",
          hazard_type: "rules_only",
          risk_level: "YELLOW",
          risk_score: 5,
          produced_by: "deterministic_risk_engine",
        }),
        risk({
          risk_id: "qwen-confirmed",
          source_risk_id: "rules-source",
          hazard_type: "qwen_confirmed",
          risk_level: "YELLOW",
          risk_score: 5,
          produced_by: "vlm_reasoner",
          reasoner_model: "qwen_vl",
        }),
      ],
      [],
    ).sort(rankGroupedRisks);
    expect(groups[0].sourceLabel).toBe("Rules + Qwen");
  });

  it("acknowledged risk is hidden and the next ranked risk fills the top 10", () => {
    const first = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ sceneRisks: groupedRiskSet(11) }),
      nowMs: 1000,
    });
    const acknowledged = first.priorityRisks[1];
    const nextRisk = first.groupedRisks[10];
    const second = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ sceneRisks: groupedRiskSet(11) }),
      nowMs: 1100,
      acknowledgedRiskKeys: new Set([acknowledged.key]),
    });
    expect(second.priorityRisks).toHaveLength(10);
    expect(second.priorityRisks.map((item) => item.key)).not.toContain(acknowledged.key);
    expect(second.priorityRisks.map((item) => item.key)).toContain(nextRisk.key);
    expect(second.overlayEntities).toEqual([]);
  });

  it("groups duplicate object_near_edge risks before the top 10 slice", () => {
    const duplicateEntities = Array.from({ length: 5 }, (_, index) =>
      entity({
        id: `edge-entity-${index}`,
        detection_id: `edge-det-${index}`,
        track_id: `edge-${index}`,
        label: "detected_item",
        semantic_label: "detected item",
        bbox: box(0.25 + index * 0.04, 0.58, 0.08, 0.08),
      }),
    );
    const duplicateEdges = Array.from({ length: 5 }, (_, index) =>
      risk({
        risk_id: `edge-dup-${index}`,
        linked_entity_id: undefined,
        involved_track_ids: [`edge-${index}`],
        recommended_action: "Move objects away from edges.",
        risk_reason: "The object is close to the table edge.",
      }),
    );
    const vm = buildHseLiveRiskViewModel({
      entities: duplicateEntities,
      poses: [],
      parsedRisk: parsed({ sceneRisks: [...duplicateEdges, ...groupedRiskSet(10)] }),
      nowMs: 1000,
    });
    expect(vm.rawRiskCount).toBe(15);
    expect(vm.groupedRiskCount).toBe(11);
    expect(vm.priorityRisks).toHaveLength(10);
    expect(vm.groupedRisks.filter((item) => item.title === "Object near edge")).toHaveLength(1);
  });

  it("keeps linked object_near_edge risks without object allowlists and suppresses rules-only frame-edge artifacts", () => {
    const centeredEntity = entity({
      id: "center-1",
      detection_id: "center-det",
      track_id: "center-trk",
      label: "detected_item",
      semantic_label: "detected item",
      bbox: box(0.38, 0.55, 0.2, 0.18),
    });
    const frameEdgeEntity = entity({
      id: "edge-1",
      detection_id: "edge-det",
      track_id: "edge-trk",
      label: "detected_item",
      semantic_label: "detected item",
      bbox: box(0.0, 0.15, 0.18, 0.5),
    });
    const vm = buildHseLiveRiskViewModel({
      entities: [centeredEntity, frameEdgeEntity],
      poses: [],
      parsedRisk: parsed({
        sceneRisks: [
          risk({
            risk_id: "center-edge",
            linked_entity_id: "center-1",
            risk_reason: "Object is close to the table edge.",
          }),
          risk({
            risk_id: "frame-artifact",
            linked_entity_id: "edge-1",
            risk_reason: "Object is close to the camera edge.",
          }),
        ],
      }),
      nowMs: 1000,
    });

    expect(vm.groupedRisks).toHaveLength(1);
    expect(vm.groupedRisks[0].linkedLabels).toEqual(["detected item"]);
    expect(vm.overlayEntities).toHaveLength(1);
    expect(vm.overlayEntities[0].id).toBe("center-1");
  });

  it("lets Qwen-confirmed object_near_edge risks override the frame-edge artifact guard", () => {
    const frameEdgeEntity = entity({
      id: "edge-qwen",
      detection_id: "edge-qwen-det",
      track_id: "edge-qwen-trk",
      label: "unknown",
      bbox: box(0.0, 0.2, 0.18, 0.2),
    });
    const vm = buildHseLiveRiskViewModel({
      entities: [frameEdgeEntity],
      poses: [],
      parsedRisk: parsed({
        sceneRisks: [
          risk({
            risk_id: "qwen-edge",
            linked_entity_id: "edge-qwen",
            produced_by: "vlm_reasoner",
            reasoner_model: "qwen_vl",
            risk_reason: "Qwen confirmed the object is at the real support edge.",
          }),
        ],
      }),
      nowMs: 1000,
    });

    expect(vm.groupedRisks).toHaveLength(1);
    expect(vm.groupedRisks[0].sourceLabel).toBe("Qwen");
    expect(vm.overlayEntities).toHaveLength(1);
  });

  it("escalates strong edge risks but keeps weak latent edge risks GREEN", () => {
    expect(effectiveRiskLevel({ risk: risk({ risk_level: "GREEN", risk_score: 4 }) })).toBe(
      "YELLOW",
    );
    // weak latent object_near_edge stays GREEN under the neutralized policy
    expect(
      effectiveRiskLevel({
        risk: risk({ risk_level: "GREEN", risk_score: 1, risk_state: "latent" }),
      }),
    ).toBe("GREEN");
  });

  it("does not let entity GREEN downgrade a linked active scene YELLOW", () => {
    const ent = entity({ risk_level: "GREEN" });
    const groups = groupRisks([risk({ risk_level: "YELLOW" })], [ent], "YELLOW");
    const overlay = filterOverlayEntities([ent], groups);
    expect(groups[0].level).toBe("YELLOW");
    expect(overlay).toHaveLength(1);
    expect(overlay[0].risk_level).toBe("YELLOW");
  });

  it("acknowledgement hides the priority card but keeps the active camera box", () => {
    const first = buildHseLiveRiskViewModel({
      entities: [entity()],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [risk()] }),
      nowMs: 1000,
    });
    const acked = buildHseLiveRiskViewModel({
      entities: [entity()],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [risk()] }),
      nowMs: 1100,
      acknowledgedRiskKeys: new Set([first.priorityRisks[0].key]),
    });
    expect(acked.priorityRisks).toHaveLength(0);
    expect(acked.overlayEntities).toHaveLength(1);
  });

  it("keeps Qwen candidate lane off by default and advisory-only when enabled", () => {
    const qwen = risk({
      risk_id: "qwen-1",
      linked_entity_id: undefined,
      produced_by: "vlm_reasoner",
      reasoner_model: "qwen_vl",
      candidate_status: "unlinked",
    });
    const off = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ qwenCandidates: [qwen] }),
      nowMs: 1000,
    });
    expect(off.qwenCandidates).toEqual([]);
    expect(off.overlayEntities).toEqual([]);

    const on = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk: parsed({ qwenCandidates: [qwen] }),
      nowMs: 1000,
      qwenCandidateLaneEnabled: true,
      showQwenCandidates: true,
    });
    expect(on.qwenCandidates).toHaveLength(1);
    expect(on.qwenCandidates[0].status).toBe("unlinked");
    expect(on.overlayEntities).toEqual([]);
  });

  it("allows a matched Qwen candidate risk to color the detector entity", () => {
    const vm = buildHseLiveRiskViewModel({
      entities: [entity()],
      poses: [],
      parsedRisk: parsed({
        sceneRisks: [
          risk({
            risk_id: "qwen-matched",
            produced_by: "vlm_reasoner",
            reasoner_model: "qwen_vl",
            candidate_status: "matched",
            risk_level: "GREEN",
            risk_score: 4,
          }),
        ],
      }),
      nowMs: 1000,
      qwenCandidateLaneEnabled: true,
      showQwenCandidates: true,
    });
    expect(vm.overlayEntities).toHaveLength(1);
    expect(vm.overlayEntities[0].risk_level).toBe("YELLOW");
    expect(vm.groupedRisks[0].sourceLabel).toBe("Qwen");
  });

  it("filters HSE overlays to risk-linked boxes and removes risk words from labels", () => {
    const neutral = entity({ risk_level: undefined, linked_risk_id: undefined });
    const risky = entity({ id: "entity-2", risk_level: "YELLOW", linked_risk_id: "risk-2" });
    const manyNeutral = Array.from({ length: 10 }, (_, index) =>
      entity({
        id: `neutral-${index}`,
        detection_id: `neutral-det-${index}`,
        track_id: `neutral-trk-${index}`,
        risk_level: undefined,
        linked_risk_id: undefined,
      }),
    );
    expect(shouldRenderEntityBox(neutral, [], false, "hse-risk-only")).toBe(false);
    expect(shouldRenderEntityBox(risky, [], false, "hse-risk-only")).toBe(true);
    expect(filterOverlayEntities([neutral], [])).toEqual([]);
    expect(filterOverlayEntities([...manyNeutral, risky], [])).toHaveLength(1);

    const label = boxLabelForEntity(
      { ...risky, risk_stale: true, risk_resolving: true },
      true,
      "hse-risk-only",
    );
    expect(typeof label).toBe("string");
    expect(label).not.toMatch(/GREEN|YELLOW|ORANGE|RED|stale|resolving|score|track/i);
    expect(boxLabelForEntity(risky, true, "debug")).toContain("YELLOW");
    expect(boxColorFor(risky, true)).toContain("251,191,36");
  });

  it("filters purple pose candidates unless a real person entity is confirmed", () => {
    const hidden = filterHsePoses([pose()], [entity({ label: "chair" })], undefined, false);
    expect(hidden.poses).toHaveLength(0);
    expect(hidden.hiddenPoseReasons[0]).toContain("no matching person entity");

    const shown = filterHsePoses(
      [pose()],
      [entity({ label: "person", confidence: 0.8, bbox: box(0.25, 0.25, 0.2, 0.25) })],
      undefined,
      false,
    );
    expect(shown.poses).toHaveLength(1);
  });

  it("hides hand-only backend pose candidates even near a person-like box", () => {
    const hidden = filterHsePoses(
      [handOnlyPose()],
      [entity({ label: "person", confidence: 0.8, bbox: box(0.25, 0.45, 0.2, 0.2) })],
      undefined,
      false,
    );
    expect(hidden.poses).toHaveLength(0);
    expect(hidden.hiddenPoseReasons[0]).toContain("no torso structure");
  });

  it("formats reasoner status and hazard labels without raw JSON", () => {
    expect(formatReasonerBadge({ state: "queued", model: "qwen_vl" }).label).toBe("Qwen: queued");
    expect(formatReasonerBadge({ state: "unavailable", model: "qwen_vl" }).label).toContain(
      "using rules only",
    );
    expect(formatHazardLabel("object_near_edge")).toBe("Object near edge");
  });

  it("SceneRiskPanel default view shows the top 10 grouped risks", () => {
    const parsedRisk = parsed({ sceneRisks: groupedRiskSet(12) });
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk,
      nowMs: 1000,
    });
    const html = renderToStaticMarkup(
      createElement(SceneRiskPanel, {
        risk: parsedRisk,
        hseRiskViewModel: vm,
      }),
    );
    expect(html).toContain("Top 10 scene risks");
    expect(html).toContain("Risk Alpha");
    expect(html).toContain("Risk Juliet");
    expect(html).not.toContain("Risk Kilo");
    expect(html).not.toContain("Risk Lima");
    expect(html).toContain("Showing top 10 of 12 grouped scene risks");
  });

  it("SceneRiskPanel provenance can show raw and grouped counts", () => {
    const parsedRisk = parsed({
      sceneRisks: groupedRiskSet(12),
      temporalReasoning: { session_id: "demo-session", enabled: true },
      sceneContext: { summary: "Indoor demo" },
    });
    const vm = buildHseLiveRiskViewModel({
      entities: [],
      poses: [],
      parsedRisk,
      nowMs: 1000,
    });
    const html = renderToStaticMarkup(
      createElement(SceneRiskPanel, {
        risk: parsedRisk,
        hseRiskViewModel: vm,
        showProvenance: true,
      }),
    );
    expect(html).toContain("Raw risks: 12");
    expect(html).toContain("Grouped risks: 12");
    expect(html).toContain("Hidden/acknowledged risks: 2");
    expect(html).toContain("temporal:");
  });
});

describe("HSE risk smoothing", () => {
  it("keeps a linked risk visible for at least 1000 ms and clears YELLOW by the hard max", () => {
    const cache: HseRiskSmoothingCache = new Map();
    const base = buildHseLiveRiskViewModel({
      entities: [entity({ risk_level: "YELLOW", linked_risk_id: "risk-1" })],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [risk()] }),
      nowMs: 0,
    });
    applyHseRiskSmoothing(base, cache, 0);

    const empty = { ...base, overlayEntities: [] };
    const resolving = applyHseRiskSmoothing(empty, cache, YELLOW_RESOLVING_MS - 1);
    expect(resolving.overlayEntities[0]?.risk_resolving).toBe(true);

    const carried = applyHseRiskSmoothing(empty, cache, MIN_VISIBLE_RISK_MS - 100);
    expect(carried.overlayEntities).toHaveLength(1);
    expect(carried.overlayEntities[0].risk_stale).toBe(true);
    expect(carried.overlayEntities[0].risk_resolving).toBe(false);

    const expired = applyHseRiskSmoothing(empty, cache, YELLOW_HARD_MAX_MS + 1);
    expect(expired.overlayEntities).toHaveLength(0);
  });

  it("carries RED only as stale and expires by the stale max unless reconfirmed", () => {
    const cache: HseRiskSmoothingCache = new Map();
    const base = buildHseLiveRiskViewModel({
      entities: [entity({ risk_level: "RED", linked_risk_id: "risk-red" })],
      poses: [],
      parsedRisk: parsed({ sceneRisks: [risk({ risk_level: "RED", risk_id: "risk-red" })] }),
      nowMs: 0,
    });
    applyHseRiskSmoothing(base, cache, 0);

    const empty = { ...base, overlayEntities: [] };
    const carried = applyHseRiskSmoothing(empty, cache, RED_STALE_MAX_MS - 1);
    expect(carried.overlayEntities).toHaveLength(1);
    expect(carried.overlayEntities[0].risk_stale).toBe(true);
    expect(carried.overlayEntities[0].risk_resolving).toBe(false);

    const expired = applyHseRiskSmoothing(empty, cache, RED_STALE_MAX_MS + 1);
    expect(expired.overlayEntities).toHaveLength(0);
  });
});
