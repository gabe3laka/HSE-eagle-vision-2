import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type {
  ReasonerStatus,
  RecommendedControl,
  SceneRisk,
  SemanticCorrection,
} from "@/lib/detection/riskTypes";
import type {
  HseGroupedRisk,
  HseLiveRiskViewModel,
  HseQwenCandidate,
} from "@/lib/detection/hseLiveRiskViewModel";
import { HSE_PRIORITY_RISK_LIMIT } from "@/lib/detection/hseLiveRiskViewModel";
import {
  highestRiskLevel,
  isAiDraftReviewRequired,
  isReasonerUnavailable,
  normalizeRiskLevel,
  riskLevelColor,
  riskLevelRank,
} from "@/lib/detection/riskTypes";
import type { RiskAnchor } from "@/lib/detection/riskAssociation";
import { CONTROL_TYPE_META, type ControlType } from "@/features/safety/lib/controlLibrary";

/**
 * Scene-risk panel (feature-flagged by VITE_WORKER_SCENE_RISKS). Renders the
 * combined worker risks, app-side entity association state, semantic
 * corrections, provenance, and stale/resolving anchors. This is read-only:
 * AI/draft risk output still requires human review elsewhere before it becomes
 * an incident, risk-register entry, or CAPA.
 */

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

function compactValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  } catch {
    return String(value);
  }
}

function reasonerStatusLabel(status?: ReasonerStatus): string | null {
  if (status == null) return null;
  if (typeof status === "string") return status;
  const state = typeof status.state === "string" ? status.state : "object";
  const model = typeof status.model === "string" ? status.model : null;
  const mode = typeof status.mode === "string" ? status.mode : null;
  return [state, model, mode].filter(Boolean).join(" / ");
}

function riskTitle(risk: SceneRisk): string {
  return risk.hazard_type ?? risk.hazard ?? "Hazard";
}

function riskEvidence(risk: SceneRisk): string[] {
  return (risk.visual_evidence ?? risk.evidence ?? []).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function riskIdLine(risk: SceneRisk): string | null {
  const ids = [
    risk.risk_id ? `risk ${risk.risk_id}` : null,
    risk.track_id ? `track ${risk.track_id}` : null,
    risk.detection_id ? `det ${risk.detection_id}` : null,
    risk.involved_track_ids?.length ? `tracks ${risk.involved_track_ids.join(", ")}` : null,
    risk.involved_detection_ids?.length ? `dets ${risk.involved_detection_ids.join(", ")}` : null,
  ].filter(Boolean);
  return ids.length ? ids.join(" | ") : null;
}

function anchorLine(anchor: RiskAnchor): string {
  const linked = [
    anchor.lastMatchedTrackId ? `track ${anchor.lastMatchedTrackId}` : null,
    anchor.lastMatchedEntityId ? `entity ${anchor.lastMatchedEntityId}` : null,
  ].filter(Boolean);
  const state = anchor.status ?? "active";
  const stale = anchor.stale ? " stale" : "";
  return `${anchor.riskLevel} ${anchor.hazardType ?? anchor.riskId} - ${state}${stale}${
    linked.length ? ` - ${linked.join(" | ")}` : ""
  }`;
}

function CorrectionList({
  corrections,
  title = "Semantic corrections",
}: {
  corrections: SemanticCorrection[];
  title?: string;
}) {
  if (corrections.length === 0) return null;
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <p className="console-eyebrow">{title}</p>
      <ul className="mt-1.5 space-y-1.5 text-[10px] text-muted-foreground">
        {corrections.map((correction, index) => {
          const label = correction.semantic_label ?? correction.corrected_label ?? correction.label;
          return (
            <li
              key={correction.correction_id ?? correction.track_id ?? index}
              className="rounded bg-white/[0.03] px-2 py-1.5"
            >
              <span className="font-semibold text-foreground">
                {correction.action ?? correction.status ?? "corrected"}
              </span>
              {label && <span> - {label}</span>}
              {correction.reason && <span> - {correction.reason}</span>}
              {correction.produced_by && <span> - {correction.produced_by}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RiskRow({
  risk,
  showControlHierarchy,
  showProvenance,
  unmatched = false,
}: {
  risk: SceneRisk;
  showControlHierarchy: boolean;
  showProvenance: boolean;
  unmatched?: boolean;
}) {
  const level = normalizeRiskLevel(risk.risk_level, risk.risk_color);
  const color = riskLevelColor(level);
  const draft = isAiDraftReviewRequired(risk);
  const controls = orderControlsByHierarchy(risk.recommended_controls, showControlHierarchy);
  const evidence = riskEvidence(risk).slice(0, 4);
  const ids = riskIdLine(risk);
  const association = unmatched
    ? "no stable entity match in current frame"
    : risk.risk_association || risk.linked_entity_id
      ? [
          risk.linked_entity_id ? `linked ${risk.linked_entity_id}` : null,
          risk.risk_association ? `via ${risk.risk_association}` : null,
          risk.risk_anchor_status ? `anchor ${risk.risk_anchor_status}` : null,
        ]
          .filter(Boolean)
          .join(" | ")
      : null;

  return (
    <li className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
          style={{ background: color }}
        >
          {level ?? "-"}
        </span>
        <span className="truncate text-xs font-medium text-foreground">{riskTitle(risk)}</span>
        {typeof risk.risk_score === "number" && (
          <span className="text-[10px] text-muted-foreground">{risk.risk_score.toFixed(2)}</span>
        )}
        {risk.risk_state && (
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
            {risk.risk_state}
          </span>
        )}
        {draft && (
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-violet-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-200">
            <Sparkles className="h-2.5 w-2.5" /> AI draft - review required
          </span>
        )}
      </div>
      {association && (
        <p className="mt-1 text-[10px] font-medium text-cyan-100/80">{association}</p>
      )}
      {ids && <p className="mt-0.5 truncate text-[9px] text-muted-foreground/70">{ids}</p>}
      {risk.risk_reason && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{risk.risk_reason}</p>
      )}
      {risk.trigger_condition && risk.trigger_condition !== risk.risk_reason && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
          trigger: {risk.trigger_condition}
        </p>
      )}
      {evidence.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[10px] text-muted-foreground/80">
          {evidence.map((item, index) => (
            <li key={index} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      )}
      {controls.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {controls.slice(0, 4).map((control, index) => {
            const key = (control.level ?? "").toLowerCase() as ControlType;
            const meta = CONTROL_TYPE_META[key];
            return (
              <div key={index} className="flex items-start gap-1.5 text-[10px]">
                {meta && showControlHierarchy ? (
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 font-semibold ${meta.bg} ${meta.text}`}
                  >
                    {meta.label}
                  </span>
                ) : control.level ? (
                  <span className="shrink-0 rounded bg-white/5 px-1 py-0.5 font-medium text-muted-foreground">
                    {control.level}
                  </span>
                ) : null}
                <span className="leading-snug text-foreground/90">{control.action}</span>
              </div>
            );
          })}
        </div>
      )}
      {showProvenance && (risk.produced_by || risk.reasoner_model) && (
        <p className="mt-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/60">
          {risk.produced_by ?? "rules"}
          {risk.reasoner_model ? ` | ${risk.reasoner_model}` : ""}
          {risk.risk_matrix_version ? ` | matrix ${risk.risk_matrix_version}` : ""}
        </p>
      )}
      {risk.requires_human_review && !draft && (
        <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
          Human review required
        </p>
      )}
    </li>
  );
}

function linkedSummary(group: HseGroupedRisk): string {
  if (group.linkedLabels.length > 1) return `Linked items: ${group.linkedLabels.join(", ")}`;
  if (group.linkedLabels[0]) return `Linked item: ${group.linkedLabels[0]}`;
  if (group.itemCount > 1) return `${group.itemCount} linked items`;
  return "No stable entity match in current frame.";
}

function ReasonerChip({ vm }: { vm: HseLiveRiskViewModel }) {
  const tone = vm.reasonerBadge.tone;
  const cls =
    tone === "success"
      ? "bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "bg-amber-400/10 text-amber-200"
        : tone === "error"
          ? "bg-red-400/10 text-red-200"
          : tone === "info"
            ? "bg-cyan-400/10 text-cyan-200"
            : "bg-white/[0.04] text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <Sparkles className="h-3 w-3" />
      {vm.reasonerBadge.label}
    </span>
  );
}

function GroupedRiskRow({ group }: { group: HseGroupedRisk }) {
  const color = riskLevelColor(group.level);
  const firstRisk = group.risks[0];
  const why =
    group.reason ||
    firstRisk?.risk_reason ||
    firstRisk?.trigger_condition ||
    "Worker scene risk engine marked this as active.";
  const action = group.primaryAction || "Review and correct the hazard.";
  return (
    <li
      className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-semibold text-foreground">{group.title}</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase text-black"
          style={{ background: color }}
        >
          {group.level}
        </span>
        {group.itemCount > 1 && (
          <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
            {group.itemCount} items
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] font-medium text-cyan-100/80">{linkedSummary(group)}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Why: {why}</p>
      <p className="mt-1 text-[11px] leading-snug text-foreground/90">Action: {action}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground">
        <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5">
          Source: {group.sourceLabel}
        </span>
        {group.isResolving && (
          <span className="rounded-full bg-yellow-300/10 px-1.5 py-0.5 text-yellow-100">
            clearing shortly
          </span>
        )}
        {group.isStale && !group.isResolving && (
          <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5">carried briefly</span>
        )}
      </div>
    </li>
  );
}

function QwenCandidateRow({ candidate }: { candidate: HseQwenCandidate }) {
  const color = riskLevelColor(candidate.level);
  return (
    <li className="rounded-lg border border-violet-300/15 bg-violet-300/10 p-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-semibold text-violet-100">{candidate.title}</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase text-black"
          style={{ background: color }}
        >
          {candidate.level}
        </span>
        <span className="rounded-full bg-violet-300/15 px-1.5 py-0.5 text-[9px] text-violet-100">
          Qwen Candidate
        </span>
      </div>
      {candidate.reason && (
        <p className="mt-1 text-[11px] leading-snug text-violet-100/80">{candidate.reason}</p>
      )}
      <p className="mt-1 text-[10px] text-violet-100/60">
        Advisory only until matched to a detector track.
      </p>
    </li>
  );
}

function ReadableSceneRiskPanel({
  risk,
  vm,
  showProvenance,
}: {
  risk: ParsedDetectRisk;
  vm: HseLiveRiskViewModel;
  showProvenance: boolean;
}) {
  const topGroups = vm.priorityRisks;
  return (
    <div className="console-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-200">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="console-eyebrow">Scene risk</p>
          <h2 className="font-display text-sm font-semibold">
            Top {HSE_PRIORITY_RISK_LIMIT} scene risks
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <ReasonerChip vm={vm} />
          <span
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase text-black"
            style={{ background: riskLevelColor(vm.highestLevel) }}
          >
            {vm.highestLevel ?? "-"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>
          {vm.groupedRiskCount} grouped risk{vm.groupedRiskCount === 1 ? "" : "s"}
        </span>
        {vm.sceneContextLabel && <span>Scene: {vm.sceneContextLabel}</span>}
      </div>

      {topGroups.length === 0 ? (
        <p className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-2.5 text-xs text-muted-foreground">
          No active entity-linked scene risks.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {topGroups.map((group) => (
            <GroupedRiskRow key={group.key} group={group} />
          ))}
        </ul>
      )}

      {vm.groupedRiskCount > HSE_PRIORITY_RISK_LIMIT && topGroups.length > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Showing top {HSE_PRIORITY_RISK_LIMIT} of {vm.groupedRiskCount} grouped scene risks
        </p>
      )}

      {vm.qwenCandidates.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="console-eyebrow">Qwen candidates</p>
          <ul className="mt-2 space-y-2">
            {vm.qwenCandidates.map((candidate) => (
              <QwenCandidateRow key={candidate.key} candidate={candidate} />
            ))}
          </ul>
        </div>
      )}

      {topGroups.some((group) => group.isResolving) && (
        <div className="mt-3 rounded-lg border border-yellow-300/20 bg-yellow-300/10 p-2 text-[10px] text-yellow-100">
          <p className="font-semibold">Resolving risk color</p>
          <p className="mt-0.5">
            The matched YELLOW hazard is no longer confirmed, so the box fades and clears shortly.
          </p>
        </div>
      )}

      <CorrectionList corrections={risk.semanticCorrections ?? []} />
      <CorrectionList corrections={risk.unmatchedCorrections ?? []} title="Unmatched corrections" />

      {showProvenance && (
        <details className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-2 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer text-foreground">Debug provenance</summary>
          <div className="mt-2 space-y-1">
            <div>Raw risks: {vm.rawRiskCount}</div>
            <div>Grouped risks: {vm.groupedRiskCount}</div>
            <div>Hidden/acknowledged risks: {vm.hiddenGroupedRiskCount}</div>
            <div>temporal: {compactValue(risk.temporalReasoning)}</div>
            <div>scene context: {compactValue(risk.sceneContext)}</div>
            <div>reasoner: {compactValue(risk.reasonerStatus)}</div>
          </div>
        </details>
      )}
    </div>
  );
}

export function SceneRiskPanel({
  risk,
  hseRiskViewModel,
  showControlHierarchy = false,
  showProvenance = false,
}: {
  risk: ParsedDetectRisk;
  hseRiskViewModel?: HseLiveRiskViewModel;
  showControlHierarchy?: boolean;
  showProvenance?: boolean;
}) {
  if (hseRiskViewModel) {
    return (
      <ReadableSceneRiskPanel risk={risk} vm={hseRiskViewModel} showProvenance={showProvenance} />
    );
  }

  const allRisks = [...(risk.sceneRisks ?? [])].sort(
    (a, b) =>
      riskLevelRank(normalizeRiskLevel(b.risk_level, b.risk_color)) -
        riskLevelRank(normalizeRiskLevel(a.risk_level, a.risk_color)) ||
      (b.risk_score ?? 0) - (a.risk_score ?? 0),
  );
  const unmatchedRisks = (risk.unmatchedRisks ?? []).filter(
    (item) => item.risk_association === "unmatched" || !item.linked_entity_id,
  );
  const associatedRisks = allRisks.filter((item) => item.risk_association !== "unmatched");
  const summary = risk.riskSummary;
  const highest = summary?.highest_level ?? highestRiskLevel(allRisks);
  const alertingCount =
    summary?.alerting_count ?? allRisks.filter((item) => item.should_alert === true).length;
  const reasonerLabel = reasonerStatusLabel(risk.reasonerStatus);
  const resolvingAnchors = (risk.riskAnchors ?? []).filter(
    (anchor) => anchor.status === "resolving",
  );
  const staleAnchors = (risk.riskAnchors ?? []).filter(
    (anchor) => anchor.stale && anchor.status !== "resolving",
  );

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
            {highest ?? "-"}
          </span>
          {alertingCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-200">
              <AlertTriangle className="h-3 w-3" />
              {alertingCount}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-1.5 text-[10px] text-muted-foreground">
        <div>
          risks: <span className="text-foreground">{allRisks.length}</span>
          {summary?.total != null ? ` | total ${summary.total}` : ""}
          {summary?.by_level ? ` | by level ${compactValue(summary.by_level)}` : ""}
        </div>
        {reasonerLabel && (
          <div className={isReasonerUnavailable(risk.reasonerStatus) ? "text-amber-300" : ""}>
            reasoner: <span className="text-foreground">{reasonerLabel}</span>
          </div>
        )}
        {risk.sceneContext !== undefined && (
          <div className="truncate" title={compactValue(risk.sceneContext)}>
            scene: {compactValue(risk.sceneContext)}
          </div>
        )}
        {risk.temporalReasoning !== undefined && (
          <div className="truncate" title={compactValue(risk.temporalReasoning)}>
            temporal: {compactValue(risk.temporalReasoning)}
          </div>
        )}
      </div>

      {associatedRisks.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No active entity-linked scene risks.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {associatedRisks.map((item, index) => (
            <RiskRow
              key={item.risk_id ?? item.track_id ?? item.detection_id ?? index}
              risk={item}
              showControlHierarchy={showControlHierarchy}
              showProvenance={showProvenance}
            />
          ))}
        </ul>
      )}

      {unmatchedRisks.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="console-eyebrow">Unmatched risks</p>
          <ul className="mt-2 space-y-2">
            {unmatchedRisks.map((item, index) => (
              <RiskRow
                key={item.risk_id ?? item.track_id ?? item.detection_id ?? index}
                risk={item}
                showControlHierarchy={showControlHierarchy}
                showProvenance={showProvenance}
                unmatched
              />
            ))}
          </ul>
        </div>
      )}

      {resolvingAnchors.length > 0 && (
        <div className="mt-3 rounded-lg border border-yellow-300/20 bg-yellow-300/10 p-2 text-[10px] text-yellow-100">
          <p className="font-semibold">Resolving risk color</p>
          <p className="mt-0.5">
            The matched YELLOW hazard is no longer confirmed, so the box is dashed/faded and will
            clear shortly.
          </p>
          <ul className="mt-1 list-disc pl-4">
            {resolvingAnchors.map((anchor) => (
              <li key={anchor.riskId}>{anchorLine(anchor)}</li>
            ))}
          </ul>
        </div>
      )}

      {staleAnchors.length > 0 && (
        <div className="mt-3 text-[10px] text-muted-foreground">
          <p className="console-eyebrow">Carried anchors</p>
          <ul className="mt-1 list-disc pl-4">
            {staleAnchors.map((anchor) => (
              <li key={anchor.riskId}>{anchorLine(anchor)}</li>
            ))}
          </ul>
        </div>
      )}

      <CorrectionList corrections={risk.semanticCorrections ?? []} />
      <CorrectionList corrections={risk.unmatchedCorrections ?? []} title="Unmatched corrections" />
    </div>
  );
}

/** A clear, non-blocking banner shown when the worker reports degraded
 * monitoring. Never covers the camera; sits in the panel column. */
export function MonitoringDegradedBanner() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
      <span>Monitoring degraded - some risk signals may be reduced. Detection continues.</span>
    </div>
  );
}

/** Risk-aware debug/status readout (feature-flagged by VITE_RISK_DEBUG_PANEL).
 * Diagnostics only, never blocks the camera. */
export function RiskDebugPanel({ risk }: { risk: ParsedDetectRisk }) {
  const reasonerLabel = reasonerStatusLabel(risk.reasonerStatus);
  const reasonerUnavailable = isReasonerUnavailable(risk.reasonerStatus);
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-1 font-semibold">risk engine</div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          schema: <span className="text-foreground">{String(risk.schemaVersion ?? "-")}</span> |
          engine: {risk.riskEngine ?? "-"}
        </div>
        <div>
          risk: {String(risk.riskEnabled ?? "-")} | tracking: {String(risk.trackingEnabled ?? "-")}{" "}
          | scene-graph: {String(risk.sceneGraphEnabled ?? "-")}
        </div>
        <div>
          degraded:{" "}
          <span className={risk.degraded ? "text-amber-400" : "text-foreground"}>
            {String(risk.degraded)}
          </span>
          {risk.degradationMode ? ` | mode: ${risk.degradationMode}` : ""}
        </div>
        <div>privacy blur applied: {String(risk.privacyBlurApplied ?? "-")}</div>
        {reasonerUnavailable && (
          <div className="text-amber-400">AI unavailable: {reasonerLabel ?? "unavailable"}</div>
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
 * VITE_CAMERA_PRIVACY_NOTICE). Additive, non-blocking. */
export function CameraPrivacyNotice() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-md bg-black/55 px-2 py-1 text-[9px] font-medium text-white/80 backdrop-blur">
      Camera frames are processed for safety monitoring only.
    </div>
  );
}
