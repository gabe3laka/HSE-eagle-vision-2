/**
 * useQwenHeartbeat — low-frequency, single-in-flight, visibility-aware
 * "scene reasoning heartbeat" for HSE Live mode.
 *
 * Purpose: keep Qwen scene reasoning fresh without per-frame Qwen calls. The
 * heartbeat NEVER replaces the live detector loop — it only enriches scene
 * reasoning diagnostics (sceneRisks, sceneContext, reasonerStatus, semantic
 * corrections, temporalReasoning, warnings). Cloudflare/RunPod paths and
 * signed-session flow are unchanged: the heartbeat reuses the same
 * `postDetectFrame` and `buildHseDetectRequest` helpers as the rest of the app.
 *
 * Backoff: on a Qwen failure status (unavailable / error / timeout / disabled)
 * the next tick is delayed by `backoffMs`. On any recovery state the normal
 * `intervalMs` is restored.
 *
 * Lifecycle: stops on unmount, when `enabled` flips false, when monitoring
 * stops, when the camera stops, when the document is hidden, or when the app
 * leaves HSE mode.
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
import type { HSEDetectionProfile, HSERoi } from "@/lib/detection/hseTypes";

export interface QwenHeartbeatResponse {
  parsed: ParsedDetectRisk | null;
  raw: unknown;
  receivedAtMs: number;
  sessionId: string;
  frameId: string;
}

export interface QwenHeartbeatDiagnostic {
  receivedAtMs: number;
  rawReasonerStatus: string | null;
  normalizedReasonerStatus: string | null;
  warnings: string[];
  sceneRisks: number;
  /** "ok" | "no-video" | "error" | "skipped-inflight" */
  outcome: "ok" | "no-video" | "error" | "skipped-inflight";
  error?: string;
}

export interface UseQwenHeartbeatOptions {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  profile: HSEDetectionProfile;
  roi: HSERoi | null;
  /** Normal tick interval. Clamped to ≥1000 ms. Default 2000. */
  intervalMs?: number;
  /** Backoff after Qwen failure. Default 10000. */
  backoffMs?: number;
  /** Force Qwen reasoning on each tick. Default true. */
  forceReason?: boolean;
  onResponse?: (r: QwenHeartbeatResponse) => void;
  onDiagnostic?: (d: QwenHeartbeatDiagnostic) => void;
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

export function useQwenHeartbeat({
  enabled,
  videoRef,
  profile,
  roi,
  intervalMs = 2000,
  backoffMs = 10000,
  forceReason = true,
  onResponse,
  onDiagnostic,
}: UseQwenHeartbeatOptions): void {
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onDiagnosticRef = useRef(onDiagnostic);
  onDiagnosticRef.current = onDiagnostic;
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

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let currentDelay = intervalRef.current;
    const sessionId = `hse-qwen-hb-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let frameCounter = 0;

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
        onDiagnosticRef.current?.({
          receivedAtMs: Date.now(),
          rawReasonerStatus: null,
          normalizedReasonerStatus: null,
          warnings: [],
          sceneRisks: 0,
          outcome: "skipped-inflight",
        });
        schedule(currentDelay);
        return;
      }
      const video = videoRef.current;
      if (!video || !video.videoWidth) {
        onDiagnosticRef.current?.({
          receivedAtMs: Date.now(),
          rawReasonerStatus: null,
          normalizedReasonerStatus: null,
          warnings: [],
          sceneRisks: 0,
          outcome: "no-video",
        });
        schedule(currentDelay);
        return;
      }
      inFlight = true;
      try {
        const captured = captureVideoFrameBase64(video);
        if (!captured) {
          onDiagnosticRef.current?.({
            receivedAtMs: Date.now(),
            rawReasonerStatus: null,
            normalizedReasonerStatus: null,
            warnings: [],
            sceneRisks: 0,
            outcome: "no-video",
          });
          return;
        }
        frameCounter += 1;
        const frameId = `${sessionId}-${frameCounter}`;
        const baseReq = buildHseDetectRequest(
          profileRef.current,
          roiRef.current,
          "hse-qwen-heartbeat",
        );
        const monitoringRequest = forceReasonRef.current
          ? {
              ...baseReq,
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
            }
          : baseReq;
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
        onResponseRef.current?.({ parsed, raw, receivedAtMs, sessionId, frameId });
        onDiagnosticRef.current?.({
          receivedAtMs,
          rawReasonerStatus: rawStatus,
          normalizedReasonerStatus: normalized,
          warnings,
          sceneRisks,
          outcome: "ok",
        });
        const failed =
          warnings.includes("qwen_unavailable") ||
          (normalized != null && FAILURE_STATES.has(normalized.toLowerCase())) ||
          (rawStatus != null && FAILURE_STATES.has(rawStatus.toLowerCase()));
        currentDelay = failed ? backoffRef.current : intervalRef.current;
      } catch (e) {
        onDiagnosticRef.current?.({
          receivedAtMs: Date.now(),
          rawReasonerStatus: null,
          normalizedReasonerStatus: null,
          warnings: [],
          sceneRisks: 0,
          outcome: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        currentDelay = backoffRef.current;
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

    // First tick on the normal interval.
    schedule(currentDelay);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, videoRef]);
}
