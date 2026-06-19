import { describe, it, expect } from "vitest";
import {
  buildHeartbeatMonitoringRequest,
  isQwenFailureResponse,
  pickHeartbeatDelay,
} from "@/features/hse-monitoring/hooks/useQwenHeartbeat";

describe("buildHeartbeatMonitoringRequest", () => {
  it("uses requestReason 'hse-qwen-heartbeat'", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, true);
    expect(req.requestReason).toBe("hse-qwen-heartbeat");
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

  it("when forceReason=false, no override applied", () => {
    const req = buildHeartbeatMonitoringRequest("balanced", null, false);
    expect(req.reasoningPreferencesOverride).toBeUndefined();
  });
});
