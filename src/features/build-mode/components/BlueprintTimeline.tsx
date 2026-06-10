import { Pause, Play, Rewind, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlueprintReplayControls } from "../hooks/useBlueprintReplay";

const SKIP_MS = 2000;

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Replay transport for the blueprint keyframe timeline: play/pause, rewind,
 * ±2s skip and a scrubber. Drives JSON keyframes — there is no video file.
 */
export function BlueprintTimeline({
  replay,
  frameCount,
}: {
  replay: BlueprintReplayControls;
  frameCount: number;
}) {
  const disabled = frameCount === 0 || replay.durationMs <= 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8"
          onClick={replay.rewind}
          disabled={disabled}
          aria-label="Rewind"
        >
          <Rewind className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8"
          onClick={() => replay.skip(-SKIP_MS)}
          disabled={disabled}
          aria-label="Back 2 seconds"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          className="h-8 w-8"
          onClick={replay.toggle}
          disabled={disabled}
          aria-label={replay.playing ? "Pause" : "Play"}
        >
          {replay.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8"
          onClick={() => replay.skip(SKIP_MS)}
          disabled={disabled}
          aria-label="Forward 2 seconds"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {fmt(replay.playheadMs)} / {fmt(replay.durationMs)} · {frameCount} keyframes
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-cyan-400"
        min={0}
        max={Math.max(1, replay.durationMs)}
        step={50}
        value={Math.round(replay.playheadMs)}
        disabled={disabled}
        onChange={(e) => replay.seek(Number(e.target.value))}
        aria-label="Scrub blueprint timeline"
      />
    </div>
  );
}
