/**
 * useReasonerHeartbeat — low-frequency, single-in-flight, visibility-aware
 * "scene reasoning heartbeat" for HSE Live mode.
 *
 * Keeps the worker's AI scene reasoner fresh without per-frame reasoner calls.
 * The heartbeat NEVER replaces the live detector loop — it only enriches
 * scene-reasoning diagnostics (sceneRisks, sceneContext, reasonerStatus,
 * semanticCorrections, temporalReasoning, warnings). The same `postDetectFrame`
 * / `buildHseDetectRequest` helpers (and signed-session flow) are reused; no
 * Cloudflare/RunPod paths change. The worker chooses which reasoner model it
 * runs (e.g. Gemini); the app stays model-agnostic.
 *
 * Backoff: on a reasoner failure status (unavailable / error / timeout /
 * disabled) the next tick is delayed by `backoffMs`. On recovery the normal
 * interval resumes.
 *
 * Pending gate: when the worker returns `queued / queued_latest / running /
 * loading / starting / pending / throttled`, the reasoner is still working on a
 * frame we already sent — sending another force-reason frame would REPLACE that
 * pending job on the worker. The hook records `reasonerPending=true` and skips
 * subsequent ticks (`outcome: "skipped-reasoner-pending"`) until either:
 *   - a terminal status arrives on the heartbeat response (ready/cached/...),
 *   - the live detector reports the same terminal status via
 *     `notifyReasonerTerminalFromLive` (the live `/detect` path also returns the
 *     cached reasoner result), or
 *   - the client-side `REASONER_PENDING_HARD_MAX_MS` safety timeout expires.
 *
 * Lifecycle: stops on unmount, when `enabled` flips false, when the document
 * is hidden, when monitoring stops, when the camera stops, or when the app
 * leaves HSE mode.
 *
 * Cloudflare session token (sent as `?token=` by `postDetectFrame`) authorizes
 * the gateway request. Worker `session_id` is SEPARATE: it carries
 * temporal/reasoner memory continuity. When the live detector exposes an active
 * session id, the heartbeat should adopt it via `sessionIdOverride` so both
 * loops share the SAME worker memory window.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  captureVideoFrameBase64,
  hasRiskAwareData,
  parseDetectRiskFields,
  postDetectFrame,
  type ParsedDetectRisk,
} from "@/lib/detection/backendVisionHttpDetector";
import { buildHseDetectRequest } from "@/lib/detection/hseDetectProfile";
import type { HSEDetectionProfile, HSEDetectRequest, HSERoi } from "@/lib/detection/hseTypes";

export interface ReasonerHeartbeatResponse {
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
  /** Lifecycle classification of THIS response. */
  lifecycle: ReasonerLifecycle;
}

export type ReasonerLifecycle = "pending" | "terminal-success" | "terminal-failure" | "unknown";

export interface ReasonerHeartbeatDiagnostic {
  receivedAtMs: number;
  rawReasonerStatus: string | null;
  normalizedReasonerStatus: string | null;
  warnings: string[];
  sceneRisks: number;
  outcome:
    | "ok"
    | "no-video"
    | "error"
    | "skipped-inflight"
    | "skipped-reasoner-pending"
    | "pending-timeout-client";
  error?: string;
  /** Heartbeat session id active when this diagnostic was emitted. */
  sessionId: string;
  /** Consecutive reasoner failures observed (resets to 0 on ok). */
  consecutiveFailures: number;
  /** Delay (ms) scheduled for the NEXT tick after this diagnostic. */
  nextDelayMs: number;
  /** Lifecycle classification of the last HTTP response (or unknown). */
  reasonerLifecycle: ReasonerLifecycle;
  /** True while we're waiting on a previously-submitted reasoner frame. */
  reasonerPending: boolean;
  /** Wall-clock ms at which reasonerPending was first set true (null when not pending). */
  pendingSinceMs: number | null;
  /** Frame id of the heartbeat frame the reasoner is still processing (when pending). */
  pendingFrameId: string | null;
  /** How many ticks have been skipped while reasonerPending was true. */
  skippedPendingCount: number;
  /** True when an HTTP response was received on this tick (incl. queued). */
  httpReceived: boolean;
  /** True ONLY when the response classified as terminal-success. */
  reasonerResultReceived: boolean;
}

export interface ReasonerHeartbeatHandle {
  /**
   * External signal — call when the live /detect response carries a terminal
   * reasoner result (or terminal failure). Clears the heartbeat's pending gate
   * so the next tick can fire on schedule instead of waiting for its own
   * terminal status. No-op for "pending" or "unknown".
   */
  notifyReasonerTerminalFromLive: (lifecycle: ReasonerLifecycle) => void;
}

export interface UseReasonerHeartbeatOptions {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  profile: HSEDetectionProfile;
  roi: HSERoi | null;
  /** Clamped ≥ `minIntervalMs` (hard floor 1000 ms). Default 2000. */
  intervalMs?: number;
  /** Hard floor used to clamp `intervalMs` (≥1000). Default 1000. */
  minIntervalMs?: number;
  /** Backoff after a reasoner failure. Default 10000. */
  backoffMs?: number;
  /** Extended backoff after `extendedBackoffAfter` consecutive failures. Default 30000. */
  extendedBackoffMs?: number;
  /** Threshold of consecutive failures before switching to `extendedBackoffMs`. Default 3. */
  extendedBackoffAfter?: number;
  /** Force reasoner reasoning on each tick. Default true. */
  forceReason?: boolean;
  /**
   * Worker `session_id` to use for heartbeat requests. When provided & non-empty
   * the heartbeat ADOPTS it (shared temporal/reasoner memory with the live
   * detector). When null/empty/whitespace, the hook mints a fallback
   * `hse-reasoner-hb-…` session id. Changes restart the heartbeat loop so the
   * new session id is applied immediately.
   */
  sessionIdOverride?: string | null;
  onResponse?: (r: ReasonerHeartbeatResponse) => void;
  /** Fires ONLY when a response classifies as terminal-success. */
  onReasonerComplete?: (r: ReasonerHeartbeatResponse) => void;
  onDiagnostic?: (d: ReasonerHeartbeatDiagnostic) => void;
  /** Fires once per effect-run with the current heartbeat session id. */
  onSessionStart?: (sessionId: string) => void;
}

/**
 * Worker reasoner statuses that mean "the reasoner is still working on a frame
 * we already sent". Sending another force-reason frame in this window REPLACES
 * the pending job on the worker.
 */
export const REASONER_PENDING_STATES = new Set([
  "queued",
  "queued_latest",
  "running",
  "throttled",
  "loading",
  "starting",
  "pending",
]);

/** Worker reasoner statuses that mean the reasoner produced a usable result. */
export const REASONER_TERMINAL_SUCCESS_STATES = new Set(["ready", "cached", "completed", "ok"]);

/** Worker reasoner statuses that mean the reasoner finished but produced no result. */
export const REASONER_TERMINAL_FAILURE_STATES = new Set([
  "timeout",
  "error",
  "unavailable",
  "disabled",
  "not_available",
  "missing",
  "schema_error",
  "json_parse_error",
  "not_run",
]);

const FAILURE_STATES = REASONER_TERMINAL_FAILURE_STATES;

/**
 * PURE: a heartbeat response carries a reasoner-unavailable warning when EITHER
 * the new generic `reasoner_unavailable` token OR the legacy `qwen_unavailable`
 * token is present. Workers may emit either while the rename rolls out.
 */
export function hasReasonerUnavailableWarning(warnings: string[]): boolean {
  return warnings.includes("reasoner_unavailable") || warnings.includes("qwen_unavailable");
}

/**
 * Client-side safety cap. If the reasoner never returns a terminal status within
 * this window, the heartbeat force-clears its pending gate and allows the next
 * tick so the loop never deadlocks on a wedged worker.
 */
export const REASONER_PENDING_HARD_MAX_MS = 45000;

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
 * PURE: classify a reasoner response as pending / terminal-success /
 * terminal-failure / unknown. Resolution order:
 *   1. Explicit failure warning (`reasoner_unavailable` / legacy
 *      `qwen_unavailable`) → terminal-failure
 *   2. Normalized then raw reasoner status against pending/success/failure sets
 *   3. If the response carries real sceneContext/sceneRisks/semanticCorrections
 *      but no status, treat as terminal-success (legacy worker shape)
 *   4. Otherwise unknown
 */
export function classifyReasonerLifecycle(args: {
  rawReasonerStatus: string | null;
  normalizedReasonerStatus: string | null;
  warnings: string[];
  hasSceneContext?: boolean;
  hasSemanticCorrections?: boolean;
  hasSceneRisks?: boolean;
}): ReasonerLifecycle {
  const { rawReasonerStatus, normalizedReasonerStatus, warnings } = args;
  if (hasReasonerUnavailableWarning(warnings)) return "terminal-failure";
  const candidates = [normalizedReasonerStatus, rawReasonerStatus]
    .map((s) => (typeof s === "string" ? s.toLowerCase().trim() : ""))
    .filter((s) => s.length > 0);
  for (const s of candidates) {
    if (REASONER_PENDING_STATES.has(s)) return "pending";
    if (REASONER_TERMINAL_SUCCESS_STATES.has(s)) return "terminal-success";
    if (REASONER_TERMINAL_FAILURE_STATES.has(s)) return "terminal-failure";
  }
  if (args.hasSceneContext || args.hasSemanticCorrections || args.hasSceneRisks) {
    return "terminal-success";
  }
  return "unknown";
}

/**
 * PURE: decide if a heartbeat response indicates a reasoner failure that should
 * trigger backoff. Exposed for unit tests.
 */
export function isReasonerFailureResponse(args: {
  warnings: string[];
  normalizedReasonerStatus: string | null;
  rawReasonerStatus: string | null;
}): boolean {
  const { warnings, normalizedReasonerStatus, rawReasonerStatus } = args;
  if (hasReasonerUnavailableWarning(warnings)) return true;
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
 * PURE: build the per-tick monitoring request used by the reasoner heartbeat.
 * Reuses `buildHseDetectRequest` with `requestReason: "hse-reasoner-heartbeat"`,
 * and (when `forceReason` is true) merges a per-call
 * `reasoningPreferencesOverride.force_reason = true` so the worker prefers
 * scene reasoning for this tick without mutating the live monitoring loop.
 */
export function buildHeartbeatMonitoringRequest(
  profile: HSEDetectionProfile,
  roi: HSERoi | null,
  forceReason: boolean,
): HSEDetectRequest {
  const base = buildHseDetectRequest(profile, roi, "hse-reasoner-heartbeat");
  if (!forceReason) return base;
  return {
    ...base,
    reasoningPreferencesOverride: {
      force_reason: true,
      prefer_low_latency: true,
      // Per app-repo prompt: hint the reasoner at desired cadence + freshness window.
      target_reasoning_interval_ms: 1500,
      max_candidate_age_ms: 1500,
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
 * back to the minted heartbeat session id (`hse-reasoner-hb-…`).
 */
export function pickEffectiveHeartbeatSessionId(
  override: string | null | undefined,
  fallback: string,
): string {
  return typeof override === "string" && override.trim().length > 0 ? override : fallback;
}

export function useReasonerHeartbeat({
  enabled,
  videoRef,
  profile,
  roi,
  intervalMs = 2000,
  minIntervalMs = 1000,
  backoffMs = 10000,
  extendedBackoffMs = 30000,
  extendedBackoffAfter = 3,
  forceReason = true,
  sessionIdOverride = null,
  onResponse,
  onReasonerComplete,
  onDiagnostic,
  onSessionStart,
}: UseReasonerHeartbeatOptions): ReasonerHeartbeatHandle {
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onReasonerCompleteRef = useRef(onReasonerComplete);
  onReasonerCompleteRef.current = onReasonerComplete;
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
  // Floor is max(1000, minIntervalMs); effective interval clamps to that floor.
  const minFloor = Math.max(1000, minIntervalMs);
  const intervalRef = useRef(Math.max(minFloor, intervalMs));
  intervalRef.current = Math.max(minFloor, intervalMs);
  const backoffRef = useRef(Math.max(intervalRef.current, backoffMs));
  backoffRef.current = Math.max(intervalRef.current, backoffMs);
  const extendedBackoffRef = useRef(Math.max(backoffRef.current, extendedBackoffMs));
  extendedBackoffRef.current = Math.max(backoffRef.current, extendedBackoffMs);
  const extendedBackoffAfterRef = useRef(Math.max(1, extendedBackoffAfter));
  extendedBackoffAfterRef.current = Math.max(1, extendedBackoffAfter);

  // Hook-level pending-gate refs (per-instance, not module-local — so HMR,
  // tests, and multiple consumers can't leak pending state into each other).
  const reasonerPendingRef = useRef(false);
  const pendingSinceMsRef = useRef(0);
  const pendingFrameIdRef = useRef<string | null>(null);
  const lastLifecycleRef = useRef<ReasonerLifecycle>("unknown");
  const skippedPendingCountRef = useRef(0);
  // Bumped each time the schedule should fire ASAP (e.g. after the live
  // detector clears pending mid-cycle).
  const wakeRef = useRef<() => void>(() => undefined);

  const notifyReasonerTerminalFromLive = useCallback((lifecycle: ReasonerLifecycle) => {
    // Only terminal signals clear pending. Pending or unknown are no-ops here
    // (unknown is handled per-response inside the heartbeat tick).
    if (lifecycle === "terminal-success" || lifecycle === "terminal-failure") {
      if (reasonerPendingRef.current) {
        reasonerPendingRef.current = false;
        pendingSinceMsRef.current = 0;
        pendingFrameIdRef.current = null;
        lastLifecycleRef.current = lifecycle;
        skippedPendingCountRef.current = 0;
        // Wake the loop so the next tick can run on schedule.
        try {
          wakeRef.current();
        } catch {
          /* noop */
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let currentDelay = intervalRef.current;
    let consecutiveFailures = 0;
    const fallbackSessionId = `hse-reasoner-hb-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    // Adopt the live detector's worker session_id when available so the
    // heartbeat and live loop share the SAME temporal/reasoner memory window.
    // Cloudflare's `?token=` (set in postDetectFrame) is unrelated.
    const sessionId = pickEffectiveHeartbeatSessionId(sessionIdOverride, fallbackSessionId);
    let frameCounter = 0;
    onSessionStartRef.current?.(sessionId);

    // Reset pending refs at the start of each effect run so a stale pending
    // state from a previous mount/session can't deadlock the new loop.
    reasonerPendingRef.current = false;
    pendingSinceMsRef.current = 0;
    pendingFrameIdRef.current = null;
    skippedPendingCountRef.current = 0;
    lastLifecycleRef.current = "unknown";

    const emit = (
      partial: Omit<
        ReasonerHeartbeatDiagnostic,
        "sessionId" | "consecutiveFailures" | "nextDelayMs"
      >,
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

    wakeRef.current = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, 0);
    };

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const tick = async () => {
      if (stopped) return;
      if (!isVisible()) {
        schedule(currentDelay);
        return;
      }
      // Reasoner pending-gate: do not send another force-reason frame while
      // the reasoner is still working. Safety timeout prevents permanent deadlock.
      if (reasonerPendingRef.current) {
        const now = Date.now();
        const pendingSince = pendingSinceMsRef.current;
        if (pendingSince > 0 && now - pendingSince >= REASONER_PENDING_HARD_MAX_MS) {
          // Force-clear and let this tick proceed.
          reasonerPendingRef.current = false;
          pendingSinceMsRef.current = 0;
          const stuckFrameId = pendingFrameIdRef.current;
          pendingFrameIdRef.current = null;
          const skipped = skippedPendingCountRef.current;
          skippedPendingCountRef.current = 0;
          emit(
            {
              receivedAtMs: now,
              rawReasonerStatus: null,
              normalizedReasonerStatus: null,
              warnings: [],
              sceneRisks: 0,
              outcome: "pending-timeout-client",
              reasonerLifecycle: "unknown",
              reasonerPending: false,
              pendingSinceMs: null,
              pendingFrameId: stuckFrameId,
              skippedPendingCount: skipped,
              httpReceived: false,
              reasonerResultReceived: false,
            },
            currentDelay,
          );
          // fall through to send the next heartbeat
        } else {
          skippedPendingCountRef.current += 1;
          emit(
            {
              receivedAtMs: now,
              rawReasonerStatus: null,
              normalizedReasonerStatus: null,
              warnings: [],
              sceneRisks: 0,
              outcome: "skipped-reasoner-pending",
              reasonerLifecycle: "pending",
              reasonerPending: true,
              pendingSinceMs: pendingSince || null,
              pendingFrameId: pendingFrameIdRef.current,
              skippedPendingCount: skippedPendingCountRef.current,
              httpReceived: false,
              reasonerResultReceived: false,
            },
            currentDelay,
          );
          schedule(currentDelay);
          return;
        }
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
            reasonerLifecycle: lastLifecycleRef.current,
            reasonerPending: reasonerPendingRef.current,
            pendingSinceMs: pendingSinceMsRef.current || null,
            pendingFrameId: pendingFrameIdRef.current,
            skippedPendingCount: skippedPendingCountRef.current,
            httpReceived: false,
            reasonerResultReceived: false,
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
            reasonerLifecycle: lastLifecycleRef.current,
            reasonerPending: reasonerPendingRef.current,
            pendingSinceMs: pendingSinceMsRef.current || null,
            pendingFrameId: pendingFrameIdRef.current,
            skippedPendingCount: skippedPendingCountRef.current,
            httpReceived: false,
            reasonerResultReceived: false,
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
              reasonerLifecycle: lastLifecycleRef.current,
              reasonerPending: reasonerPendingRef.current,
              pendingSinceMs: pendingSinceMsRef.current || null,
              pendingFrameId: pendingFrameIdRef.current,
              skippedPendingCount: skippedPendingCountRef.current,
              httpReceived: false,
              reasonerResultReceived: false,
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
        const lifecycle = classifyReasonerLifecycle({
          rawReasonerStatus: rawStatus,
          normalizedReasonerStatus: normalized,
          warnings: [...warnings],
          hasSceneContext: !!parsed?.sceneContext,
          hasSemanticCorrections: (parsed?.semanticCorrections?.length ?? 0) > 0,
          hasSceneRisks: sceneRisks > 0,
        });
        lastLifecycleRef.current = lifecycle;
        const response: ReasonerHeartbeatResponse = {
          parsed,
          raw,
          receivedAtMs,
          sessionId,
          frameId,
          forceReasonSent,
          lifecycle,
        };
        // onResponse fires for EVERY HTTP response (including queued/pending),
        // so callers can update diagnostics. onReasonerComplete fires ONLY on
        // terminal-success.
        onResponseRef.current?.(response);

        let reasonerResultReceived = false;
        if (lifecycle === "pending") {
          reasonerPendingRef.current = true;
          if (pendingSinceMsRef.current === 0) pendingSinceMsRef.current = receivedAtMs;
          pendingFrameIdRef.current = frameId;
          // While pending, hold cadence at the normal interval — the next tick
          // will be gated by the pending check, not by backoff.
          currentDelay = intervalRef.current;
          consecutiveFailures = 0;
        } else if (lifecycle === "terminal-success") {
          reasonerPendingRef.current = false;
          pendingSinceMsRef.current = 0;
          pendingFrameIdRef.current = null;
          skippedPendingCountRef.current = 0;
          consecutiveFailures = 0;
          reasonerResultReceived = true;
          currentDelay = intervalRef.current;
          onReasonerCompleteRef.current?.(response);
        } else if (lifecycle === "terminal-failure") {
          reasonerPendingRef.current = false;
          pendingSinceMsRef.current = 0;
          pendingFrameIdRef.current = null;
          skippedPendingCountRef.current = 0;
          consecutiveFailures += 1;
          currentDelay = pickHeartbeatDelay({
            failed: true,
            intervalMs: intervalRef.current,
            backoffMs: backoffRef.current,
            extendedBackoffMs: extendedBackoffRef.current,
            extendedBackoffAfter: extendedBackoffAfterRef.current,
            consecutiveFailures,
          });
        } else {
          // unknown — clear pending for safety so we don't deadlock on a stub
          // response, but do NOT report success and do NOT fire onReasonerComplete.
          reasonerPendingRef.current = false;
          pendingSinceMsRef.current = 0;
          pendingFrameIdRef.current = null;
          skippedPendingCountRef.current = 0;
          consecutiveFailures = 0;
          currentDelay = intervalRef.current;
        }

        emit(
          {
            receivedAtMs,
            rawReasonerStatus: rawStatus,
            normalizedReasonerStatus: normalized,
            warnings,
            sceneRisks,
            outcome: "ok",
            reasonerLifecycle: lifecycle,
            reasonerPending: reasonerPendingRef.current,
            pendingSinceMs: pendingSinceMsRef.current || null,
            pendingFrameId: pendingFrameIdRef.current,
            skippedPendingCount: skippedPendingCountRef.current,
            httpReceived: true,
            reasonerResultReceived,
          },
          currentDelay,
        );
      } catch (e) {
        // Network error: clear pending and apply backoff.
        reasonerPendingRef.current = false;
        pendingSinceMsRef.current = 0;
        pendingFrameIdRef.current = null;
        skippedPendingCountRef.current = 0;
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
            reasonerLifecycle: "terminal-failure",
            reasonerPending: false,
            pendingSinceMs: null,
            pendingFrameId: null,
            skippedPendingCount: 0,
            httpReceived: false,
            reasonerResultReceived: false,
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
      wakeRef.current = () => undefined;
    };
    // sessionIdOverride is intentionally in deps: when the live detector mints
    // (or rotates) its worker session_id, the heartbeat restarts so the new id
    // is adopted on the very next tick.
  }, [enabled, videoRef, sessionIdOverride]);

  return { notifyReasonerTerminalFromLive };
}
