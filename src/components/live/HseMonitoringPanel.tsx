import { Check, Crosshair, Eye, Radar, ScanSearch, Sparkles, Telescope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HSE_PROFILES } from "@/lib/detection/hseDetectProfile";
import type { HSEDetectionProfile, HSESeverity } from "@/lib/detection/hseTypes";
import type { HseMonitoring } from "@/features/hse-monitoring/hooks/useHseMonitoring";

/**
 * HSE monitoring control card (below the camera, monitoring only): detection
 * profile, Far Scan / Tap-to-focus / Analyze scene, a small detection status,
 * and the de-spammed wearable alert feed with Acknowledge.
 */

const PROFILE_ORDER: HSEDetectionProfile[] = ["fast", "balanced", "far-scan", "inspection"];

const SEV_STYLE: Record<HSESeverity, { dot: string; text: string; chip: string }> = {
  info: { dot: "bg-cyan-400", text: "text-cyan-200", chip: "bg-cyan-500/15 text-cyan-300" },
  low: { dot: "bg-cyan-400", text: "text-cyan-200", chip: "bg-cyan-500/15 text-cyan-300" },
  medium: { dot: "bg-amber-400", text: "text-amber-200", chip: "bg-amber-500/15 text-amber-300" },
  high: { dot: "bg-orange-500", text: "text-orange-200", chip: "bg-orange-500/15 text-orange-300" },
  critical: { dot: "bg-red-500", text: "text-red-200", chip: "bg-red-500/20 text-red-300" },
};

interface Props {
  hse: HseMonitoring;
  focusArmed: boolean;
  onArmFocus: () => void;
}

export function HseMonitoringPanel({ hse, focusArmed, onArmFocus }: Props) {
  const lowObjects = hse.objectCount <= 1;
  const unresolvedAlerts = hse.activeAlerts.filter((a) => a.state !== "resolved");
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
        {hse.reasoningSource && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-1 text-[9px] font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            {hse.reasoningSource === "deepseek" ? "AI reasoning" : "local risk engine"}
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
          <p className="console-eyebrow">Open alerts</p>
          <p
            className={`mt-1 font-display text-xl font-semibold ${
              unresolvedAlerts.length > 0 ? "text-amber-200" : "text-slate-200"
            }`}
          >
            {unresolvedAlerts.length}
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
        <Button size="sm" variant="secondary" className="min-h-9" onClick={hse.analyzeScene}>
          <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
          Analyze scene
        </Button>
      </div>

      {/* Detection status (non-intrusive) */}
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

      {/* Wearable alert feed (de-spammed, acknowledge-able) */}
      {unresolvedAlerts.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="console-eyebrow">Priority alerts</p>
            <span className="text-[10px] text-muted-foreground">Acknowledge when handled</span>
          </div>
          <ul className="space-y-2">
            {unresolvedAlerts.slice(0, 4).map((a) => {
              const s = SEV_STYLE[a.severity];
              return (
                <li
                  key={a.key}
                  className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5"
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-semibold ${s.text}`}>{a.title}</span>
                      <span
                        className={`rounded-full px-1.5 py-px text-[8px] font-bold uppercase ${s.chip}`}
                      >
                        {a.severity}
                      </span>
                      {a.state === "acknowledged" && (
                        <span className="text-[8px] uppercase text-muted-foreground">ack’d</span>
                      )}
                    </div>
                    <p className="text-[11px] leading-snug text-white/85">{a.spokenMessage}</p>
                    {a.recommendedAction && (
                      <p className="text-[10px] text-muted-foreground">{a.recommendedAction}</p>
                    )}
                  </div>
                  {a.state !== "acknowledged" && (
                    <button
                      type="button"
                      aria-label="Acknowledge alert"
                      className="shrink-0 text-muted-foreground transition-colors hover:text-cyan-300"
                      onClick={() => hse.acknowledge(a.key)}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
