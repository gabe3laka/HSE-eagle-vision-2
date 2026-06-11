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
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Radar className="h-4 w-4 text-cyan-400" />
          Eagle Vision active
          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
            {hse.profileLabel}
          </span>
        </span>
        {hse.reasoningSource && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            {hse.reasoningSource === "deepseek" ? "AI reasoning" : "local risk engine"}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {hse.sceneCaption ||
          "Scanning for HSE risks — people, vehicles, PPE, zones, and proximity."}
      </p>

      {/* Detection profile selector */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PROFILE_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            title={HSE_PROFILES[p].hint}
            aria-pressed={hse.profile === p}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
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

      {/* Far scan / focus / analyze */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" className="h-7" onClick={hse.farScan}>
          <Telescope className="mr-1.5 h-3.5 w-3.5" />
          Far Scan
        </Button>
        <Button
          size="sm"
          variant={focusArmed ? "default" : "secondary"}
          className="h-7"
          onClick={onArmFocus}
        >
          <Crosshair className="mr-1.5 h-3.5 w-3.5" />
          {focusArmed ? "Tap the camera…" : "Tap to focus"}
        </Button>
        {hse.roi && (
          <Button size="sm" variant="secondary" className="h-7" onClick={hse.clearFocus}>
            Clear focus
          </Button>
        )}
        <Button size="sm" variant="secondary" className="h-7" onClick={hse.analyzeScene}>
          <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
          Analyze scene
        </Button>
      </div>

      {/* Detection status (non-intrusive) */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
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
      {hse.activeAlerts.filter((a) => a.state !== "resolved").length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {hse.activeAlerts
            .filter((a) => a.state !== "resolved")
            .slice(0, 4)
            .map((a) => {
              const s = SEV_STYLE[a.severity];
              return (
                <li
                  key={a.key}
                  className="flex items-start gap-2 rounded-lg border border-border/50 bg-black/20 px-2.5 py-1.5"
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
      )}
    </div>
  );
}
