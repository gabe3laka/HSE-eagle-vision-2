import { describe, it, expect } from "vitest";
import { readHseQwenHeartbeatFlags } from "@/lib/featureFlags";

describe("readHseQwenHeartbeatFlags (heartbeat env alias + clamp)", () => {
  it("uses prompt defaults when env is empty", () => {
    const f = readHseQwenHeartbeatFlags({});
    expect(f.enabled).toBe(true);
    expect(f.intervalMs).toBe(2000);
    expect(f.minIntervalMs).toBe(1000);
    // Canonical default TTL is 8000 per the system prompt.
    expect(f.resultTtlMs).toBe(8000);
    expect(f.forceReason).toBe(true);
  });

  it("prefers canonical VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS over legacy _MS", () => {
    const f = readHseQwenHeartbeatFlags({
      VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS: "1500",
      VITE_HSE_QWEN_HEARTBEAT_MS: "9999",
    });
    expect(f.intervalMs).toBe(1500);
  });

  it("falls back to legacy VITE_HSE_QWEN_HEARTBEAT_MS when canonical is absent", () => {
    const f = readHseQwenHeartbeatFlags({ VITE_HSE_QWEN_HEARTBEAT_MS: "1800" });
    expect(f.intervalMs).toBe(1800);
  });

  it("clamps intervalMs to MIN_INTERVAL_MS floor", () => {
    const f = readHseQwenHeartbeatFlags({
      VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS: "500",
      VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS: "1200",
    });
    // Configured min floor wins; hard floor 1000 also enforced.
    expect(f.minIntervalMs).toBe(1200);
    expect(f.intervalMs).toBe(1200);
  });

  it("hard floor of 1000 ms even when MIN_INTERVAL_MS is set lower", () => {
    const f = readHseQwenHeartbeatFlags({
      VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS: "200",
      VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS: "400",
    });
    expect(f.minIntervalMs).toBe(1000);
    expect(f.intervalMs).toBe(1000);
  });

  it("prefers canonical VITE_HSE_QWEN_RESULT_TTL_MS over legacy alias", () => {
    const f = readHseQwenHeartbeatFlags({
      VITE_HSE_QWEN_RESULT_TTL_MS: "6000",
      VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS: "9999",
    });
    expect(f.resultTtlMs).toBe(6000);
  });

  it("falls back to legacy RESULT_TTL alias when canonical missing", () => {
    const f = readHseQwenHeartbeatFlags({
      VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS: "4000",
    });
    expect(f.resultTtlMs).toBe(4000);
  });
});
