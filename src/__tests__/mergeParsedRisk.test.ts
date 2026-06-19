import { describe, it, expect } from "vitest";
import {
  mergeParsedRisk,
  isHeartbeatFresh,
  heartbeatIgnoreReason,
  heartbeatIgnoreMessage,
} from "@/features/hse-monitoring/lib/mergeParsedRisk";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";

function risk(over: Partial<Record<string, unknown>>): ParsedDetectRisk["sceneRisks"][number] {
  return { hazard: "blocked_path", risk_level: "YELLOW", ...over } as never;
}

const empty = (over: Partial<ParsedDetectRisk> = {}): ParsedDetectRisk => ({
  sceneRisks: [],
  degraded: false,
  warnings: [],
  ...over,
});

describe("isHeartbeatFresh", () => {
  it("true within TTL, false outside, false for null", () => {
    const now = 10_000;
    expect(isHeartbeatFresh(now - 1000, 3000, now)).toBe(true);
    expect(isHeartbeatFresh(now - 5000, 3000, now)).toBe(false);
    expect(isHeartbeatFresh(null, 3000, now)).toBe(false);
  });
});

describe("mergeParsedRisk", () => {
  it("returns live unchanged when heartbeat is null", () => {
    const live = empty({ sceneRisks: [risk({ risk_id: "a" })] });
    expect(mergeParsedRisk(live, null)).toBe(live);
  });

  it("appends heartbeat sceneRisks when fresh, deduped by risk_id", () => {
    const live = empty({ sceneRisks: [risk({ risk_id: "a" })] });
    const hb = empty({
      sceneRisks: [risk({ risk_id: "a" }), risk({ risk_id: "b" })],
    });
    const merged = mergeParsedRisk(live, hb, { applyHeartbeatRisks: true });
    expect(merged?.sceneRisks.map((r) => r.risk_id)).toEqual(["a", "b"]);
  });

  it("dedupes by hazard + sorted linked ids when ids are absent", () => {
    const live = empty({
      sceneRisks: [risk({ hazard: "blocked_path", involved_detection_ids: ["e2", "e1"] })],
    });
    const hb = empty({
      sceneRisks: [risk({ hazard: "blocked_path", involved_detection_ids: ["e1", "e2"] })],
    });
    const merged = mergeParsedRisk(live, hb, { applyHeartbeatRisks: true });
    expect(merged?.sceneRisks).toHaveLength(1);
  });

  it("does not append heartbeat risks when stale (applyHeartbeatRisks=false), but flows diagnostics", () => {
    const live = empty({ sceneRisks: [risk({ risk_id: "a" })] });
    const hb = empty({
      sceneRisks: [risk({ risk_id: "b" })],
      reasonerStatus: "ready",
      semanticCorrections: [{ explanation: "x" } as never],
      warnings: ["qwen_unavailable"],
});

describe("heartbeatIgnoreReason", () => {
  const base = {
    receivedAtMs: 10_000,
    ttlMs: 3000,
    nowMs: 11_000,
    heartbeatSessionId: "s1",
    liveSessionId: "s1",
    liveHasEntities: true,
  };

  it("returns null on the happy path", () => {
    expect(heartbeatIgnoreReason(base)).toBeNull();
  });

  it("returns 'stale' outside TTL", () => {
    expect(heartbeatIgnoreReason({ ...base, nowMs: 20_000 })).toBe("stale");
    expect(heartbeatIgnoreReason({ ...base, receivedAtMs: null })).toBe("stale");
  });

  it("returns 'session-mismatch' when both ids differ", () => {
    expect(heartbeatIgnoreReason({ ...base, liveSessionId: "other" })).toBe("session-mismatch");
  });

  it("ignores session id when either side is missing", () => {
    expect(heartbeatIgnoreReason({ ...base, liveSessionId: null })).toBeNull();
    expect(heartbeatIgnoreReason({ ...base, heartbeatSessionId: null })).toBeNull();
  });

  it("returns 'frame-mismatch' when live has no entities", () => {
    expect(heartbeatIgnoreReason({ ...base, liveHasEntities: false })).toBe("frame-mismatch");
  });

  it("stale takes precedence over session/frame mismatch", () => {
    expect(
      heartbeatIgnoreReason({
        ...base,
        nowMs: 20_000,
        liveSessionId: "other",
        liveHasEntities: false,
      }),
    ).toBe("stale");
  });
});

describe("heartbeatIgnoreMessage", () => {
  it("maps reasons to human-readable strings", () => {
    expect(heartbeatIgnoreMessage(null)).toBeNull();
    expect(heartbeatIgnoreMessage("stale")).toMatch(/stale/);
    expect(heartbeatIgnoreMessage("session-mismatch")).toMatch(/session\/frame mismatch/);
    expect(heartbeatIgnoreMessage("frame-mismatch")).toMatch(/session\/frame mismatch/);
  });
});
    const merged = mergeParsedRisk(live, hb, { applyHeartbeatRisks: false });
    expect(merged?.sceneRisks.map((r) => r.risk_id)).toEqual(["a"]);
    expect(merged?.reasonerStatus).toBe("ready");
    expect(merged?.semanticCorrections?.length).toBe(1);
    expect(merged?.warnings).toContain("qwen_unavailable");
  });
});
