import { describe, it, expect } from "vitest";
import {
  buildHeartbeatMonitoringRequest,
  hasReasonerUnavailableWarning,
  isReasonerFailureResponse,
  pickEffectiveHeartbeatSessionId,
  pickHeartbeatDelay,
} from "@/features/hse-monitoring/hooks/useReasonerHeartbeat";

describe("buildHeartbeatMonitoringRequest", () => {
  it("uses requestReason 'hse-reasoner-heartbeat'", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, true);
    expect(req.requestReason).toBe("hse-reasoner-heartbeat");
  });

  it("includes scene_reasoning + detect/track/risk in tasks", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, true);
    expect(req.tasks).toEqual(
      expect.arrayContaining(["detect", "track", "risk", "scene_reasoning"]),
    );
  });

  it("when forceReason=true, sets reasoningPreferencesOverride.force_reason=true and key prefs", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, true);
    const o = req.reasoningPreferencesOverride!;
    expect(o.force_reason).toBe(true);
    expect(o.return_scene_risks).toBe(true);
    expect(o.return_scene_context).toBe(true);
    expect(o.return_semantic_corrections).toBe(true);
    expect(o.return_linked_entities).toBe(true);
    expect(o.return_reasoner_status).toBe(true);
    expect(o.verify_current_frame_before_reusing_cached_risk).toBe(true);
  });

  it("includes target_reasoning_interval_ms and max_candidate_age_ms (cadence hints to worker)", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, true);
    const o = req.reasoningPreferencesOverride!;
    expect(o.target_reasoning_interval_ms).toBe(1500);
    expect(o.max_candidate_age_ms).toBe(1500);
  });

  it("when forceReason=false, no override applied", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, false);
    expect(req.reasoningPreferencesOverride).toBeUndefined();
  });
});

describe("hasReasonerUnavailableWarning", () => {
  it("accepts the new generic 'reasoner_unavailable' token", () => {
    expect(hasReasonerUnavailableWarning(["reasoner_unavailable"])).toBe(true);
  });
  it("still accepts the legacy 'qwen_unavailable' token", () => {
    expect(hasReasonerUnavailableWarning(["qwen_unavailable"])).toBe(true);
  });
  it("false for unrelated / empty warnings", () => {
    expect(hasReasonerUnavailableWarning([])).toBe(false);
    expect(hasReasonerUnavailableWarning(["degraded"])).toBe(false);
  });
});

describe("isReasonerFailureResponse", () => {
  it("true on reasoner_unavailable warning (new token)", () => {
    expect(
      isReasonerFailureResponse({
        warnings: ["reasoner_unavailable"],
        normalizedReasonerStatus: "ready",
        rawReasonerStatus: "ready",
      }),
    ).toBe(true);
  });

  it("true on legacy qwen_unavailable warning", () => {
    expect(
      isReasonerFailureResponse({
        warnings: ["qwen_unavailable"],
        normalizedReasonerStatus: "ready",
        rawReasonerStatus: "ready",
      }),
    ).toBe(true);
  });

  it("true on failure status (normalized or raw, any case), including json_parse_error", () => {
    for (const s of [
      "unavailable",
      "ERROR",
      "Timeout",
      "disabled",
      "not_run",
      "schema_error",
      "json_parse_error",
    ]) {
      expect(
        isReasonerFailureResponse({
          warnings: [],
          normalizedReasonerStatus: s,
          rawReasonerStatus: null,
        }),
      ).toBe(true);
      expect(
        isReasonerFailureResponse({
          warnings: [],
          normalizedReasonerStatus: null,
          rawReasonerStatus: s,
        }),
      ).toBe(true);
    }
  });

  it("false on ready/running/queued", () => {
    for (const s of ["ready", "running", "queued"]) {
      expect(
        isReasonerFailureResponse({
          warnings: [],
          normalizedReasonerStatus: s,
          rawReasonerStatus: s,
        }),
      ).toBe(false);
    }
  });
});

describe("pickEffectiveHeartbeatSessionId", () => {
  it("adopts a non-empty override, else falls back", () => {
    expect(pickEffectiveHeartbeatSessionId("hse-sess-1", "fallback")).toBe("hse-sess-1");
    expect(pickEffectiveHeartbeatSessionId("  ", "fallback")).toBe("fallback");
    expect(pickEffectiveHeartbeatSessionId(null, "fallback")).toBe("fallback");
  });
});

describe("pickHeartbeatDelay", () => {
  it("uses intervalMs on success, backoffMs on failure", () => {
    expect(pickHeartbeatDelay({ failed: false, intervalMs: 2000, backoffMs: 10000 })).toBe(2000);
    expect(pickHeartbeatDelay({ failed: true, intervalMs: 2000, backoffMs: 10000 })).toBe(10000);
  });

  it("clamps intervalMs to >= 1000", () => {
    expect(pickHeartbeatDelay({ failed: false, intervalMs: 100, backoffMs: 10000 })).toBe(1000);
  });

  it("clamps backoffMs to >= intervalMs", () => {
    expect(pickHeartbeatDelay({ failed: true, intervalMs: 5000, backoffMs: 1000 })).toBe(5000);
  });

  it("recovery returns to intervalMs", () => {
    // Simulate failed → recovered sequence
    expect(pickHeartbeatDelay({ failed: true, intervalMs: 2000, backoffMs: 10000 })).toBe(10000);
    expect(pickHeartbeatDelay({ failed: false, intervalMs: 2000, backoffMs: 10000 })).toBe(2000);
  });

  it("uses extendedBackoffMs once consecutiveFailures reaches extendedBackoffAfter", () => {
    const base = {
      failed: true,
      intervalMs: 2000,
      backoffMs: 10000,
      extendedBackoffMs: 30000,
      extendedBackoffAfter: 3,
    };
    expect(pickHeartbeatDelay({ ...base, consecutiveFailures: 1 })).toBe(10000);
    expect(pickHeartbeatDelay({ ...base, consecutiveFailures: 2 })).toBe(10000);
    expect(pickHeartbeatDelay({ ...base, consecutiveFailures: 3 })).toBe(30000);
    expect(pickHeartbeatDelay({ ...base, consecutiveFailures: 10 })).toBe(30000);
  });

  it("on success returns interval even if consecutiveFailures is high (caller resets)", () => {
    expect(
      pickHeartbeatDelay({
        failed: false,
        intervalMs: 2000,
        backoffMs: 10000,
        extendedBackoffMs: 30000,
        extendedBackoffAfter: 3,
        consecutiveFailures: 5,
      }),
    ).toBe(2000);
  });

  it("clamps extendedBackoffMs to >= backoffMs", () => {
    expect(
      pickHeartbeatDelay({
        failed: true,
        intervalMs: 2000,
        backoffMs: 10000,
        extendedBackoffMs: 1000,
        extendedBackoffAfter: 1,
        consecutiveFailures: 5,
      }),
    ).toBe(10000);
  });
});

describe("legacy compatibility re-export (useQwenHeartbeat.ts)", () => {
  it("old names still resolve to the generic implementation", async () => {
    const legacy = await import("@/features/hse-monitoring/hooks/useQwenHeartbeat");
    // Constants alias through.
    expect(legacy.QWEN_PENDING_HARD_MAX_MS).toBe(45000);
    expect(legacy.QWEN_TERMINAL_FAILURE_STATES.has("json_parse_error")).toBe(true);
    // isQwenFailureResponse aliases isReasonerFailureResponse.
    expect(
      legacy.isQwenFailureResponse({
        warnings: ["qwen_unavailable"],
        normalizedReasonerStatus: null,
        rawReasonerStatus: null,
      }),
    ).toBe(true);
    // classifyQwenLifecycle aliases classifyReasonerLifecycle.
    expect(
      legacy.classifyQwenLifecycle({
        rawReasonerStatus: "json_parse_error",
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("terminal-failure");
  });
});
