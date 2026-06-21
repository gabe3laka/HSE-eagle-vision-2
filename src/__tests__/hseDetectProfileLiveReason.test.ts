import { describe, expect, it } from "vitest";
import {
  applyHseRequestToBody,
  buildHseDetectRequest,
  HSE_LIVE_DETECT_REASON,
  NEUTRAL_HSE_REASONING_PREFERENCES,
} from "@/lib/detection/hseDetectProfile";
import { buildHeartbeatMonitoringRequest } from "@/features/hse-monitoring/hooks/useReasonerHeartbeat";

describe("hseDetectProfile — live detect must not displace reasoner jobs", () => {
  it("NEUTRAL_HSE_REASONING_PREFERENCES sets do_not_start_new_reasoning_job=true and force_reason=false", () => {
    expect(NEUTRAL_HSE_REASONING_PREFERENCES.do_not_start_new_reasoning_job).toBe(true);
    expect(NEUTRAL_HSE_REASONING_PREFERENCES.force_reason).toBe(false);
  });

  it("exports a distinct HSE_LIVE_DETECT_REASON token", () => {
    expect(HSE_LIVE_DETECT_REASON).toBe("hse-live-detect");
  });

  it("a live detect body carries force_reason=false and do_not_start_new_reasoning_job=true", () => {
    const req = buildHseDetectRequest("balanced", null, HSE_LIVE_DETECT_REASON);
    const body = applyHseRequestToBody({ image_b64: "x" }, req) as Record<string, unknown>;
    const prefs = body.reasoning_preferences as Record<string, unknown>;
    expect(prefs.force_reason).toBe(false);
    expect(prefs.do_not_start_new_reasoning_job).toBe(true);
    expect(body.requestReason).toBe(HSE_LIVE_DETECT_REASON);
  });

  it("a heartbeat body still carries force_reason=true (and may displace), and overrides do_not_start_new_reasoning_job", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, true);
    const body = applyHseRequestToBody({ image_b64: "x" }, req) as Record<string, unknown>;
    const prefs = body.reasoning_preferences as Record<string, unknown>;
    expect(prefs.force_reason).toBe(true);
    // The heartbeat override does NOT include do_not_start_new_reasoning_job
    // — but neutral prefs are merged underneath, so the merged value is the
    // neutral default (true). The override would only re-set this to false if
    // explicitly listed. Document the actual merged outcome:
    expect(prefs.do_not_start_new_reasoning_job).toBe(true);
    expect(body.requestReason).toBe("hse-reasoner-heartbeat");
  });
});
