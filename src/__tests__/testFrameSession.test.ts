import { describe, expect, it } from "vitest";
import {
  applyTestFrameResponse,
  createInitialTestFrameSessionState,
  ensureTestFrameSession,
  planTestFrameRequest,
  resetTestFrameSession,
} from "@/features/hse-monitoring/lib/testFrameSession";
import { QWEN_PENDING_HARD_MAX_MS } from "@/features/hse-monitoring/hooks/useQwenHeartbeat";

const mint = (n: number) => `hse-test-mocked-${n}`;

describe("testFrameSession", () => {
  it("ensureTestFrameSession mints once and reuses the id", () => {
    let s = createInitialTestFrameSessionState();
    const first = ensureTestFrameSession(s, 1000, mint);
    expect(first.sessionId).toBe("hse-test-mocked-1000");
    s = first.state;
    const second = ensureTestFrameSession(s, 2000, mint);
    expect(second.sessionId).toBe("hse-test-mocked-1000");
    expect(second.state).toBe(s); // unchanged reference when id already exists
  });

  it("planTestFrameRequest reuses session id and increments frame counter", () => {
    let s = createInitialTestFrameSessionState();
    const p1 = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p1.sessionId).toBe("hse-test-mocked-1000");
    expect(p1.frameId).toBe("hse-test-mocked-1000-1");
    expect(p1.polling).toBe(false);
    expect(p1.forceReasonOverride).toBe(true);
    s = p1.state;
    const p2 = planTestFrameRequest(s, 1100, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p2.sessionId).toBe("hse-test-mocked-1000");
    expect(p2.frameId).toBe("hse-test-mocked-1000-2");
  });

  it("after a pending response, the next plan is a poll (no force_reason)", () => {
    let s = createInitialTestFrameSessionState();
    s = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint).state;
    s = applyTestFrameResponse(s, "pending", 1050);
    expect(s.pending).toBe(true);
    expect(s.pendingSinceMs).toBe(1050);
    const p2 = planTestFrameRequest(s, 1500, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p2.polling).toBe(true);
    expect(p2.forceReasonOverride).toBe(false);
    expect(p2.state.skippedCount).toBe(1);
    expect(p2.sessionId).toBe("hse-test-mocked-1000");
  });

  it("a terminal-success clears pending so the next plan may force again", () => {
    let s = createInitialTestFrameSessionState();
    s = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint).state;
    s = applyTestFrameResponse(s, "pending", 1050);
    s = planTestFrameRequest(s, 1100, QWEN_PENDING_HARD_MAX_MS, mint).state;
    expect(s.skippedCount).toBe(1);
    s = applyTestFrameResponse(s, "terminal-success", 1200);
    expect(s.pending).toBe(false);
    expect(s.pendingSinceMs).toBe(0);
    expect(s.skippedCount).toBe(0);
    const p3 = planTestFrameRequest(s, 1300, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p3.polling).toBe(false);
    expect(p3.forceReasonOverride).toBe(true);
  });

  it("terminal-failure also clears pending", () => {
    let s = createInitialTestFrameSessionState();
    s = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint).state;
    s = applyTestFrameResponse(s, "pending", 1050);
    s = applyTestFrameResponse(s, "terminal-failure", 1500);
    expect(s.pending).toBe(false);
    const p = planTestFrameRequest(s, 1600, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p.forceReasonOverride).toBe(true);
  });

  it("unknown lifecycle leaves pending unchanged", () => {
    let s = createInitialTestFrameSessionState();
    s = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint).state;
    s = applyTestFrameResponse(s, "pending", 1050);
    const before = s;
    s = applyTestFrameResponse(s, "unknown", 1100);
    expect(s).toEqual(before);
  });

  it("resetTestFrameSession mints a new id on the next plan", () => {
    let s = createInitialTestFrameSessionState();
    s = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint).state;
    s = resetTestFrameSession();
    expect(s.sessionId).toBeNull();
    const p = planTestFrameRequest(s, 5000, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p.sessionId).toBe("hse-test-mocked-5000");
    expect(p.frameId).toBe("hse-test-mocked-5000-1");
  });

  it("hard-max pending clears stuck-pending and allows force on the next click", () => {
    let s = createInitialTestFrameSessionState();
    s = planTestFrameRequest(s, 1000, QWEN_PENDING_HARD_MAX_MS, mint).state;
    s = applyTestFrameResponse(s, "pending", 1000);
    const stuckUntil = 1000 + QWEN_PENDING_HARD_MAX_MS;
    const p = planTestFrameRequest(s, stuckUntil + 1, QWEN_PENDING_HARD_MAX_MS, mint);
    expect(p.clearedStuckPending).toBe(true);
    expect(p.polling).toBe(false);
    expect(p.forceReasonOverride).toBe(true);
    expect(p.state.pending).toBe(false);
  });
});
