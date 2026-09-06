/**
 * useVpsLocalization — localize-then-track against a MultiSet map.
 *
 * NEVER queries per frame: MultiSet's Lite tier is 10,000 calls/month and a
 * continuously-querying device would burn that in under a day. Queries happen
 *   • once on session start,
 *   • when tracking is lost (confidence decayed to zero), and
 *   • every VITE_VPS_REQUERY_MS (default 45,000 ms)
 * and `queriesThisSession` counts every one of them — the debug panel shows it
 * so a runaway loop is caught before the bill is.
 *
 * Between queries the pose is DEAD-RECKONED: yaw follows the device compass
 * delta since the query, position holds still, and confidence decays linearly
 * to zero at 3× the requery interval — the vps_map tier's gate then drops the
 * pose long before it can lie.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureVpsFrame } from "./frameCapture";
import { queryPose } from "./multisetClient";
import type { VpsPose } from "./types";
import type { SvVpsPose } from "../types";

export const VPS_REQUERY_DEFAULT_MS = 45_000;
/** Confidence reaches zero at this multiple of the requery interval. */
export const VPS_DECAY_MULTIPLE = 3;

export function readVpsRequeryMs(env: Record<string, unknown> = safeEnv()): number {
  const raw = Number(env.VITE_VPS_REQUERY_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : VPS_REQUERY_DEFAULT_MS;
}

function safeEnv(): Record<string, unknown> {
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** PURE: linear decay from the queried confidence to 0 at 3× requeryMs. */
export function decayedConfidence(
  queriedConfidence: number,
  msSinceQuery: number,
  requeryMs: number,
): number {
  const horizon = requeryMs * VPS_DECAY_MULTIPLE;
  if (horizon <= 0) return 0;
  const k = 1 - msSinceQuery / horizon;
  return Math.max(0, Math.min(1, queriedConfidence * k));
}

/** PURE: yaw-only dead reckoning — rotate the queried pose by the compass
 *  delta (deg) about the world up axis (y). Position is NOT advanced. */
export function deadReckonRotation(
  rotation: { x: number; y: number; z: number; w: number },
  headingDeltaDeg: number,
): { x: number; y: number; z: number; w: number } {
  const half = (-headingDeltaDeg * Math.PI) / 180 / 2; // compass CW = yaw −
  const qy = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
  // q' = qy ⊗ rotation
  return {
    w: qy.w * rotation.w - qy.y * rotation.y,
    x: qy.w * rotation.x + qy.y * rotation.z,
    y: qy.w * rotation.y + qy.y * rotation.w,
    z: qy.w * rotation.z - qy.y * rotation.x,
  };
}

export interface VpsLocalization {
  /** Latest (dead-reckoned) pose, or null before the first fix / after loss. */
  pose: VpsPose | null;
  /** Decayed confidence for the current instant (0 when no pose). */
  confidence: number;
  trackingState: "localized" | "tracking" | "lost" | "relocalizing";
  lastQueryAt: number | null;
  queriesThisSession: number;
  lastError: string | null;
  querying: boolean;
  /** Which intrinsics path the last query used (device_table | fov_estimate). */
  intrinsicsSource: string | null;
  /** Wire shape for the sv_frame broadcast — null when nothing trustworthy. */
  broadcastPose: SvVpsPose | null;
}

export function useVpsLocalization(params: {
  enabled: boolean;
  mapCode: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  headingDeg: number | null;
  requeryMs?: number;
}): VpsLocalization {
  const { enabled, mapCode, videoRef, headingDeg } = params;
  const requeryMs = params.requeryMs ?? readVpsRequeryMs();

  const [state, setState] = useState<{
    queried: VpsPose | null;
    lastQueryAt: number | null;
    queries: number;
    error: string | null;
    querying: boolean;
    intrinsicsSource: string | null;
  }>({
    queried: null,
    lastQueryAt: null,
    queries: 0,
    error: null,
    querying: false,
    intrinsicsSource: null,
  });
  const [tick, setTick] = useState(0); // 1 Hz decay re-render while enabled
  const headingAtQueryRef = useRef<number | null>(null);
  const headingRef = useRef<number | null>(headingDeg);
  headingRef.current = headingDeg;
  const queryingRef = useRef(false);
  const lostRequeryDoneRef = useRef(false);

  const runQuery = useCallback(async () => {
    if (queryingRef.current || !mapCode) return;
    queryingRef.current = true;
    setState((s) => ({ ...s, querying: true }));
    try {
      const frame = await captureVpsFrame(videoRef.current);
      const res = await queryPose({ blob: frame.blob, intrinsics: frame.intrinsics, mapCode });
      headingAtQueryRef.current = headingRef.current;
      lostRequeryDoneRef.current = false;
      setState((s) => ({
        queried: res.pose,
        lastQueryAt: Date.now(),
        queries: s.queries + 1,
        error: res.error ?? (res.pose ? null : "pose_not_found"),
        querying: false,
        intrinsicsSource:
          frame.intrinsics.source ?? (frame.intrinsics.estimated ? "fov_estimate" : "device_table"),
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        lastQueryAt: Date.now(),
        queries: s.queries + 1,
        error: e instanceof Error ? e.message : String(e),
        querying: false,
      }));
    } finally {
      queryingRef.current = false;
    }
  }, [mapCode, videoRef]);

  // Session start + steady requery cadence. NO per-frame path exists.
  useEffect(() => {
    if (!enabled || !mapCode) return;
    void runQuery();
    const id = setInterval(() => void runQuery(), requeryMs);
    const decayId = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(id);
      clearInterval(decayId);
    };
  }, [enabled, mapCode, requeryMs, runQuery]);

  return useMemo<VpsLocalization>(() => {
    void tick;
    const now = Date.now();
    const q = state.queried;
    const since = state.lastQueryAt ? now - state.lastQueryAt : Number.POSITIVE_INFINITY;
    const confidence = q ? decayedConfidence(q.confidence, since, requeryMs) : 0;

    let trackingState: VpsLocalization["trackingState"] = "lost";
    if (state.querying && !q) trackingState = "relocalizing";
    else if (q && confidence > 0) trackingState = since < 2_000 ? "localized" : "tracking";

    // One extra out-of-cadence query the moment tracking is lost.
    if (enabled && q && confidence <= 0 && !lostRequeryDoneRef.current && !queryingRef.current) {
      lostRequeryDoneRef.current = true;
      void runQuery();
    }

    let pose: VpsPose | null = null;
    if (q && confidence > 0) {
      const delta =
        headingRef.current != null && headingAtQueryRef.current != null
          ? headingRef.current - headingAtQueryRef.current
          : 0;
      pose = {
        ...q,
        rotation: delta !== 0 ? deadReckonRotation(q.rotation, delta) : q.rotation,
        confidence,
        trackingState,
      };
    }

    const broadcastPose: SvVpsPose | null =
      pose && pose.mapCode
        ? {
            position: pose.position,
            rotation: pose.rotation,
            confidence,
            mapCode: pose.mapCode,
            timestampMs: now,
          }
        : null;

    return {
      pose,
      confidence,
      trackingState,
      lastQueryAt: state.lastQueryAt,
      queriesThisSession: state.queries,
      lastError: state.error,
      querying: state.querying,
      intrinsicsSource: state.intrinsicsSource,
      broadcastPose,
    };
  }, [enabled, requeryMs, runQuery, state, tick]);
}
