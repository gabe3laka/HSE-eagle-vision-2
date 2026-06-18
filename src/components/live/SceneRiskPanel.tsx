import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import { riskLevelColor, riskLevelRank } from "@/lib/detection/riskTypes";
import type {
  HseLiveRiskViewModel,
  HseGroupedRisk,
} from "@/lib/detection/hseLiveRiskViewModel";

/**
 * Scene Risk Overview — driven by the shared HseLiveRiskViewModel so the box
 * colors, friendly labels, and the worker/Qwen status chip all agree with the
 * Priority Scene Risks list in HseMonitoringPanel.
 *
 * Raw temporal JSON / session_id / risk id / track IDs / anchor details and the
 * full hierarchy-of-controls list are hidden by default; debug surfaces them
 * via the existing risk-debug panel.
 */

function RiskRow({ risk }: { risk: HseGroupedRisk }) {
  const color = riskLevelColor(risk.level);
  return (
    <li className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
          style={{ background: color }}
        >
          {risk.level}
        </span>
        <span className="truncate text-xs font-medium text-foreground">{risk.hazardLabel}</span>
        <span className="ml-auto rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
          {risk.source}
        </span>
      </div>
      {risk.linkedItem && (
        <p className="mt-1 text-[10px] text-muted-foreground/85">
          Linked item: <span className="text-foreground/90">{risk.linkedItem}</span>
        </p>
      )}
      {risk.why && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground/80">Why:</span> {risk.why}
        </p>
      )}
      {risk.action && (
        <p className="mt-1 text-[11px] leading-snug text-foreground/90">
          <span className="font-medium text-muted-foreground">Action:</span> {risk.action}
        </p>
      )}
    </li>
  );
}

export function SceneRiskPanel({ viewModel }: { viewModel: HseLiveRiskViewModel }) {
  const top = viewModel.priorityRisks.slice(0, 3);
  const highest = viewModel.highestLevel;
  const alerting = viewModel.priorityRisks.filter(
    (r) => riskLevelRank(r.level) >= riskLevelRank("ORANGE"),
  ).length;
  const reasoner = viewModel.reasonerBadge;

  return (
    <div className="console-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-200">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="console-eyebrow">Scene risk</p>
          <h2 className="font-display text-sm font-semibold">Scene Risk Overview</h2>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase text-black"
            style={{ background: riskLevelColor(highest) }}
          >
            {highest ?? "—"}
          </span>
          {alerting > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-200">
              <AlertTriangle className="h-3 w-3" />
              {alerting}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          {reasoner.label}
        </span>
      </div>

      {top.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No active scene risks.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((r) => (
            <RiskRow key={r.key} risk={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A clear, non-blocking banner shown when the worker reports degraded
 *  monitoring. Never covers the camera; sits in the panel column. */
export function MonitoringDegradedBanner() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
      <span>Monitoring degraded — some risk signals may be reduced. Detection continues.</span>
    </div>
  );
}

/** Risk-aware debug/status readout (feature-flagged by VITE_RISK_DEBUG_PANEL).
 *  Shows degradation_mode, privacy_blur_applied, reasoner availability, schema
 *  warnings and stage timings — diagnostics only, never blocks the camera. */
export function RiskDebugPanel({ risk }: { risk: ParsedDetectRisk }) {
  const reasonerUnavailable =
    risk.reasonerStatus === "timeout" ||
    risk.reasonerStatus === "unavailable" ||
    risk.reasonerStatus === "schema_error";
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-1 font-semibold">risk engine</div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          schema: <span className="text-foreground">{String(risk.schemaVersion ?? "—")}</span> ·
          engine: {risk.riskEngine ?? "—"}
        </div>
        <div>
          risk: {String(risk.riskEnabled ?? "—")} · tracking: {String(risk.trackingEnabled ?? "—")}{" "}
          · scene-graph: {String(risk.sceneGraphEnabled ?? "—")}
        </div>
        <div>
          degraded:{" "}
          <span className={risk.degraded ? "text-amber-400" : "text-foreground"}>
            {String(risk.degraded)}
          </span>
          {risk.degradationMode ? ` · mode: ${risk.degradationMode}` : ""}
        </div>
        <div>privacy blur applied: {String(risk.privacyBlurApplied ?? "—")}</div>
        {reasonerUnavailable && (
          <div className="text-amber-400">AI unavailable: {risk.reasonerStatus}</div>
        )}
        {risk.schemaWarning && <div className="text-amber-400">{risk.schemaWarning}</div>}
        {risk.warnings.length > 0 && (
          <div className="text-amber-400">warnings: {risk.warnings.join(", ")}</div>
        )}
        {risk.stageTimingsMs && (
          <div className="truncate" title={JSON.stringify(risk.stageTimingsMs)}>
            stages: {JSON.stringify(risk.stageTimingsMs)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small privacy notice near the camera (feature-flagged by
 *  VITE_CAMERA_PRIVACY_NOTICE). Additive, non-blocking. */
export function CameraPrivacyNotice() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-md bg-black/55 px-2 py-1 text-[9px] font-medium text-white/80 backdrop-blur">
      Camera frames are processed for safety monitoring only.
    </div>
  );
}
