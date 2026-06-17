import { describe, it, expect } from "vitest";
import {
  parseDetectRiskFields,
  hasRiskAwareData,
  mergeEntityRisk,
  readDetectUrl,
} from "../lib/detection/backendVisionHttpDetector";
import { normalizeEntities } from "../lib/detection/backendVisionDetector";
import {
  shouldShowDegradedBanner,
  isAiDraftReviewRequired,
  gateRiskAlerts,
  shouldSurfaceRiskAlert,
  highestRiskLevel,
  isReasonerUnavailable,
  type SceneRisk,
} from "../lib/detection/riskTypes";
import { readFlag, readRiskFeatureFlags } from "../lib/featureFlags";

// ── (1) old detection response parses to entities ────────────────────────────
describe("backward-compatible parsing", () => {
  it("(1) an old det-only response still parses to entities", () => {
    const resp = {
      entities: [
        { label: "person", class_id: 0, confidence: 0.9, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 } },
      ],
      backend: "yolo26",
    };
    const ents = normalizeEntities(resp.entities);
    expect(ents).toHaveLength(1);
    expect(ents[0].label).toBe("person");
    // No risk-aware fields → no parsed risk view.
    expect(hasRiskAwareData(resp)).toBe(false);
  });

  // ── (2) new risk-aware response parses ─────────────────────────────────────
  it("(2) a risk-aware response parses scene_risks / risk_summary / entity risk fields", () => {
    const resp = {
      schema_version: "2",
      risk_engine: "deterministic-v1",
      entities: [
        {
          label: "person",
          class_id: 0,
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
          track_id: "t1",
          risk_level: "RED",
          risk_reason: "too close to forklift",
          requires_human_review: true,
          produced_by: "vlm_reasoner",
        },
      ],
      scene_risks: [
        {
          risk_id: "r1",
          track_id: "t1",
          hazard: "forklift_proximity",
          risk_level: "RED",
          risk_reason: "person within swing radius",
          should_alert: true,
          recommended_controls: [{ level: "engineering", action: "Install barriers" }],
        },
      ],
      risk_summary: { highest_level: "RED", total: 1, alerting_count: 1, by_level: { RED: 1 } },
      risk_enabled: true,
      degraded: false,
    };
    expect(hasRiskAwareData(resp)).toBe(true);
    const parsed = parseDetectRiskFields(resp);
    expect(parsed.schemaVersion).toBe("2");
    expect(parsed.riskEngine).toBe("deterministic-v1");
    expect(parsed.sceneRisks).toHaveLength(1);
    expect(parsed.sceneRisks[0].risk_id).toBe("r1");
    expect(parsed.riskSummary?.highest_level).toBe("RED");
    expect(parsed.riskEnabled).toBe(true);
    expect(parsed.schemaWarning).toBeUndefined();

    // entity-level risk fields merge onto normalized entities
    const ents = normalizeEntities(resp.entities);
    mergeEntityRisk(ents, resp.entities);
    expect(ents[0].risk_level).toBe("RED");
    expect(ents[0].track_id).toBe("t1");
    expect(ents[0].requires_human_review).toBe(true);
  });

  // ── (3) missing scene_risks doesn't crash ──────────────────────────────────
  it("(3) missing scene_risks does not crash", () => {
    const parsed = parseDetectRiskFields({ schema_version: "2", risk_enabled: true });
    expect(parsed.sceneRisks).toEqual([]);
    expect(parsed.degraded).toBe(false);
  });

  it("combines risks + scene_risks and de-dupes repeated risk IDs", () => {
    const parsed = parseDetectRiskFields({
      scene_risks: [
        { risk_id: "x", risk_level: "ORANGE", hazard_type: "spill" },
        { risk_id: "scene-only", risk_level: "YELLOW" },
      ],
      risks: [
        { risk_id: "x", risk_level: "RED", hazard_type: "duplicate" },
        { risk_id: "risk-only", risk_level: "GREEN" },
      ],
      temporal_reasoning: { carried_tracks: 1 },
      scene_context: { environment_type: "indoor" },
      semantic_corrections: [{ correction_id: "c1", action: "semantic_label" }],
    });
    expect(parsed.sceneRisks.map((item) => item.risk_id)).toEqual([
      "x",
      "scene-only",
      "risk-only",
    ]);
    expect(parsed.sceneRisks[0].risk_level).toBe("ORANGE");
    expect(parsed.temporalReasoning).toEqual({ carried_tracks: 1 });
    expect(parsed.sceneContext).toEqual({ environment_type: "indoor" });
    expect(parsed.semanticCorrections).toHaveLength(1);
  });

  it("parses object-form reasoner_status without crashing the UI", () => {
    const status = { state: "timeout", model: "risk-reasoner", reason: "deadline" };
    const parsed = parseDetectRiskFields({ scene_risks: [], reasoner_status: status });
    expect(parsed.reasonerStatus).toEqual(status);
    expect(isReasonerUnavailable(parsed.reasonerStatus)).toBe(true);
  });

  // ── (4) unknown schema_version doesn't crash ───────────────────────────────
  it("(4) an unknown schema_version does not crash and surfaces a debug warning", () => {
    const parsed = parseDetectRiskFields({ schema_version: "999", scene_risks: [] });
    expect(parsed.schemaVersion).toBe("999");
    expect(parsed.schemaWarning).toContain("999");
    expect(parsed.sceneRisks).toEqual([]);
  });

  it("tolerates totally unknown fields and non-object input", () => {
    expect(() => parseDetectRiskFields({ totally_unknown: 1 })).not.toThrow();
    expect(parseDetectRiskFields(null).sceneRisks).toEqual([]);
    expect(parseDetectRiskFields("nope").sceneRisks).toEqual([]);
    expect(hasRiskAwareData(null)).toBe(false);
  });
});

// ── (5) degraded banner decider ──────────────────────────────────────────────
describe("(5) shouldShowDegradedBanner", () => {
  it("true only when degraded === true", () => {
    expect(shouldShowDegradedBanner({ degraded: true })).toBe(true);
    expect(shouldShowDegradedBanner({ degraded: false })).toBe(false);
    expect(shouldShowDegradedBanner({})).toBe(false);
    expect(shouldShowDegradedBanner(null)).toBe(false);
  });
});

// ── (6) AI-draft-review-required label decider ───────────────────────────────
describe("(6) isAiDraftReviewRequired", () => {
  it("true for vlm_reasoner or requires_human_review", () => {
    expect(isAiDraftReviewRequired({ produced_by: "vlm_reasoner" })).toBe(true);
    expect(isAiDraftReviewRequired({ requires_human_review: true })).toBe(true);
    expect(isAiDraftReviewRequired({ produced_by: "rules" })).toBe(false);
    expect(isAiDraftReviewRequired(null)).toBe(false);
  });

  it("isReasonerUnavailable flags timeout/unavailable/schema_error only", () => {
    expect(isReasonerUnavailable("timeout")).toBe(true);
    expect(isReasonerUnavailable("unavailable")).toBe(true);
    expect(isReasonerUnavailable("schema_error")).toBe(true);
    expect(isReasonerUnavailable({ state: "timeout" })).toBe(true);
    expect(isReasonerUnavailable("ok")).toBe(false);
    expect(isReasonerUnavailable({ state: "ok" })).toBe(false);
    expect(isReasonerUnavailable(undefined)).toBe(false);
  });
});

// ── (7) feature-flag helper: readFlag off-by-default; risk flags default ON ──
describe("(7) feature flags", () => {
  it("readFlag returns its default (false) when env is unset", () => {
    expect(readFlag("VITE_RISK_AWARE_OVERLAY", {})).toBe(false);
    expect(readFlag("VITE_WORKER_SCENE_RISKS", { VITE_WORKER_SCENE_RISKS: "false" })).toBe(false);
    expect(readFlag("VITE_WORKER_SCENE_RISKS", { VITE_WORKER_SCENE_RISKS: "1" })).toBe(false);
  });

  it("readFlag is true for 'true', false for 'false', else the default", () => {
    expect(readFlag("VITE_RISK_AWARE_OVERLAY", { VITE_RISK_AWARE_OVERLAY: "true" })).toBe(true);
    expect(readFlag("VITE_RISK_AWARE_OVERLAY", {}, true)).toBe(true);
    expect(readFlag("VITE_RISK_AWARE_OVERLAY", { VITE_RISK_AWARE_OVERLAY: "false" }, true)).toBe(
      false,
    );
  });

  it("readRiskFeatureFlags keeps risk UI on and HSE optional lanes off by default", () => {
    const f = readRiskFeatureFlags({});
    expect(f.riskAwareOverlay).toBe(true);
    expect(f.workerSceneRisks).toBe(true);
    expect(f.riskDebugPanel).toBe(true);
    expect(f.showControlHierarchy).toBe(true);
    expect(f.showProvenance).toBe(true);
    expect(f.cameraPrivacyNotice).toBe(true);
    expect(f.hseQwenCandidateLaneEnabled).toBe(false);
    expect(f.hseShowQwenCandidates).toBe(false);
    expect(f.hseLocalAlertsEnabled).toBe(false);
  });

  it("readRiskFeatureFlags honours an explicit 'false' opt-out", () => {
    const f = readRiskFeatureFlags({ VITE_RISK_AWARE_OVERLAY: "false" });
    expect(f.riskAwareOverlay).toBe(false);
    expect(f.workerSceneRisks).toBe(true);
  });

  it("readRiskFeatureFlags enables optional HSE lanes only when explicit", () => {
    const f = readRiskFeatureFlags({
      VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED: "true",
      VITE_HSE_SHOW_QWEN_CANDIDATES: "true",
      VITE_HSE_LOCAL_ALERTS_ENABLED: "true",
    });
    expect(f.hseQwenCandidateLaneEnabled).toBe(true);
    expect(f.hseShowQwenCandidates).toBe(true);
    expect(f.hseLocalAlertsEnabled).toBe(true);
  });
});

// ── (8) alert gating: should_alert || ORANGE || RED, dedupe by id ────────────
describe("(8) gateRiskAlerts", () => {
  const make = (o: Partial<SceneRisk>): SceneRisk => o;

  it("surfaces only should_alert || ORANGE || RED", () => {
    expect(shouldSurfaceRiskAlert(make({ should_alert: true, risk_level: "GREEN" }))).toBe(true);
    expect(shouldSurfaceRiskAlert(make({ risk_level: "ORANGE" }))).toBe(true);
    expect(shouldSurfaceRiskAlert(make({ risk_level: "RED" }))).toBe(true);
    expect(shouldSurfaceRiskAlert(make({ risk_level: "YELLOW" }))).toBe(false);
    expect(shouldSurfaceRiskAlert(make({ risk_level: "GREEN" }))).toBe(false);
    expect(shouldSurfaceRiskAlert(null)).toBe(false);
  });

  it("dedupes by risk_id, then track_id", () => {
    const risks: SceneRisk[] = [
      make({ risk_id: "r1", risk_level: "RED" }),
      make({ risk_id: "r1", risk_level: "RED" }), // dup by risk_id
      make({ track_id: "t2", risk_level: "ORANGE" }),
      make({ track_id: "t2", risk_level: "ORANGE" }), // dup by track_id
      make({ risk_level: "YELLOW" }), // filtered out (not alerting)
    ];
    const gated = gateRiskAlerts(risks);
    expect(gated).toHaveLength(2);
    expect(gated[0].risk_id).toBe("r1");
    expect(gated[1].track_id).toBe("t2");
  });

  it("highestRiskLevel picks the most severe", () => {
    expect(
      highestRiskLevel([{ risk_level: "GREEN" }, { risk_level: "RED" }, { risk_level: "YELLOW" }]),
    ).toBe("RED");
    expect(highestRiskLevel([])).toBeNull();
  });
});

// ── (9) detect-URL resolver returns the Cloudflare gateway, never RunPod ──────
describe("(9) readDetectUrl", () => {
  it("returns a gateway /detect URL and never a raw RunPod URL", () => {
    const url = readDetectUrl();
    expect(typeof url).toBe("string");
    expect(url).toMatch(/\/detect$/);
    expect(url).not.toContain("runpod");
  });
});
