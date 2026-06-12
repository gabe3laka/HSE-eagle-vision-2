import { Activity, Camera, Play, ShieldAlert, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionStats } from "@/hooks/useDetectionSession";

interface Props {
  cameraActive: boolean;
  running: boolean;
  stats: SessionStats;
  onStart: () => void;
  onStop: () => void;
  /** Optional compact Build Mode toggle, shown to the RIGHT of Start/Stop. */
  buildToggle?: React.ReactNode;
}

export function SessionControls({
  cameraActive,
  running,
  stats,
  onStart,
  onStop,
  buildToggle,
}: Props) {
  return (
    <section className="live-action-dock">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="console-eyebrow">Primary controls</p>
          <p className="text-xs text-muted-foreground">
            {running ? "Live analysis is active" : "Choose a workflow, then begin"}
          </p>
        </div>
        <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-300" /> {stats.frames} frames
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-300" /> {stats.alerts} alerts
          </span>
          <span className="flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5 text-violet-300" /> {stats.incidents} incidents
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-stretch gap-2">
        {running ? (
          <Button
            onClick={onStop}
            variant="destructive"
            size="lg"
            className="min-h-12 flex-1 rounded-xl sm:min-w-[190px] sm:flex-none"
          >
            <Square className="mr-2 h-4 w-4" /> Stop monitoring
          </Button>
        ) : (
          <Button
            onClick={onStart}
            size="lg"
            disabled={!cameraActive}
            className="min-h-12 flex-1 rounded-xl sm:min-w-[190px] sm:flex-none"
          >
            <Play className="mr-2 h-4 w-4" /> Start monitoring
          </Button>
        )}
        {buildToggle}
      </div>

      <div className="mt-3 flex items-center justify-around gap-4 border-t border-white/5 pt-3 text-xs text-muted-foreground sm:hidden">
        <span className="flex items-center gap-1.5">
          <Activity className="h-4 w-4" /> {stats.frames}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4" /> {stats.alerts} alerts
        </span>
        <span className="flex items-center gap-1.5">
          <Camera className="h-4 w-4" /> {stats.incidents} saved
        </span>
      </div>
    </section>
  );
}
