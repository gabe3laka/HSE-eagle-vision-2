import { Activity } from "lucide-react";
import type { QwenHeartbeatDiagnostic } from "@/features/hse-monitoring/hooks/useQwenHeartbeat";
import type { HeartbeatIgnoreReason } from "@/features/hse-monitoring/lib/mergeParsedRisk";
import { heartbeatIgnoreMessage } from "@/features/hse-monitoring/lib/mergeParsedRisk";

/**
 * Heartbeat Diagnostics Panel — dev-only, HSE-only.
 * Surfaces whether the Qwen heartbeat is actually ticking, what each tick
 * returned, and whether results are being ignored. Pure presentation: never
 * touches alerts, incidents, overlays, or box colors.
 */

export interface HeartbeatCounters {
  okCount: number;
  errorCount: number;
  skippedInflightCount: number;
  noVideoCount: number;
}

export interface HeartbeatDiagnosticsPanelProps {
  enabled: boolean;
  intervalMs: number;
  backoffMs: number;
  extendedBackoffMs: number;
  extendedBackoffAfter: number;
  forceReason: boolean;
  currentSessionId: string | null;
  lastDiagnostic: QwenHeartbeatDiagnostic | null;
  counters: HeartbeatCounters;
  ignoreReason: HeartbeatIgnoreReason;
  nowMs: number;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

export function HeartbeatDiagnosticsPanel(props: HeartbeatDiagnosticsPanelProps) {
  const {
    enabled,
    intervalMs,
    backoffMs,
    extendedBackoffMs,
    extendedBackoffAfter,
    forceReason,
    currentSessionId,
    lastDiagnostic,
    counters,
    ignoreReason,
    nowMs,
  } = props;
  const lastAgeMs = lastDiagnostic ? Math.max(0, nowMs - lastDiagnostic.receivedAtMs) : null;
  const ignoreMsg = heartbeatIgnoreMessage(ignoreReason);
  const outcome = lastDiagnostic?.outcome ?? "—";
  const outcomeClass =
    outcome === "ok"
      ? "text-emerald-300"
      : outcome === "error" || outcome === "pending-timeout-client"
        ? "text-red-300"
        : outcome === "no-video" ||
            outcome === "skipped-inflight" ||
            outcome === "skipped-qwen-pending"
          ? "text-amber-300"
          : "text-muted-foreground";
  const qwenPending = lastDiagnostic?.qwenPending ?? false;
  const pendingSinceMs = lastDiagnostic?.pendingSinceMs ?? null;
  const pendingAgeMs =
    pendingSinceMs != null ? Math.max(0, nowMs - pendingSinceMs) : null;
  const lifecycleClass =
    lastDiagnostic?.qwenLifecycle === "terminal-success"
      ? "text-emerald-300"
      : lastDiagnostic?.qwenLifecycle === "pending"
        ? "text-amber-300"
        : lastDiagnostic?.qwenLifecycle === "terminal-failure"
          ? "text-red-300"
          : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-cyan-300/30 bg-cyan-400/[0.04] p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-cyan-300" />
        <span className="font-semibold text-cyan-100">Qwen Heartbeat Diagnostics</span>
        <span
          className={
            "ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider " +
            (enabled ? "bg-emerald-400/15 text-emerald-200" : "bg-muted/40 text-muted-foreground")
          }
        >
          {enabled ? "enabled" : "disabled"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-0.5">
          <Row label="interval_ms" value={intervalMs} />
          <Row label="backoff_ms" value={backoffMs} />
          <Row label="extended_backoff_ms" value={extendedBackoffMs} />
          <Row label="extended_after" value={extendedBackoffAfter} />
          <Row label="force_reason" value={forceReason ? "yes" : "no"} />
          <Row label="session_id" value={currentSessionId ?? "—"} />
        </div>
        <div className="space-y-0.5">
          <Row label="last_outcome" value={<span className={outcomeClass}>{outcome}</span>} />
          <Row label="last_tick_age_ms" value={lastAgeMs == null ? "—" : `${lastAgeMs}`} />
          <Row label="last_scene_risks" value={lastDiagnostic?.sceneRisks ?? "—"} />
          <Row
            label="last_reasoner_status"
            value={
              lastDiagnostic?.normalizedReasonerStatus ?? lastDiagnostic?.rawReasonerStatus ?? "—"
            }
          />
          <Row
            label="last_lifecycle"
            value={
              <span className={lifecycleClass}>{lastDiagnostic?.qwenLifecycle ?? "—"}</span>
            }
          />
          <Row label="consecutive_failures" value={lastDiagnostic?.consecutiveFailures ?? 0} />
          <Row label="next_delay_ms" value={lastDiagnostic?.nextDelayMs ?? "—"} />
        </div>
        <div className="space-y-0.5">
          <Row
            label="qwen_pending"
            value={
              <span className={qwenPending ? "text-amber-300" : "text-emerald-300"}>
                {qwenPending ? "yes" : "no"}
              </span>
            }
          />
          <Row label="pending_since_ms" value={pendingAgeMs == null ? "—" : `${pendingAgeMs}`} />
          <Row label="pending_frame_id" value={lastDiagnostic?.pendingFrameId ?? "—"} />
          <Row
            label="heartbeat_gated"
            value={
              <span className={qwenPending ? "text-amber-300" : "text-muted-foreground"}>
                {qwenPending ? "yes" : "no"}
              </span>
            }
          />
          <Row
            label="next_heartbeat_allowed"
            value={qwenPending ? "on Qwen terminal response" : "scheduled"}
          />
          <Row
            label="skipped_pending_count"
            value={lastDiagnostic?.skippedPendingCount ?? 0}
          />
        </div>
        <div className="space-y-0.5">
          <Row label="ok_count" value={counters.okCount} />
          <Row label="error_count" value={counters.errorCount} />
          <Row label="skipped_inflight_count" value={counters.skippedInflightCount} />
          <Row label="no_video_count" value={counters.noVideoCount} />
          <Row
            label="http_received"
            value={
              <span
                className={
                  lastDiagnostic?.httpReceived ? "text-emerald-300" : "text-muted-foreground"
                }
              >
                {lastDiagnostic?.httpReceived ? "yes" : "no"}
              </span>
            }
          />
          <Row
            label="qwen_result_received"
            value={
              <span
                className={
                  lastDiagnostic?.qwenResultReceived
                    ? "text-emerald-300"
                    : "text-muted-foreground"
                }
              >
                {lastDiagnostic?.qwenResultReceived ? "yes" : "no"}
              </span>
            }
          />
        </div>
        <div className="space-y-0.5 sm:col-span-2">
          <Row
            label="last_warnings"
            value={
              lastDiagnostic && lastDiagnostic.warnings.length > 0
                ? lastDiagnostic.warnings.join(", ")
                : "—"
            }
          />
          <Row label="last_error" value={lastDiagnostic?.error ?? "—"} />
          <Row label="ignore_reason" value={ignoreReason ?? "—"} />
        </div>
      </div>
      {ignoreMsg && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-200">
          {ignoreMsg}
        </div>
      )}
    </div>
  );
}
