import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/detection/backendVisionHttpDetector", async () => {
  const actual: any = await vi.importActual("@/lib/detection/backendVisionHttpDetector");
  return {
    ...actual,
    captureVideoFrameBase64: () => ({ image_b64: "AAA", cw: 320, ch: 240 }),
    postDetectFrame: vi.fn(),
  };
});

import { renderHook } from "@testing-library/react";
import { useQwenHeartbeat } from "@/features/hse-monitoring/hooks/useQwenHeartbeat";
import * as detector from "@/lib/detection/backendVisionHttpDetector";

const mockedPost = detector.postDetectFrame as unknown as ReturnType<typeof vi.fn>;

function makeVideoRef() {
  return {
    current: { videoWidth: 320, videoHeight: 240 } as HTMLVideoElement,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedPost.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useQwenHeartbeat", () => {
  it("ticks at intervalMs and skips a second tick while in flight", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    mockedPost.mockImplementationOnce(
      () => new Promise((res) => (resolveFirst = res)),
    );
    mockedPost.mockResolvedValue({ entities: [], reasoner_status: "ready" });
    const onResponse = vi.fn();
    renderHook(() =>
      useQwenHeartbeat({
        enabled: true,
        videoRef: makeVideoRef(),
        profile: "balanced",
        roi: null,
        intervalMs: 1000,
        backoffMs: 5000,
        onResponse,
      }),
    );
    // first tick fires at currentDelay (1000 ms)
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // second tick should be skipped while first is still in flight
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // resolve, allow follow-up tick
    resolveFirst({ entities: [], reasoner_status: "ready" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it("sends reasoningPreferencesOverride.force_reason=true and requestReason hse-qwen-heartbeat", async () => {
    mockedPost.mockResolvedValue({ entities: [] });
    renderHook(() =>
      useQwenHeartbeat({
        enabled: true,
        videoRef: makeVideoRef(),
        profile: "balanced",
        roi: null,
        intervalMs: 1000,
        forceReason: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const callArgs = mockedPost.mock.calls[0][1];
    expect(callArgs.monitoringRequest.requestReason).toBe("hse-qwen-heartbeat");
    expect(callArgs.monitoringRequest.reasoningPreferencesOverride.force_reason).toBe(true);
  });

  it("does not run when disabled", async () => {
    mockedPost.mockResolvedValue({ entities: [] });
    renderHook(() =>
      useQwenHeartbeat({
        enabled: false,
        videoRef: makeVideoRef(),
        profile: "balanced",
        roi: null,
        intervalMs: 1000,
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedPost).toHaveBeenCalledTimes(0);
  });

  it("backs off to backoffMs when reasoner_status indicates unavailable", async () => {
    mockedPost.mockResolvedValueOnce({ reasoner_status: "unavailable" });
    mockedPost.mockResolvedValue({ reasoner_status: "ready" });
    renderHook(() =>
      useQwenHeartbeat({
        enabled: true,
        videoRef: makeVideoRef(),
        profile: "balanced",
        roi: null,
        intervalMs: 1000,
        backoffMs: 5000,
      }),
    );
    await vi.advanceTimersByTimeAsync(1000); // first tick
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // Next tick should NOT fire at 1000 ms (we're in backoff window)
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // After backoff window elapses
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });
});
