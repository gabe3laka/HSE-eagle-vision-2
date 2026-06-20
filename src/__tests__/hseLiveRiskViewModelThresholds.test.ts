import { describe, it, expect } from "vitest";
import {
  MIN_VISIBLE_RISK_MS,
  YELLOW_HARD_MAX_MS,
  RED_STALE_MAX_MS,
} from "@/features/hse-monitoring/hooks/useHseLiveRiskViewModel";

// Locks in the stale-cap constants the system prompt requires for HSE box
// stickiness: 1000 ms minimum visible, 2500 ms yellow stale, 5000 ms red/orange.
describe("useHseLiveRiskViewModel stickiness thresholds", () => {
  it("MIN_VISIBLE_RISK_MS = 1000", () => {
    expect(MIN_VISIBLE_RISK_MS).toBe(1000);
  });
  it("YELLOW_HARD_MAX_MS = 2500", () => {
    expect(YELLOW_HARD_MAX_MS).toBe(2500);
  });
  it("RED_STALE_MAX_MS = 5000", () => {
    expect(RED_STALE_MAX_MS).toBe(5000);
  });
});
