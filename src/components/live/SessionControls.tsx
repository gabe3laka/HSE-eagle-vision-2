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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-3">
      {/* Start/Stop grows to fill; the Build toggle sits beside it (shorter). */}
      <div className="flex items-center gap-2">
        {running ? (
          <Button
            onClick={onStop}
            variant="destructive"
            size="lg"
            className="flex-1 sm:w-auto sm:min-w-[160px] sm:flex-none"
          >
            <Square className="mr-2 h-4 w-4" /> Stop monitoring
          </Button>
        ) : (
          <Button
            onClick={onStart}
            size="lg"
            disabled={!cameraActive}
            className="flex-1 sm:w-auto sm:min-w-[160px] sm:flex-none"
          >
            <Play className="mr-2 h-4 w-4" /> Start monitoring
          </Button>
        )}
        {buildToggle}
      </div>
      <div className="flex items-center justify-around gap-4 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground sm:justify-start sm:border-0 sm:bg-transparent sm:p-0">
        <span className="flex items-center gap-1.5">
          <Activity className="h-4 w-4" /> {stats.frames}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4" /> {stats.alerts}
          <span className="hidden sm:inline">alerts</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Camera className="h-4 w-4" /> {stats.incidents}
          <span className="hidden sm:inline">incidents</span>
        </span>
      </div>
    </div>
  );
}
