import { Activity, Camera, Play, ShieldAlert, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionStats } from "@/hooks/useDetectionSession";

interface Props {
  cameraActive: boolean;
  running: boolean;
  stats: SessionStats;
  onStart: () => void;
  onStop: () => void;
}

export function SessionControls({ cameraActive, running, stats, onStart, onStop }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {running ? (
        <Button onClick={onStop} variant="destructive" size="lg" className="min-w-[160px]">
          <Square className="mr-2 h-4 w-4" /> Stop monitoring
        </Button>
      ) : (
        <Button onClick={onStart} size="lg" disabled={!cameraActive} className="min-w-[160px]">
          <Play className="mr-2 h-4 w-4" /> Start monitoring
        </Button>
      )}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Activity className="h-4 w-4" /> {stats.frames}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4" /> {stats.alerts} alerts
        </span>
        <span className="flex items-center gap-1.5">
          <Camera className="h-4 w-4" /> {stats.incidents} incidents
        </span>
      </div>
    </div>
  );
}
