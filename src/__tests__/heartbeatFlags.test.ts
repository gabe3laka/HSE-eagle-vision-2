import { describe, it, expect } from "vitest";
import {
  readHseReasonerHeartbeatFlags,
  readHseQwenHeartbeatFlags,
  readHseFeatureFlags,
} from "@/lib/featureFlags";

describe("readHseReasonerHeartbeatFlags (canonical + legacy alias + clamp)", () => {
  it("uses prompt defaults when env is empty", () => {
    const f = readHseReasonerHeartbeatFlags({});
    expect(f.enabled).toBe(true);
    expect(f.intervalMs).toBe(2000);
    expect(f.minIntervalMs).toBe(1000);
    // Canonical default TTL is 8000 per the system prompt.
    expect(f.resultTtlMs).toBe(8000);
    expect(f.forceReason).toBe(true);
  });

  it("reads canonical VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS", () => {
    const f = readHseReasonerHeartbeatFlags({
      VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS: "1500",
    });
    expect(f.intervalMs).toBe(1500);
  });

  it("canonical interval WINS over legacy VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS / _MS", () => {
    const f = readHseReasonerHeartbeatFlags({
      VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS: "1500",
      VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS: "7777",
      VITE_HSE_QWEN_HEARTBEAT_MS: "9999",
    });
    expect(f.intervalMs).toBe(1500);
  });

  it("falls back to legacy canonical VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS when generic absent", () => {
    const f = readHseReasonerHeartbeatFlags({ VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS: "1800" });
    expect(f.intervalMs).toBe(1800);
  });

  it("falls back to legacy VITE_HSE_QWEN_HEARTBEAT_MS when newer aliases absent", () => {
    const f = readHseReasonerHeartbeatFlags({ VITE_HSE_QWEN_HEARTBEAT_MS: "1900" });
    expect(f.intervalMs).toBe(1900);
  });

  it("canonical enabled=false WINS over legacy enabled=true", () => {
    const f = readHseReasonerHeartbeatFlags({
      VITE_HSE_REASONER_HEARTBEAT_ENABLED: "false",
      VITE_HSE_QWEN_HEARTBEAT_ENABLED: "true",
    });
    expect(f.enabled).toBe(false);
  });

  it("legacy enabled flag still honored when canonical absent", () => {
    const f = readHseReasonerHeartbeatFlags({ VITE_HSE_QWEN_HEARTBEAT_ENABLED: "false" });
    expect(f.enabled).toBe(false);
  });

  it("clamps intervalMs to MIN_INTERVAL_MS floor (canonical min)", () => {
    const f = readHseReasonerHeartbeatFlags({
      VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS: "500",
      VITE_HSE_REASONER_HEARTBEAT_MIN_INTERVAL_MS: "1200",
    });
    expect(f.minIntervalMs).toBe(1200);
    expect(f.intervalMs).toBe(1200);
  });

  it("hard floor of 1000 ms even when MIN_INTERVAL_MS is set lower", () => {
    const f = readHseReasonerHeartbeatFlags({
      VITE_HSE_REASONER_HEARTBEAT_MIN_INTERVAL_MS: "200",
      VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS: "400",
    });
    expect(f.minIntervalMs).toBe(1000);
    expect(f.intervalMs).toBe(1000);
  });

  it("canonical VITE_HSE_REASONER_RESULT_TTL_MS WINS over legacy aliases", () => {
    const f = readHseReasonerHeartbeatFlags({
      VITE_HSE_REASONER_RESULT_TTL_MS: "6000",
      VITE_HSE_QWEN_RESULT_TTL_MS: "9999",
      VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS: "8888",
    });
    expect(f.resultTtlMs).toBe(6000);
  });

  it("falls back to legacy RESULT_TTL aliases when canonical missing", () => {
    expect(readHseReasonerHeartbeatFlags({ VITE_HSE_QWEN_RESULT_TTL_MS: "4000" }).resultTtlMs).toBe(
      4000,
    );
    expect(
      readHseReasonerHeartbeatFlags({ VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS: "3500" }).resultTtlMs,
    ).toBe(3500);
  });

  it("legacy-named re-export readHseQwenHeartbeatFlags is the same function", () => {
    expect(readHseQwenHeartbeatFlags).toBe(readHseReasonerHeartbeatFlags);
    const f = readHseQwenHeartbeatFlags({ VITE_HSE_QWEN_HEARTBEAT_MS: "1800" });
    expect(f.intervalMs).toBe(1800);
  });
});

describe("readHseFeatureFlags (candidate-lane canonical + legacy alias)", () => {
  it("defaults OFF when env empty", () => {
    const f = readHseFeatureFlags({});
    expect(f.reasonerCandidateLaneEnabled).toBe(false);
    expect(f.showReasonerCandidates).toBe(false);
    expect(f.localAlertsEnabled).toBe(false);
  });

  it("reads canonical VITE_HSE_REASONER_* candidate flags", () => {
    const f = readHseFeatureFlags({
      VITE_HSE_REASONER_CANDIDATE_LANE_ENABLED: "true",
      VITE_HSE_SHOW_REASONER_CANDIDATES: "true",
    });
    expect(f.reasonerCandidateLaneEnabled).toBe(true);
    expect(f.showReasonerCandidates).toBe(true);
  });

  it("legacy VITE_HSE_QWEN_* candidate flags still work when canonical absent", () => {
    const f = readHseFeatureFlags({
      VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED: "true",
      VITE_HSE_SHOW_QWEN_CANDIDATES: "true",
    });
    expect(f.reasonerCandidateLaneEnabled).toBe(true);
    expect(f.showReasonerCandidates).toBe(true);
  });

  it("canonical candidate flag WINS over legacy when both present", () => {
    const f = readHseFeatureFlags({
      VITE_HSE_REASONER_CANDIDATE_LANE_ENABLED: "false",
      VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED: "true",
    });
    expect(f.reasonerCandidateLaneEnabled).toBe(false);
  });
});
