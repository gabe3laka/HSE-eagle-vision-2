import { describe, it, expect } from "vitest";
import {
  hasUsableReasonerRisk,
  shouldUpdateLatch,
  isLatchFresh,
  computeParsedRiskForVm,
  shouldClearLatch,
} from "@/features/hse-monitoring/lib/reasonerResultLatch";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";

function risk(over: Partial<Record<string, unknown>>): ParsedDetectRisk["sceneRisks"][number] {
  return { hazard: "blocked_path", risk_level: "YELLOW", ...over } as never;
}

const make = (over: Partial<ParsedDetectRisk> = {}): ParsedDetectRisk => ({
  sceneRisks: [],
  degraded: false,
  warnings: [],
  ...over,
});

describe("hasUsableReasonerRisk", () => {
  it("false for null / empty-ready result", () => {
    expect(hasUsableReasonerRisk(null)).toBe(false);
    expect(hasUsableReasonerRisk(make())).toBe(false);
  });
  it("true when scene risks or risk-affecting semantic corrections present", () => {
    expect(hasUsableReasonerRisk(make({ sceneRisks: [risk({ risk_id: "a" })] }))).toBe(true);
    expect(hasUsableReasonerRisk(make({ semanticCorrections: [{ explanation: "x" }] }))).toBe(true);
  });
  it("false for a sceneContext-only `ready` result (diagnostic, not colorable)", () => {
    // A scene summary alone is NOT a colorable risk, so it must not be able to
    // overwrite a previously-latched linkable YELLOW risk.
    expect(hasUsableReasonerRisk(make({ sceneContext: { summary: "yard" } }))).toBe(false);
  });
});

describe("shouldUpdateLatch", () => {
  const usable = make({ sceneRisks: [risk({ risk_id: "a" })] });
  it("updates only on terminal-success with usable content", () => {
    expect(shouldUpdateLatch("terminal-success", usable)).toBe(true);
  });
  it("does not update on queued/running (pending)", () => {
    expect(shouldUpdateLatch("pending", usable)).toBe(false);
    expect(shouldUpdateLatch("unknown", usable)).toBe(false);
    expect(shouldUpdateLatch("terminal-failure", usable)).toBe(false);
  });
  it("does not update on terminal-success with an empty-ready result", () => {
    expect(shouldUpdateLatch("terminal-success", make())).toBe(false);
  });
  it("does not update on a sceneContext-only ready result (no colorable risk)", () => {
    expect(shouldUpdateLatch("terminal-success", make({ sceneContext: { summary: "yard" } }))).toBe(
      false,
    );
  });
});

describe("isLatchFresh", () => {
  const base = { ttlMs: 12000, latchSessionId: "s1", liveSessionId: "s1" };
  it("true within TTL with matching session", () => {
    expect(isLatchFresh({ ...base, atMs: 100_000, nowMs: 105_000 })).toBe(true);
  });
  it("false once past TTL", () => {
    expect(isLatchFresh({ ...base, atMs: 100_000, nowMs: 120_000 })).toBe(false);
  });
  it("false for null timestamp", () => {
    expect(isLatchFresh({ ...base, atMs: null, nowMs: 105_000 })).toBe(false);
  });
  it("false on session mismatch", () => {
    expect(
      isLatchFresh({
        ttlMs: 12000,
        atMs: 100_000,
        nowMs: 101_000,
        latchSessionId: "s1",
        liveSessionId: "s2",
      }),
    ).toBe(false);
  });
  it("treats a null session id on either side as matching", () => {
    expect(
      isLatchFresh({
        ttlMs: 12000,
        atMs: 100_000,
        nowMs: 101_000,
        latchSessionId: null,
        liveSessionId: "s2",
      }),
    ).toBe(true);
  });
});

describe("computeParsedRiskForVm", () => {
  it("merges the latch while fresh", () => {
    const live = make({ sceneRisks: [] });
    const latch = make({ sceneRisks: [risk({ risk_id: "latched" })] });
    const out = computeParsedRiskForVm({
      live,
      heartbeat: null,
      applyHeartbeat: false,
      latch,
      latchFresh: true,
    });
    expect(out?.sceneRisks.map((r) => (r as { risk_id?: string }).risk_id)).toContain("latched");
  });

  it("ignores the latch when stale", () => {
    const live = make({ sceneRisks: [] });
    const latch = make({ sceneRisks: [risk({ risk_id: "latched" })] });
    const out = computeParsedRiskForVm({
      live,
      heartbeat: null,
      applyHeartbeat: false,
      latch,
      latchFresh: false,
    });
    expect(out?.sceneRisks.length).toBe(0);
  });

  it("keeps the latch coloring across an empty-ready live frame (continuity)", () => {
    // Live frame is empty-ready (worker said ready, no risks) but the fresh
    // latch should still carry the previous good risk into the view model.
    const emptyReadyLive = make({ sceneRisks: [], reasonerStatus: "ready" });
    const latch = make({ sceneRisks: [risk({ risk_id: "carry" })] });
    const out = computeParsedRiskForVm({
      live: emptyReadyLive,
      heartbeat: null,
      applyHeartbeat: false,
      latch,
      latchFresh: true,
    });
    expect(out?.sceneRisks.map((r) => (r as { risk_id?: string }).risk_id)).toContain("carry");
  });

  it("does not double-count a risk present in both heartbeat and latch", () => {
    const live = make({ sceneRisks: [] });
    const shared = make({ sceneRisks: [risk({ risk_id: "dup" })] });
    const out = computeParsedRiskForVm({
      live,
      heartbeat: shared,
      applyHeartbeat: true,
      latch: shared,
      latchFresh: true,
    });
    expect(out?.sceneRisks.length).toBe(1);
  });

  it("returns live unchanged when no heartbeat and no fresh latch", () => {
    const live = make({ sceneRisks: [risk({ risk_id: "a" })] });
    const out = computeParsedRiskForVm({
      live,
      heartbeat: null,
      applyHeartbeat: false,
      latch: null,
      latchFresh: false,
    });
    expect(out).toBe(live);
  });
});

describe("shouldClearLatch", () => {
  it("clears when monitoring stops", () => {
    expect(shouldClearLatch("s1", "s1", false)).toBe(true);
  });
  it("clears on session change", () => {
    expect(shouldClearLatch("s1", "s2", true)).toBe(true);
  });
  it("keeps the latch on a stable active session", () => {
    expect(shouldClearLatch("s1", "s1", true)).toBe(false);
  });
});
