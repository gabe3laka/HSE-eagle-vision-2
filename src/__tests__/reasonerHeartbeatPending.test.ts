// @vitest-environment happy-dom
/**
 * Focused tests for the reasoner heartbeat pending-gate. Mocks
 * `@/lib/detection/backendVisionHttpDetector` so `postDetectFrame` returns a
 * scripted queue of responses and `captureVideoFrameBase64` always succeeds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const postDetectFrame = vi.fn<(...a: unknown[]) => unknown>();
const captureVideoFrameBase64 = vi.fn<(...a: unknown[]) => unknown>(() => ({
  image_b64: "FAKE",
  cw: 320,
  ch: 320,
}));
const hasRiskAwareData = vi.fn<(...a: unknown[]) => boolean>(() => true);
const parseDetectRiskFields = vi.fn<(...a: unknown[]) => unknown>((raw: unknown) => ({
  sceneRisks: [],
  semanticCorrections: [],
  sceneContext: null,
  warnings: [] as string[],
  reasonerStatus: (raw as { reasoner_status?: string } | null)?.reasoner_status ?? null,
}));

vi.mock("@/lib/detection/backendVisionHttpDetector", () => ({
  postDetectFrame: (...args: unknown[]) => postDetectFrame(...args),
  captureVideoFrameBase64: (...args: unknown[]) => captureVideoFrameBase64(...args),
  hasRiskAwareData: (...args: unknown[]) => hasRiskAwareData(...args),
  parseDetectRiskFields: (...args: unknown[]) => parseDetectRiskFields(...args),
}));

import {
  REASONER_PENDING_HARD_MAX_MS,
  useReasonerHeartbeat,
  type ReasonerHeartbeatDiagnostic,
  type ReasonerHeartbeatResponse,
} from "@/features/hse-monitoring/hooks/useReasonerHeartbeat";

const makeVideoRef = () =>
  ({
    current: { videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement,
  }) as React.RefObject<HTMLVideoElement>;

function script(...responses: Array<unknown | Error>) {
  postDetectFrame.mockReset();
  for (const r of responses) {
    if (r instanceof Error) postDetectFrame.mockRejectedValueOnce(r);
    else postDetectFrame.mockResolvedValueOnce(r);
  }
}

interface Captured {
  diagnostics: ReasonerHeartbeatDiagnostic[];
  responses: ReasonerHeartbeatResponse[];
  completes: ReasonerHeartbeatResponse[];
}

function mount(opts: { intervalMs?: number; backoffMs?: number } = {}) {
  const captured: Captured = { diagnostics: [], responses: [], completes: [] };
  const videoRef = makeVideoRef();
  const hook = renderHook(() =>
    useReasonerHeartbeat({
      enabled: true,
      videoRef,
      profile: "balanced",
      roi: null,
      intervalMs: opts.intervalMs ?? 2000,
      backoffMs: opts.backoffMs ?? 10000,
      onResponse: (r) => captured.responses.push(r),
      onReasonerComplete: (r) => captured.completes.push(r),
      onDiagnostic: (d) => captured.diagnostics.push(d),
    }),
  );
  return { hook, captured };
}

async function flush() {
  // Let pending microtasks (the awaited postDetectFrame in tick) resolve.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function fireNextTick() {
  await vi.runOnlyPendingTimersAsync();
  await flush();
  // The just-fired tick scheduled another timer asynchronously after awaiting
  // postDetectFrame. Drain again so subsequent runOnlyPendingTimersAsync sees it.
  await flush();
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

describe("useReasonerHeartbeat — pending gate", () => {
  it("queued response gates next tick with skipped-reasoner-pending", async () => {
    script({ reasoner_status: "queued" });
    const { hook, captured } = mount();

    await fireNextTick(); // initial scheduled tick → HTTP → queued → arm gate
    expect(postDetectFrame).toHaveBeenCalledTimes(1);
    const first = captured.diagnostics.at(-1)!;
    expect(first.reasonerLifecycle).toBe("pending");
    expect(first.reasonerPending).toBe(true);

    await fireNextTick(); // gated tick → skipped-reasoner-pending, no HTTP
    expect(postDetectFrame).toHaveBeenCalledTimes(1);
    const gated = captured.diagnostics.at(-1)!;
    expect(gated.outcome).toBe("skipped-reasoner-pending");
    expect(gated.skippedPendingCount).toBeGreaterThanOrEqual(1);

    hook.unmount();
  });

  for (const s of ["queued_latest", "running"]) {
    it(`'${s}' response also pends`, async () => {
      script({ reasoner_status: s });
      const { hook, captured } = mount();
      await fireNextTick();
      expect(captured.diagnostics.at(-1)!.reasonerLifecycle).toBe("pending");
      await fireNextTick();
      expect(captured.diagnostics.at(-1)!.outcome).toBe("skipped-reasoner-pending");
      expect(postDetectFrame).toHaveBeenCalledTimes(1);
      hook.unmount();
    });
  }

  it("ready (after clearing pending via live-notify) fires onReasonerComplete", async () => {
    script({ reasoner_status: "queued" }, { reasoner_status: "ready" });
    const { hook, captured } = mount();

    await fireNextTick();
    expect(captured.diagnostics.at(-1)!.reasonerLifecycle).toBe("pending");

    // Live-notify clears pending and wakes the loop with setTimeout(tick, 0).
    hook.result.current.notifyReasonerTerminalFromLive("terminal-success");
    await fireNextTick();
    expect(postDetectFrame).toHaveBeenCalledTimes(2);
    expect(captured.completes.length).toBe(1);
    expect(captured.completes[0].lifecycle).toBe("terminal-success");

    hook.unmount();
  });

  it("cached clears pending", async () => {
    script({ reasoner_status: "cached" });
    const { hook, captured } = mount();
    await fireNextTick();
    const d = captured.diagnostics.at(-1)!;
    expect(d.reasonerLifecycle).toBe("terminal-success");
    expect(d.reasonerPending).toBe(false);
    expect(d.reasonerResultReceived).toBe(true);
    hook.unmount();
  });

  for (const s of ["timeout", "error", "json_parse_error"]) {
    it(`'${s}' clears pending and applies backoff; onReasonerComplete NOT fired`, async () => {
      script({ reasoner_status: s });
      const { hook, captured } = mount({ intervalMs: 2000, backoffMs: 10000 });
      await fireNextTick();
      const d = captured.diagnostics.at(-1)!;
      expect(d.reasonerLifecycle).toBe("terminal-failure");
      expect(d.reasonerPending).toBe(false);
      expect(d.nextDelayMs).toBe(10000);
      expect(captured.completes.length).toBe(0);
      hook.unmount();
    });
  }

  it("after REASONER_PENDING_HARD_MAX_MS the gate force-clears and emits pending-timeout-client", async () => {
    script({ reasoner_status: "queued" }, { reasoner_status: "ready" });
    const { hook, captured } = mount({ intervalMs: 2000 });

    await fireNextTick();
    expect(captured.diagnostics.at(-1)!.reasonerLifecycle).toBe("pending");

    // Jump past the hard-max so the next scheduled tick force-clears.
    await vi.advanceTimersByTimeAsync(REASONER_PENDING_HARD_MAX_MS + 5000);
    await flush();
    await flush();
    const outcomes = captured.diagnostics.map((d) => d.outcome);
    expect(outcomes).toContain("pending-timeout-client");
    expect(postDetectFrame.mock.calls.length).toBeGreaterThanOrEqual(2);

    hook.unmount();
  });

  it("notifyReasonerTerminalFromLive('terminal-success') clears pending mid-cycle", async () => {
    script({ reasoner_status: "queued" }, { reasoner_status: "ready" });
    const { hook, captured } = mount();
    await fireNextTick();
    expect(captured.diagnostics.at(-1)!.reasonerLifecycle).toBe("pending");
    hook.result.current.notifyReasonerTerminalFromLive("terminal-success");
    await fireNextTick();
    expect(postDetectFrame).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("unknown lifecycle clears pending but does NOT fire onReasonerComplete", async () => {
    script({ reasoner_status: "weird-state" });
    const { hook, captured } = mount();
    await fireNextTick();
    const d = captured.diagnostics.at(-1)!;
    expect(d.reasonerLifecycle).toBe("unknown");
    expect(d.reasonerPending).toBe(false);
    expect(d.reasonerResultReceived).toBe(false);
    expect(captured.completes.length).toBe(0);
    hook.unmount();
  });
});
