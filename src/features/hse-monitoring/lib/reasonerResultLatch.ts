/**
 * Pure helpers for the HSE Live "last-good reasoner result" latch.
 *
 * Problem this solves: the worker's reasoner result is async/slow (Gemini
 * ~5–12s) and arrives sporadically on either the live `/detect` terminal
 * frame or the force-reason heartbeat. Between those arrivals the live frames
 * carry no usable `scene_risks`, so nothing links and YOLO boxes never get
 * colored until the camera stops. The latch keeps the last usable reasoner
 * result around for a freshness TTL and re-merges it into the view-model input
 * every frame, so the existing linker + anchor memory keep re-binding it to the
 * current (moving) YOLO entities while the camera runs.
 *
 * Kept pure (no React) so it is unit-testable without `@testing-library/react`.
 */

import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type { ReasonerLifecycle } from "@/features/hse-monitoring/hooks/useReasonerHeartbeat";
import { mergeParsedRisk } from "@/features/hse-monitoring/lib/mergeParsedRisk";

/**
 * PURE: true when a parsed reasoner result carries something that can actually
 * COLOR a box / affect risk on the overlay — i.e. linkable scene risks or
 * risk-affecting semantic corrections.
 *
 * A bare `sceneContext` (a scene summary) is intentionally NOT enough: it is
 * diagnostic-only and must never let an otherwise-empty `ready` response
 * overwrite a previously-latched linkable risk. (sceneContext still reaches the
 * view model / debug panel separately via `mergeParsedRisk` — it just does not
 * drive the color latch.) Empty `ready` results likewise return false.
 */
export function hasUsableReasonerRisk(parsed: ParsedDetectRisk | null): boolean {
  if (!parsed) return false;
  if ((parsed.sceneRisks?.length ?? 0) > 0) return true;
  if ((parsed.semanticCorrections?.length ?? 0) > 0) return true;
  return false;
}

/**
 * PURE: true when this terminal-success result should replace the latch. Only
 * terminal-success with usable content updates the latch; queued/running/empty
 * results leave the previous latch untouched.
 */
export function shouldUpdateLatch(
  lifecycle: ReasonerLifecycle,
  parsed: ParsedDetectRisk | null,
): boolean {
  return lifecycle === "terminal-success" && hasUsableReasonerRisk(parsed);
}

export interface IsLatchFreshArgs {
  /** Wall-clock ms the latch was stamped (null = no latch). */
  atMs: number | null;
  /** Freshness window in ms. */
  ttlMs: number;
  /** Current wall-clock ms. */
  nowMs: number;
  /** Worker session id the latch was captured under (null = unknown). */
  latchSessionId: string | null;
  /** Current live detector worker session id (null = unknown). */
  liveSessionId: string | null;
}

/**
 * PURE: true when the latch is within its TTL AND still belongs to the current
 * live session. A null session id on either side is treated as "matches" (the
 * worker session id is best-effort; we don't want to drop a fresh latch just
 * because the id wasn't reported yet).
 */
export function isLatchFresh(args: IsLatchFreshArgs): boolean {
  const { atMs, ttlMs, nowMs, latchSessionId, liveSessionId } = args;
  if (atMs == null) return false;
  if (!Number.isFinite(atMs)) return false;
  if (nowMs - atMs > ttlMs) return false;
  if (latchSessionId && liveSessionId && latchSessionId !== liveSessionId) return false;
  return true;
}

export interface ComputeParsedRiskForVmArgs {
  /** The current live `/detect` terminal result (primary; never replaced). */
  live: ParsedDetectRisk | null;
  /** The latest heartbeat terminal-success result. */
  heartbeat: ParsedDetectRisk | null;
  /** Whether the heartbeat passes its ignore gate (stale/session/frame). */
  applyHeartbeat: boolean;
  /** The latched last-good reasoner result. */
  latch: ParsedDetectRisk | null;
  /** Whether the latch is still fresh (see {@link isLatchFresh}). */
  latchFresh: boolean;
}

/**
 * PURE: build the ParsedDetectRisk fed to the HSE view model. Starts from the
 * live result (source of truth for current detector state), additively merges
 * the heartbeat result when its gate is open, then additively merges the latch
 * when fresh. `mergeParsedRisk` dedups scene risks so a value present in more
 * than one source is never double-counted.
 */
export function computeParsedRiskForVm(args: ComputeParsedRiskForVmArgs): ParsedDetectRisk | null {
  const { live, heartbeat, applyHeartbeat, latch, latchFresh } = args;
  let acc = live;
  if (heartbeat) {
    acc = mergeParsedRisk(acc, heartbeat, { applyHeartbeatRisks: applyHeartbeat });
  }
  if (latch && latchFresh) {
    acc = mergeParsedRisk(acc, latch, { applyHeartbeatRisks: true });
  }
  return acc;
}

/**
 * PURE: true when the latch must be cleared — the worker session changed (a new
 * monitoring session means a new temporal/reasoner memory window) or monitoring
 * is no longer active. Queued/running/empty-ready frames never clear the latch;
 * the freshness gate + anchor caps handle decay.
 */
export function shouldClearLatch(
  prevSessionId: string | null,
  nextSessionId: string | null,
  monitoringActive: boolean,
): boolean {
  if (!monitoringActive) return true;
  if (prevSessionId !== nextSessionId) return true;
  return false;
}
