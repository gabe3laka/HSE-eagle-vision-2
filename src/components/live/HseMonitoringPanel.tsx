import { Check, Crosshair, Eye, Radar, ScanSearch, Sparkles, Telescope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HSE_PROFILES } from "@/lib/detection/hseDetectProfile";
import type { HSEDetectionProfile } from "@/lib/detection/hseTypes";
import type { HseMonitoring } from "@/features/hse-monitoring/hooks/useHseMonitoring";
import type { HseLiveRiskViewModel, HseGroupedRisk } from "@/lib/detection/hseLiveRiskViewModel";
import { HSE_PRIORITY_RISK_LIMIT } from "@/lib/detection/hseLiveRiskViewModel";
import { riskLevelColor } from "@/lib/detection/riskTypes";

/**
 * HSE monitoring control card: detection profile, Far Scan / Tap-to-focus /
 * Analyze scene, detection status, and the cleaned Priority Scene Risks list
 * driven by the shared HseLiveRiskViewModel (top-10 grouped, evidence-supported).
 */

const PROFILE_ORDER: HSEDetectionProfile[] = ["fast", "balanced", "far-scan", "inspection"];

interface Props {
  hse: HseMonitoring;
  focusArmed: boolean;
  onArmFocus: () => void;
  viewModel?: HseLiveRiskViewModel | null;
  /** From VITE_HSE_LOCAL_ALERTS_ENABLED. Hides "Analyze scene" + local UI. */
  localAlertsEnabled?: boolean;
}

function RiskCard({ risk, onAck }: { risk: HseGroupedRisk; onAck?: () => void }) {
  const color = riskLevelColor(risk.level);
  return (
    <li className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
          style={{ background: color }}
        >
          {risk.level}
        </span>
        <span className="truncate text-xs font-semibold text-foreground">{risk.hazardLabel}</span>
        <span className="ml-auto rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
          {risk.source}
        </span>
      </div>
      {risk.anchorDisposition && risk.anchorDisposition !== "linked" && (
        <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-300/80">
          {risk.anchorDisposition.replace(/-/g, " ")}
          {risk.anchorReason ? ` — ${risk.anchorReason}` : ""}
        </p>
      )}
      {risk.linkedItem && (
        <p className="mt-1 text-[10px] text-muted-foreground/85">
          Linked item: <span className="text-foreground/90">{risk.linkedItem}</span>
        </p>
      )}
      {risk.why && (
        <p className="mt-1 text-[11px] leading-snug text-white/85">
          <span className="text-muted-foreground">Why:</span> {risk.why}
        </p>
      )}
      {risk.action && (
        <p className="mt-1 text-[11px] leading-snug text-foreground/90">
          <span className="text-muted-foreground">Action:</span> {risk.action}
        </p>
      )}
      {!risk.acknowledged && onAck && (
        <button
          type="button"
          className="mt-2 text-[10px] text-muted-foreground transition-colors hover:text-cyan-300"
          onClick={onAck}
        >
          <Check className="-mt-0.5 mr-1 inline h-3 w-3" />
          Acknowledge
        </button>
      )}
    </li>
  );
}

export function HseMonitoringPanel({
  hse,
  focusArmed,
  onArmFocus,
  viewModel,
  localAlertsEnabled = false,
}: Props) {
  const lowObjects = hse.objectCount <= 1;
  const priority = viewModel?.priorityRisks ?? [];
  const hiddenCount = viewModel?.hiddenGroupedRiskCount ?? 0;
  const totalGrouped = viewModel?.groupedRiskCount ?? priority.length;
  const reasoner = viewModel?.reasonerBadge;

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
        {reasoner && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-1 text-[9px] font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            {reasoner.label}
          </span>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {hse.sceneCaption ||
          "Scanning for HSE risks — people, vehicles, PPE, zones, and proximity."}
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
              priority.length > 0 ? "text-amber-200" : "text-slate-200"
            }`}
          >
            {priority.length}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="console-eyebrow">Detection profile</p>
          <span className="text-[10px] font-medium text-cyan-200">{hse.profileLabel}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/20 p-1.5">
          {PROFILE_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              title={HSE_PROFILES[p].hint}
              aria-pressed={hse.profile === p}
              className={`min-h-9 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                hse.profile === p
                  ? "border-cyan-300/70 bg-cyan-500/20 text-cyan-100"
                  : "border-border/60 bg-black/20 text-muted-foreground hover:bg-cyan-500/10"
              }`}
              onClick={() => hse.setProfile(p)}
            >
              {HSE_PROFILES[p].label}
            </button>
          ))}
        </div>
      </div>

      {/* Far scan / focus / analyze */}
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
          {focusArmed ? "Tap the camera…" : "Tap to focus"}
        </Button>
        {hse.roi && (
          <Button size="sm" variant="secondary" className="min-h-9" onClick={hse.clearFocus}>
            Clear focus
          </Button>
        )}
        {localAlertsEnabled ? (
          <Button size="sm" variant="secondary" className="min-h-9" onClick={hse.analyzeScene}>
            <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            Analyze scene
          </Button>
        ) : (
          <div className="col-span-1 rounded-lg border border-dashed border-white/10 bg-black/20 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground/80">
            Legacy local analysis disabled; worker/Qwen scene risks are active.
          </div>
        )}
      </div>

      {/* Detection status */}
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

      {/* Priority Scene Risks (worker/Qwen-driven, evidence-supported, top 10) */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="console-eyebrow">Priority Scene Risks</p>
          {totalGrouped > HSE_PRIORITY_RISK_LIMIT && (
            <span className="text-[10px] text-muted-foreground">
              Showing top {HSE_PRIORITY_RISK_LIMIT} of {totalGrouped} grouped scene risks
            </span>
          )}
        </div>
        {priority.length === 0 ? (
          <p className="rounded-lg border border-white/[0.05] bg-black/20 px-3 py-3 text-[11px] text-muted-foreground">
            No active scene risks.
          </p>
        ) : (
          <ul className="space-y-2">
            {priority.map((r) => (
              <RiskCard
                key={r.key}
                risk={r}
                onAck={
                  r.key.startsWith("local:")
                    ? () => hse.acknowledge(r.key.replace(/^local:/, ""))
                    : undefined
                }
              />
            ))}
          </ul>
        )}
        {hiddenCount > 0 && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/70">
            +{hiddenCount} additional grouped risk{hiddenCount === 1 ? "" : "s"} hidden.
          </p>
        )}
      </div>
    </section>
  );
}
