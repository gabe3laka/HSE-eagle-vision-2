import {
  Check,
  Crosshair,
  Eye,
  Radar,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  Telescope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HSE_PROFILES } from "@/lib/detection/hseDetectProfile";
import type { HSEDetectionProfile } from "@/lib/detection/hseTypes";
import type { HseMonitoring } from "@/features/hse-monitoring/hooks/useHseMonitoring";
import {
  HSE_PRIORITY_RISK_LIMIT,
  type HseLiveRiskViewModel,
  type HsePriorityRisk,
} from "@/lib/detection/hseLiveRiskViewModel";
import { riskLevelColor } from "@/lib/detection/riskTypes";
import { readRiskFeatureFlags } from "@/lib/featureFlags";

const PROFILE_ORDER: HSEDetectionProfile[] = ["fast", "balanced", "far-scan", "inspection"];

function linkedText(risk: HsePriorityRisk): string | null {
  if (risk.linkedLabels.length > 1) return `${risk.linkedLabels.length} linked items`;
  if (risk.itemCount > 1) return `${risk.itemCount} items`;
  if (risk.linkedLabels[0]) return `Linked item: ${risk.linkedLabels[0]}`;
  if (risk.linkedTrackIds[0]) return `Linked: ${risk.linkedTrackIds[0]}`;
  return null;
}

function reasonerToneClass(tone?: HseLiveRiskViewModel["reasonerBadge"]["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-emerald-400/10 text-emerald-200";
    case "warning":
      return "bg-amber-400/10 text-amber-200";
    case "error":
      return "bg-red-400/10 text-red-200";
    case "info":
      return "bg-cyan-400/10 text-cyan-200";
    default:
      return "bg-white/[0.04] text-muted-foreground";
  }
}

interface Props {
  hse: HseMonitoring;
  focusArmed: boolean;
  onArmFocus: () => void;
  hseRiskViewModel?: HseLiveRiskViewModel;
  onAcknowledgeSceneRisk?: (key: string) => void;
}

export function HseMonitoringPanel({
  hse,
  focusArmed,
  onArmFocus,
  hseRiskViewModel,
  onAcknowledgeSceneRisk,
}: Props) {
  const lowObjects = hse.objectCount <= 1;
  const priorityRisks = hseRiskViewModel?.priorityRisks ?? [];
  const reasonerBadge = hseRiskViewModel?.reasonerBadge;
  const sceneRiskCount = hseRiskViewModel?.groupedRiskCount ?? priorityRisks.length;
  const rawRiskCount = hseRiskViewModel?.rawRiskCount ?? 0;
  const useLocalFallback = hseRiskViewModel?.shouldUseLocalFallback === true;
  const { hseLocalAlertsEnabled } = readRiskFeatureFlags();

  return (
    <section className="console-panel overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-300/10">
            <Radar className="h-4 w-4" />
          </span>
          <div>
            <p className="console-eyebrow">Active mode</p>
            <span className="text-sm font-semibold">Eagle Vision monitoring</span>
          </div>
        </div>
        {reasonerBadge ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium ${reasonerToneClass(reasonerBadge.tone)}`}
          >
            <Sparkles className="h-3 w-3" />
            {reasonerBadge.label}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {hse.sceneCaption ||
          "Scanning for HSE risks - people, vehicles, PPE, zones, and proximity."}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="metric-card p-2.5">
          <p className="console-eyebrow">Objects</p>
          <p className="mt-1 font-display text-xl font-semibold text-cyan-100">{hse.objectCount}</p>
        </div>
        <div className="metric-card p-2.5">
          <p className="console-eyebrow">Stable tracks</p>
          <p className="mt-1 font-display text-xl font-semibold text-emerald-200">
            {hse.stableCount}
          </p>
        </div>
        <div className="metric-card p-2.5">
          <p className="console-eyebrow">Scene risks</p>
          <p
            className={`mt-1 font-display text-xl font-semibold ${
              sceneRiskCount > 0 ? "text-amber-200" : "text-slate-200"
            }`}
          >
            {sceneRiskCount}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="console-eyebrow">Detection profile</p>
          <span className="text-[10px] font-medium text-cyan-200">{hse.profileLabel}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/20 p-1.5">
          {PROFILE_ORDER.map((profile) => (
            <button
              key={profile}
              type="button"
              title={HSE_PROFILES[profile].hint}
              aria-pressed={hse.profile === profile}
              className={`min-h-9 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                hse.profile === profile
                  ? "border-cyan-300/70 bg-cyan-500/20 text-cyan-100"
                  : "border-border/60 bg-black/20 text-muted-foreground hover:bg-cyan-500/10"
              }`}
              onClick={() => hse.setProfile(profile)}
            >
              {HSE_PROFILES[profile].label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" className="min-h-9" onClick={hse.farScan}>
          <Telescope className="mr-1.5 h-3.5 w-3.5" />
          Far Scan
        </Button>
        <Button
          size="sm"
          variant={focusArmed ? "default" : "secondary"}
          className="min-h-9"
          onClick={onArmFocus}
        >
          <Crosshair className="mr-1.5 h-3.5 w-3.5" />
          {focusArmed ? "Tap the camera..." : "Tap to focus"}
        </Button>
        {hse.roi && (
          <Button size="sm" variant="secondary" className="min-h-9" onClick={hse.clearFocus}>
            Clear focus
          </Button>
        )}
        {hseLocalAlertsEnabled ? (
          <Button size="sm" variant="secondary" className="min-h-9" onClick={hse.analyzeScene}>
            <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            Analyze scene
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="min-h-9 opacity-60"
            disabled
            title="Legacy local analysis disabled; worker/Qwen scene risks are active."
          >
            <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            Analyze scene
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 pt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Eye className="h-3 w-3" />{" "}
          {hse.backendName === "yolo26" ? "YOLO26" : (hse.backendName ?? "vision")} detected{" "}
          {hse.objectCount}
        </span>
        <span>Tracking {hse.stableCount} stable</span>
        {hse.fallbackActive && <span className="text-amber-400">EdgeCrafter fallback active</span>}
        {lowObjects && <span className="text-cyan-300">Try Far Scan for distant objects</span>}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="console-eyebrow">Priority scene risks</p>
          <span className="text-[10px] text-muted-foreground">
            {rawRiskCount > sceneRiskCount && sceneRiskCount > 0
              ? `${sceneRiskCount} grouped from ${rawRiskCount} raw`
              : "Acknowledge card when handled"}
          </span>
        </div>
        {useLocalFallback && (
          <p className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2.5 py-1.5 text-[10px] text-amber-100">
            Using local fallback alerts - worker scene risk unavailable.
          </p>
        )}
        {priorityRisks.length === 0 ? (
          <p className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5 text-xs text-muted-foreground">
            No active scene risks.
          </p>
        ) : (
          <ul className="space-y-2">
            {priorityRisks.map((risk) => {
              const color = riskLevelColor(risk.level);
              const linked = linkedText(risk);
              return (
                <li
                  key={risk.key}
                  className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5"
                  style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                    <ShieldAlert className="h-3.5 w-3.5" style={{ color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-white/90">{risk.title}</span>
                      <span
                        className="rounded-full px-1.5 py-px text-[8px] font-bold uppercase text-black"
                        style={{ background: color }}
                      >
                        {risk.level}
                      </span>
                      <span className="rounded-full bg-white/[0.05] px-1.5 py-px text-[8px] font-semibold text-muted-foreground">
                        {risk.sourceLabel}
                      </span>
                      {risk.isResolving && (
                        <span className="text-[8px] font-semibold uppercase text-yellow-200">
                          clearing
                        </span>
                      )}
                    </div>
                    {linked && <p className="mt-0.5 text-[10px] text-cyan-100/80">{linked}</p>}
                    {risk.reason && (
                      <p className="mt-1 text-[11px] leading-snug text-white/85">{risk.reason}</p>
                    )}
                    {risk.primaryAction && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Action: {risk.primaryAction}
                      </p>
                    )}
                  </div>
                  {onAcknowledgeSceneRisk && (
                    <button
                      type="button"
                      aria-label="Acknowledge scene risk"
                      className="shrink-0 text-muted-foreground transition-colors hover:text-cyan-300"
                      onClick={() => onAcknowledgeSceneRisk(risk.key)}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {sceneRiskCount > HSE_PRIORITY_RISK_LIMIT && priorityRisks.length > 0 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Showing top {HSE_PRIORITY_RISK_LIMIT} of {sceneRiskCount} grouped scene risks
          </p>
        )}
      </div>
    </section>
  );
}
