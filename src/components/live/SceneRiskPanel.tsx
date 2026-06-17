import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type { RecommendedControl, SceneRisk } from "@/lib/detection/riskTypes";
import {
  highestRiskLevel,
  isAiDraftReviewRequired,
  riskLevelColor,
  riskLevelRank,
  normalizeRiskLevel,
} from "@/lib/detection/riskTypes";
import { CONTROL_TYPE_META, type ControlType } from "@/features/safety/lib/controlLibrary";

/**
 * Scene-risk panel (feature-flagged by VITE_WORKER_SCENE_RISKS). Renders the
 * highest risk level, the alerting count, and the top 3 risks with reason +
 * evidence + recommended controls. Additive + read-only: it never converts a
 * VLM/draft risk into an incident, risk_register entry or CAPA — human
 * confirmation stays required elsewhere. Mirrors the existing console-panel
 * styling so it sits naturally alongside the other Live panels.
 */

/** Order recommended controls by the NIOSH hierarchy when a `level` maps to a
 *  known ControlType; unknown/absent levels keep their original order (stable). */
function orderControlsByHierarchy(
  controls: RecommendedControl[] | undefined,
  enabled: boolean,
): RecommendedControl[] {
  if (!controls || controls.length === 0) return [];
  if (!enabled) return controls;
  const rank = (c: RecommendedControl): number => {
    const key = (c.level ?? "").toLowerCase() as ControlType;
    const meta = CONTROL_TYPE_META[key];
    return meta ? meta.rank : 99;
  };
  return controls
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

function RiskRow({
  risk,
  showControlHierarchy,
  showProvenance,
}: {
  risk: SceneRisk;
  showControlHierarchy: boolean;
  showProvenance: boolean;
}) {
  const level = normalizeRiskLevel(risk.risk_level, risk.risk_color);
  const color = riskLevelColor(level);
  const draft = isAiDraftReviewRequired(risk);
  const controls = orderControlsByHierarchy(risk.recommended_controls, showControlHierarchy);
  const evidence = (risk.visual_evidence ?? risk.evidence ?? []).slice(0, 3);
  return (
    <li className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
          style={{ background: color }}
        >
          {level ?? "—"}
        </span>
        <span className="truncate text-xs font-medium text-foreground">
          {risk.hazard ?? "Hazard"}
        </span>
        {draft && (
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-violet-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-200">
            <Sparkles className="h-2.5 w-2.5" /> AI draft — review required
          </span>
        )}
      </div>
      {risk.risk_reason && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{risk.risk_reason}</p>
      )}
      {evidence.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[10px] text-muted-foreground/80">
          {evidence.map((e, i) => (
            <li key={i} className="truncate">
              {e}
            </li>
          ))}
        </ul>
      )}
      {controls.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {controls.slice(0, 4).map((c, i) => {
            const key = (c.level ?? "").toLowerCase() as ControlType;
            const meta = CONTROL_TYPE_META[key];
            return (
              <div key={i} className="flex items-start gap-1.5 text-[10px]">
                {meta && showControlHierarchy ? (
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 font-semibold ${meta.bg} ${meta.text}`}
                  >
                    {meta.label}
                  </span>
                ) : c.level ? (
                  <span className="shrink-0 rounded bg-white/5 px-1 py-0.5 font-medium text-muted-foreground">
                    {c.level}
                  </span>
                ) : null}
                <span className="leading-snug text-foreground/90">{c.action}</span>
              </div>
            );
          })}
        </div>
      )}
      {showProvenance && (risk.produced_by || risk.reasoner_model) && (
        <p className="mt-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/60">
          {risk.produced_by ?? "rules"}
          {risk.reasoner_model ? ` · ${risk.reasoner_model}` : ""}
          {risk.risk_matrix_version ? ` · matrix ${risk.risk_matrix_version}` : ""}
        </p>
      )}
    </li>
  );
}

export function SceneRiskPanel({
  risk,
  showControlHierarchy = false,
  showProvenance = false,
}: {
  risk: ParsedDetectRisk;
  showControlHierarchy?: boolean;
  showProvenance?: boolean;
}) {
  const risks = risk.sceneRisks ?? [];
  const summary = risk.riskSummary;
  const highest = summary?.highest_level ?? highestRiskLevel(risks);
  const alertingCount =
    summary?.alerting_count ?? risks.filter((r) => r.should_alert === true).length;
  // Top 3 by severity rank (then by risk_score desc).
  const top = [...risks]
    .sort(
      (a, b) =>
        riskLevelRank(normalizeRiskLevel(b.risk_level, b.risk_color)) -
          riskLevelRank(normalizeRiskLevel(a.risk_level, a.risk_color)) ||
        (b.risk_score ?? 0) - (a.risk_score ?? 0),
    )
    .slice(0, 3);

  return (
    <div className="console-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-200">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="console-eyebrow">Scene risk</p>
          <h2 className="font-display text-sm font-semibold">Risk overview</h2>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase text-black"
            style={{ background: riskLevelColor(highest) }}
          >
            {highest ?? "—"}
          </span>
          {alertingCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-200">
              <AlertTriangle className="h-3 w-3" />
              {alertingCount}
            </span>
          )}
        </div>
      </div>

      {top.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No active scene risks.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((r, i) => (
            <RiskRow
              key={r.risk_id ?? r.track_id ?? i}
              risk={r}
              showControlHierarchy={showControlHierarchy}
              showProvenance={showProvenance}
            />
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
