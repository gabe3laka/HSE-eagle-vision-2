import { CircleDot, Hammer, Hand, ScanSearch, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlueprintReplayControls } from "../hooks/useBlueprintReplay";
import type { BuildModeSession } from "../hooks/useBuildModeSession";
import { BlueprintTimeline } from "./BlueprintTimeline";

/** Status-chip states for hand control (finger > wrist > touch fallback). */
export type HandControlStatus =
  | "finger-tracking"
  | "pinch-dragging"
  | "wrist-fallback"
  | "waiting"
  | "touch-fallback";

const HAND_STATUS_LABEL: Record<HandControlStatus, string> = {
  "finger-tracking": "Hand control: finger tracking",
  "pinch-dragging": "Hand control: pinch dragging",
  "wrist-fallback": "Hand control: wrist fallback",
  waiting: "Hand control: waiting for hand",
  "touch-fallback": "Hand control: touch fallback",
};

interface Props {
  session: BuildModeSession;
  replay: BlueprintReplayControls;
  cameraActive: boolean;
  handStatus?: HandControlStatus;
}

/**
 * Build Mode control card (below the camera): drives the
 * select → record → review workflow and hosts the replay timeline.
 */
export function BuildModePanel({ session, replay, cameraActive, handStatus }: Props) {
  const { phase, frameCount, backendMode, error } = session;
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Hammer className="h-4 w-4 text-cyan-400" />
          Build Mode
          {backendMode && (
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
              {backendMode === "mock" ? "local mock" : "http backend"}
            </span>
          )}
        </span>
        {phase === "recording" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-cyan-300">
            <CircleDot className="h-3.5 w-3.5 animate-pulse text-red-400" />
            {frameCount} keyframes
          </span>
        )}
      </div>

      {handStatus && (
        <div className="mt-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              handStatus === "pinch-dragging"
                ? "bg-amber-500/15 text-amber-300"
                : handStatus === "finger-tracking" || handStatus === "wrist-fallback"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "bg-muted/40 text-muted-foreground"
            }`}
          >
            <Hand className="h-3 w-3" />
            {HAND_STATUS_LABEL[handStatus]}
          </span>
        </div>
      )}

      {phase === "idle" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Point the camera at an object or work area, then select it to create a floating
            blueprint ghost you can detach and replay. Keyframes only — no video is stored.
          </p>
          <Button size="sm" onClick={session.beginSelection} disabled={!cameraActive}>
            <ScanSearch className="mr-1.5 h-4 w-4" />
            Select object
          </Button>
          {!cameraActive && (
            <p className="text-[11px] text-muted-foreground">Enable the camera first.</p>
          )}
        </div>
      )}

      {phase === "selecting" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Drag a box on the camera around the object you want to blueprint.
          </p>
          <Button size="sm" variant="secondary" onClick={session.cancelSelection}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Recording blueprint keyframes of the selected region (~3/s). Perform the steps you want
            to capture, then finish to build the replay.
          </p>
          <Button size="sm" variant="destructive" onClick={() => void session.stopRecording()}>
            <Square className="mr-1.5 h-4 w-4" />
            Finish &amp; build replay
          </Button>
        </div>
      )}

      {phase === "review" && (
        <div className="mt-3 space-y-3">
          <BlueprintTimeline replay={replay} frameCount={frameCount} />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Drag the blueprint ghost on the camera to detach it from the real object.
            </p>
            <Button size="sm" variant="secondary" onClick={session.beginSelection}>
              <Undo2 className="mr-1.5 h-4 w-4" />
              New selection
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">build error: {error}</p>}
    </div>
  );
}
