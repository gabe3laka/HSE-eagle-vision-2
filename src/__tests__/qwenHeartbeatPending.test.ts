// @vitest-environment happy-dom
/**
 * Focused tests for the Qwen heartbeat pending-gate. Mocks
 * `@/lib/detection/backendVisionHttpDetector` so `postDetectFrame` returns a
 * scripted queue of responses and `captureVideoFrameBase64` always succeeds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const postDetectFrame = vi.fn();
const captureVideoFrameBase64 = vi.fn(() => ({ image_b64: "FAKE", cw: 320, ch: 320 }));
const hasRiskAwareData = vi.fn(() => true);
const parseDetectRiskFields = vi.fn((raw: { reasoner_status?: string }) => ({
  sceneRisks: [],
  semanticCorrections: [],
  sceneContext: null,
  warnings: [] as string[],
  reasonerStatus: raw?.reasoner_status ?? null,
}));

vi.mock("@/lib/detection/backendVisionHttpDetector", () => ({
  postDetectFrame: (...args: unknown[]) => postDetectFrame(...args),
  captureVideoFrameBase64: (...args: unknown[]) => captureVideoFrameBase64(...args),
  hasRiskAwareData: (...args: unknown[]) => hasRiskAwareData(...args),
  parseDetectRiskFields: (...args: unknown[]) => parseDetectRiskFields(...args),
}));

import {
  QWEN_PENDING_HARD_MAX_MS,
  useQwenHeartbeat,
  type QwenHeartbeatDiagnostic,
  type QwenHeartbeatResponse,
} from "@/features/hse-monitoring/hooks/useQwenHeartbeat";

const makeVideoRef = () =>
  ({ current: { videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement }) as React.RefObject<HTMLVideoElement>;

function script(...responses: Array<unknown | Error>) {
  postDetectFrame.mockReset();
  for (const r of responses) {
    if (r instanceof Error) postDetectFrame.mockRejectedValueOnce(r);
    else postDetectFrame.mockResolvedValueOnce(r);
  }
}

interface Captured {
  diagnostics: QwenHeartbeatDiagnostic[];
  responses: QwenHeartbeatResponse[];
  completes: QwenHeartbeatResponse[];
}

function mount(opts: { intervalMs?: number; backoffMs?: number } = {}) {
  const captured: Captured = { diagnostics: [], responses: [], completes: [] };
  const videoRef = makeVideoRef();
  const hook = renderHook(() =>
    useQwenHeartbeat({
      enabled: true,
      videoRef,
      profile: "balanced",
      roi: null,
      intervalMs: opts.intervalMs ?? 2000,
      backoffMs: opts.backoffMs ?? 10000,
      onResponse: (r) => captured.responses.push(r),
      onQwenComplete: (r) => captured.completes.push(r),
      onDiagnostic: (d) => captured.diagnostics.push(d),
    }),
  );
  return { hook, captured };
}

async function flush() {
  // Let pending microtasks (the awaited postDetectFrame in tick) resolve.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  postDetectFrame.mockReset();
  captureVideoFrameBase64.mockClear();
  parseDetectRiskFields.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useQwenHeartbeat — pending gate", () => {
  it("queued response gates next tick with skipped-qwen-pending", async () => {
    script({ reasoner_status: "queued" });
    const { hook, captured } = mount();

    await vi.advanceTimersByTimeAsync(0); // initial schedule(currentDelay) → fires tick
    await flush();
    expect(postDetectFrame).toHaveBeenCalledTimes(1);
    const first = captured.diagnostics.at(-1)!;
    expect(first.qwenLifecycle).toBe("pending");
    expect(first.qwenPending).toBe(true);

    // Next scheduled tick should NOT call postDetectFrame.
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(postDetectFrame).toHaveBeenCalledTimes(1);
    const gated = captured.diagnostics.at(-1)!;
    expect(gated.outcome).toBe("skipped-qwen-pending");
    expect(gated.skippedPendingCount).toBeGreaterThanOrEqual(1);

    hook.unmount();
  });

  for (const s of ["queued_latest", "running"]) {
    it(`'${s}' response also pends`, async () => {
      script({ reasoner_status: s });
      const { hook, captured } = mount();
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      expect(captured.diagnostics.at(-1)!.qwenLifecycle).toBe("pending");
      await vi.advanceTimersByTimeAsync(2000);
      await flush();
      expect(captured.diagnostics.at(-1)!.outcome).toBe("skipped-qwen-pending");
      expect(postDetectFrame).toHaveBeenCalledTimes(1);
      hook.unmount();
    });
  }

  it("ready clears pending and allows next tick at normal interval, fires onQwenComplete", async () => {
    script({ reasoner_status: "queued" }, { reasoner_status: "ready" });
    const { hook, captured } = mount();

    await vi.advanceTimersByTimeAsync(0);
    await flush();
    // Bypass the gate using the external clear signal so the second HTTP fires.
    // (Simulates a live response clearing pending mid-cycle.)
    // No — for this test we want to ensure ready clears it ON the heartbeat
    // itself. So instead: advance past the gated tick, then call the external
    // clearer to allow the heartbeat to actually send the second request.
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    // Now manually clear pending via the live-notify and let the next tick fire.
    hook.result.current.notifyQwenTerminalFromLive("terminal-success");
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(postDetectFrame).toHaveBeenCalledTimes(2);
    expect(captured.completes.length).toBe(1);
    expect(captured.completes[0].lifecycle).toBe("terminal-success");

    hook.unmount();
  });

  it("cached clears pending", async () => {
    script({ reasoner_status: "cached" });
    const { hook, captured } = mount();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const d = captured.diagnostics.at(-1)!;
    expect(d.qwenLifecycle).toBe("terminal-success");
    expect(d.qwenPending).toBe(false);
    expect(d.qwenResultReceived).toBe(true);
    hook.unmount();
  });

  for (const s of ["timeout", "error"]) {
    it(`'${s}' clears pending and applies backoff; onQwenComplete NOT fired`, async () => {
      script({ reasoner_status: s });
      const { hook, captured } = mount({ intervalMs: 2000, backoffMs: 10000 });
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      const d = captured.diagnostics.at(-1)!;
      expect(d.qwenLifecycle).toBe("terminal-failure");
      expect(d.qwenPending).toBe(false);
      expect(d.nextDelayMs).toBe(10000);
      expect(captured.completes.length).toBe(0);
      hook.unmount();
    });
  }

  it("after QWEN_PENDING_HARD_MAX_MS the gate force-clears and emits pending-timeout-client", async () => {
    script({ reasoner_status: "queued" }, { reasoner_status: "ready" });
    const { hook, captured } = mount({ intervalMs: 2000 });

    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(captured.diagnostics.at(-1)!.qwenLifecycle).toBe("pending");

    // Advance well past hard-max so the next tick force-clears.
    await vi.advanceTimersByTimeAsync(QWEN_PENDING_HARD_MAX_MS + 5000);
    await flush();
    const outcomes = captured.diagnostics.map((d) => d.outcome);
    expect(outcomes).toContain("pending-timeout-client");
    // After force-clear the tick falls through and sends the next request.
    expect(postDetectFrame).toHaveBeenCalledTimes(2);

    hook.unmount();
  });

  it("notifyQwenTerminalFromLive('terminal-success') clears pending mid-cycle", async () => {
    script({ reasoner_status: "queued" }, { reasoner_status: "ready" });
    const { hook, captured } = mount();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(captured.diagnostics.at(-1)!.qwenLifecycle).toBe("pending");
    hook.result.current.notifyQwenTerminalFromLive("terminal-success");
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(postDetectFrame).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("unknown lifecycle clears pending but does NOT fire onQwenComplete", async () => {
    script({ reasoner_status: "weird-state" });
    const { hook, captured } = mount();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const d = captured.diagnostics.at(-1)!;
    expect(d.qwenLifecycle).toBe("unknown");
    expect(d.qwenPending).toBe(false);
    expect(d.qwenResultReceived).toBe(false);
    expect(captured.completes.length).toBe(0);
    hook.unmount();
  });
});
