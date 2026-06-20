/**
 * useQwenHeartbeat — low-frequency, single-in-flight, visibility-aware
 * "scene reasoning heartbeat" for HSE Live mode.
 *
 * Keeps Qwen scene reasoning fresh without per-frame Qwen calls. The heartbeat
 * NEVER replaces the live detector loop — it only enriches scene-reasoning
 * diagnostics (sceneRisks, sceneContext, reasonerStatus, semanticCorrections,
 * temporalReasoning, warnings). The same `postDetectFrame` /
 * `buildHseDetectRequest` helpers (and signed-session flow) are reused; no
 * Cloudflare/RunPod paths change.
 *
 * Backoff: on a Qwen failure status (unavailable / error / timeout / disabled)
 * the next tick is delayed by `backoffMs`. On recovery the normal interval
 * resumes.
 *
 * Lifecycle: stops on unmount, when `enabled` flips false, when the document
 * is hidden, when monitoring stops, when the camera stops, or when the app
 * leaves HSE mode.
 *
 * Cloudflare session token (sent as `?token=` by `postDetectFrame`) authorizes
 * the gateway request. Worker `session_id` is SEPARATE: it carries
 * temporal/Qwen memory continuity. When the live detector exposes an active
 * session id, the heartbeat should adopt it via `sessionIdOverride` so both
 * loops share the SAME worker memory window.
 */

import { useEffect, useRef } from "react";
import {
  captureVideoFrameBase64,
  hasRiskAwareData,
  parseDetectRiskFields,
  postDetectFrame,
  type ParsedDetectRisk,
} from "@/lib/detection/backendVisionHttpDetector";
import { buildHseDetectRequest } from "@/lib/detection/hseDetectProfile";
import type { HSEDetectionProfile, HSEDetectRequest, HSERoi } from "@/lib/detection/hseTypes";

export interface QwenHeartbeatResponse {
  parsed: ParsedDetectRisk | null;
  raw: unknown;
  receivedAtMs: number;
  sessionId: string;
  frameId: string;
  /**
   * Exact value of `reasoning_preferences.force_reason` sent on THIS request.
   * Mirrors `forceReason` at call time — never derived from response shape.
   */
  forceReasonSent: boolean;
}

export interface QwenHeartbeatDiagnostic {
  receivedAtMs: number;
  rawReasonerStatus: string | null;
  normalizedReasonerStatus: string | null;
  warnings: string[];
  sceneRisks: number;
  outcome: "ok" | "no-video" | "error" | "skipped-inflight";
  error?: string;
  /** Heartbeat session id active when this diagnostic was emitted. */
  sessionId: string;
  /** Consecutive Qwen failures observed (resets to 0 on ok). */
  consecutiveFailures: number;
  /** Delay (ms) scheduled for the NEXT tick after this diagnostic. */
  nextDelayMs: number;
}

export interface UseQwenHeartbeatOptions {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  profile: HSEDetectionProfile;
  roi: HSERoi | null;
  /** Clamped ≥ `minIntervalMs` (hard floor 1000 ms). Default 2000. */
  intervalMs?: number;
  /** Hard floor used to clamp `intervalMs` (≥1000). Default 1000. */
  minIntervalMs?: number;
  /** Backoff after Qwen failure. Default 10000. */
  backoffMs?: number;
  /** Extended backoff after `extendedBackoffAfter` consecutive failures. Default 30000. */
  extendedBackoffMs?: number;
  /** Threshold of consecutive failures before switching to `extendedBackoffMs`. Default 3. */
  extendedBackoffAfter?: number;
  /** Force Qwen reasoning on each tick. Default true. */
  forceReason?: boolean;
  /**
   * Worker `session_id` to use for heartbeat requests. When provided & non-empty
   * the heartbeat ADOPTS it (shared temporal/Qwen memory with the live
   * detector). When null/empty/whitespace, the hook mints a fallback
   * `hse-qwen-hb-…` session id. Changes restart the heartbeat loop so the new
   * session id is applied immediately.
   */
  sessionIdOverride?: string | null;
  onResponse?: (r: QwenHeartbeatResponse) => void;
  onDiagnostic?: (d: QwenHeartbeatDiagnostic) => void;
  /** Fires once per effect-run with the current heartbeat session id. */
  onSessionStart?: (sessionId: string) => void;
}

const FAILURE_STATES = new Set([
  "unavailable",
  "not_available",
  "missing",
  "error",
  "schema_error",
  "timeout",
  "disabled",
  "not_run",
]);

function rawReasonerStatusToken(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const v = (resp as Record<string, unknown>).reasoner_status;
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const cand = o.state ?? o.status ?? o.mode;
    if (typeof cand === "string") return cand;
  }
  return null;
}

/**
 * PURE: decide if a heartbeat response indicates a Qwen failure that should
 * trigger backoff. Exposed for unit tests.
 */
export function isQwenFailureResponse(args: {
  warnings: string[];
  normalizedReasonerStatus: string | null;
  rawReasonerStatus: string | null;
}): boolean {
  const { warnings, normalizedReasonerStatus, rawReasonerStatus } = args;
  if (warnings.includes("qwen_unavailable")) return true;
  if (normalizedReasonerStatus && FAILURE_STATES.has(normalizedReasonerStatus.toLowerCase())) {
    return true;
  }
  if (rawReasonerStatus && FAILURE_STATES.has(rawReasonerStatus.toLowerCase())) {
    return true;
  }
  return false;
}

/** PURE: pick the next-tick delay given heartbeat config and observed failure run. */
export function pickHeartbeatDelay(args: {
  failed: boolean;
  intervalMs: number;
  backoffMs: number;
  consecutiveFailures?: number;
  extendedBackoffMs?: number;
  extendedBackoffAfter?: number;
}): number {
  const interval = Math.max(1000, args.intervalMs);
  const backoff = Math.max(interval, args.backoffMs);
  const extended = Math.max(backoff, args.extendedBackoffMs ?? backoff);
  const threshold = Math.max(1, args.extendedBackoffAfter ?? Number.POSITIVE_INFINITY);
  const failures = args.consecutiveFailures ?? 0;
  if (!args.failed) return interval;
  if (failures >= threshold) return extended;
  return backoff;
}

/**
 * PURE: build the per-tick monitoring request used by the Qwen heartbeat.
 * Reuses `buildHseDetectRequest` with `requestReason: "hse-qwen-heartbeat"`,
 * and (when `forceReason` is true) merges a per-call
 * `reasoningPreferencesOverride.force_reason = true` so the worker prefers
 * Qwen reasoning for this tick without mutating the live monitoring loop.
 */
export function buildHeartbeatMonitoringRequest(
  profile: HSEDetectionProfile,
  roi: HSERoi | null,
  forceReason: boolean,
): HSEDetectRequest {
  const base = buildHseDetectRequest(profile, roi, "hse-qwen-heartbeat");
  if (!forceReason) return base;
  return {
    ...base,
    reasoningPreferencesOverride: {
      force_reason: true,
      prefer_low_latency: true,
      require_visual_evidence: true,
      allow_no_active_risk: true,
      return_scene_risks: true,
      return_linked_entities: true,
      return_reasoner_status: true,
      return_scene_context: true,
      return_semantic_corrections: true,
      avoid_repeating_unconfirmed_risks: true,
      verify_current_frame_before_reusing_cached_risk: true,
    },
  };
}

/**
 * PURE: pick the effective worker session_id for the heartbeat. Adopts the
 * live-detector override when it's a non-empty/trimmed string; otherwise falls
 * back to the minted heartbeat session id (`hse-qwen-hb-…`).
 */
export function pickEffectiveHeartbeatSessionId(
  override: string | null | undefined,
  fallback: string,
): string {
  return typeof override === "string" && override.trim().length > 0 ? override : fallback;
}

export function useQwenHeartbeat({
  enabled,
  videoRef,
  profile,
  roi,
  intervalMs = 2000,
  backoffMs = 10000,
  extendedBackoffMs = 30000,
  extendedBackoffAfter = 3,
  forceReason = true,
  sessionIdOverride = null,
  onResponse,
  onDiagnostic,
  onSessionStart,
}: UseQwenHeartbeatOptions): void {
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onDiagnosticRef = useRef(onDiagnostic);
  onDiagnosticRef.current = onDiagnostic;
  const onSessionStartRef = useRef(onSessionStart);
  onSessionStartRef.current = onSessionStart;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const roiRef = useRef(roi);
  roiRef.current = roi;
  const forceReasonRef = useRef(forceReason);
  forceReasonRef.current = forceReason;
  const intervalRef = useRef(Math.max(1000, intervalMs));
  intervalRef.current = Math.max(1000, intervalMs);
  const backoffRef = useRef(Math.max(intervalRef.current, backoffMs));
  backoffRef.current = Math.max(intervalRef.current, backoffMs);
  const extendedBackoffRef = useRef(Math.max(backoffRef.current, extendedBackoffMs));
  extendedBackoffRef.current = Math.max(backoffRef.current, extendedBackoffMs);
  const extendedBackoffAfterRef = useRef(Math.max(1, extendedBackoffAfter));
  extendedBackoffAfterRef.current = Math.max(1, extendedBackoffAfter);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let currentDelay = intervalRef.current;
    let consecutiveFailures = 0;
    const fallbackSessionId = `hse-qwen-hb-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    // Adopt the live detector's worker session_id when available so the
    // heartbeat and live loop share the SAME temporal/Qwen memory window.
    // Cloudflare's `?token=` (set in postDetectFrame) is unrelated.
    const sessionId = pickEffectiveHeartbeatSessionId(sessionIdOverride, fallbackSessionId);
    let frameCounter = 0;
    onSessionStartRef.current?.(sessionId);

    const emit = (
      partial: Omit<QwenHeartbeatDiagnostic, "sessionId" | "consecutiveFailures" | "nextDelayMs">,
      nextDelayMs: number,
    ) => {
      onDiagnosticRef.current?.({
        ...partial,
        sessionId,
        consecutiveFailures,
        nextDelayMs,
      });
    };

    const schedule = (delay: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const tick = async () => {
      if (stopped) return;
      if (!isVisible()) {
        schedule(currentDelay);
        return;
      }
      if (inFlight) {
        emit(
          {
            receivedAtMs: Date.now(),
            rawReasonerStatus: null,
            normalizedReasonerStatus: null,
            warnings: [],
            sceneRisks: 0,
            outcome: "skipped-inflight",
          },
          currentDelay,
        );
        schedule(currentDelay);
        return;
      }
      const video = videoRef.current;
      if (!video || !video.videoWidth) {
        emit(
          {
            receivedAtMs: Date.now(),
            rawReasonerStatus: null,
            normalizedReasonerStatus: null,
            warnings: [],
            sceneRisks: 0,
            outcome: "no-video",
          },
          currentDelay,
        );
        schedule(currentDelay);
        return;
      }
      inFlight = true;
      try {
        const captured = captureVideoFrameBase64(video);
        if (!captured) {
          emit(
            {
              receivedAtMs: Date.now(),
              rawReasonerStatus: null,
              normalizedReasonerStatus: null,
              warnings: [],
              sceneRisks: 0,
              outcome: "no-video",
            },
            currentDelay,
          );
          return;
        }
        frameCounter += 1;
        // Keep frame ids heartbeat-specific even when the session id is shared
        // with the live detector, so the worker can tell heartbeat frames apart.
        const frameId = `${sessionId}-hb-${frameCounter}`;
        const forceReasonSent = forceReasonRef.current;
        const monitoringRequest = buildHeartbeatMonitoringRequest(
          profileRef.current,
          roiRef.current,
          forceReasonSent,
        );
        const raw = await postDetectFrame(captured.image_b64, {
          conf: 0.15,
          monitoringRequest,
          sessionId,
          frameId,
        });
        if (stopped) return;
        const parsed = hasRiskAwareData(raw) ? parseDetectRiskFields(raw) : null;
        const receivedAtMs = Date.now();
        const rawStatus = rawReasonerStatusToken(raw);
        const normalized = parsed?.reasonerStatus ?? null;
        const warnings = parsed?.warnings ?? [];
        const sceneRisks = parsed?.sceneRisks.length ?? 0;
        onResponseRef.current?.({
          parsed,
          raw,
          receivedAtMs,
          sessionId,
          frameId,
          forceReasonSent,
        });
        const failed = isQwenFailureResponse({
          warnings: [...warnings],
          normalizedReasonerStatus: normalized,
          rawReasonerStatus: rawStatus,
        });
        consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
        currentDelay = pickHeartbeatDelay({
          failed,
          intervalMs: intervalRef.current,
          backoffMs: backoffRef.current,
          extendedBackoffMs: extendedBackoffRef.current,
          extendedBackoffAfter: extendedBackoffAfterRef.current,
          consecutiveFailures,
        });
        emit(
          {
            receivedAtMs,
            rawReasonerStatus: rawStatus,
            normalizedReasonerStatus: normalized,
            warnings,
            sceneRisks,
            outcome: "ok",
          },
          currentDelay,
        );
      } catch (e) {
        consecutiveFailures += 1;
        currentDelay = pickHeartbeatDelay({
          failed: true,
          intervalMs: intervalRef.current,
          backoffMs: backoffRef.current,
          extendedBackoffMs: extendedBackoffRef.current,
          extendedBackoffAfter: extendedBackoffAfterRef.current,
          consecutiveFailures,
        });
        emit(
          {
            receivedAtMs: Date.now(),
            rawReasonerStatus: null,
            normalizedReasonerStatus: null,
            warnings: [],
            sceneRisks: 0,
            outcome: "error",
            error: e instanceof Error ? e.message : String(e),
          },
          currentDelay,
        );
      } finally {
        inFlight = false;
        schedule(currentDelay);
      }
    };

    const onVisibility = () => {
      if (stopped) return;
      if (isVisible() && !timer) schedule(0);
    };
    document.addEventListener("visibilitychange", onVisibility);

    schedule(currentDelay);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // sessionIdOverride is intentionally in deps: when the live detector mints
    // (or rotates) its worker session_id, the heartbeat restarts so the new id
    // is adopted on the very next tick.
  }, [enabled, videoRef, sessionIdOverride]);
}
