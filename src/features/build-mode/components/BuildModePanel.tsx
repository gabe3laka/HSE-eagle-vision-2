import { CircleDot, Hammer, Hand, Loader2, ScanSearch, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlueprintReplayControls } from "../hooks/useBlueprintReplay";
import type { BuildModeSession } from "../hooks/useBuildModeSession";
import type { BuildBackendStatus } from "../types";
import { BlueprintTimeline } from "./BlueprintTimeline";

/** Short chip label for the resolved Build Mode backend. */
const BACKEND_STATUS: Record<BuildBackendStatus, { label: string; live: boolean }> = {
  resolving: { label: "resolving…", live: false },
  cloudflare: { label: "Cloudflare", live: true },
  "supabase-cloudflare": { label: "Supabase config → Cloudflare", live: true },
  "mock-fallback": { label: "local mock fallback", live: false },
  "config-missing": { label: "config missing", live: false },
};

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
  const { phase, frameCount, backendStatus, error } = session;
  const backend = BACKEND_STATUS[backendStatus];
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Hammer className="h-4 w-4 text-cyan-400" />
          Build Mode
          <span
            title="Build backend"
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              backend.live ? "bg-cyan-500/15 text-cyan-300" : "bg-muted/40 text-muted-foreground"
            }`}
          >
            {backend.label}
          </span>
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
            Drag a box around the object you want to blueprint.
          </p>
          <Button size="sm" variant="secondary" onClick={session.cancelSelection}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "selected" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-cyan-200">
            Object selected. Pinch inside the glowing box to pull out the blueprint (or touch-drag
            it).
          </p>
          <Button size="sm" variant="secondary" onClick={session.beginSelection}>
            <Undo2 className="mr-1.5 h-4 w-4" />
            Re-select
          </Button>
        </div>
      )}

      {phase === "extracting" && (
        <div className="mt-2 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
          <p className="text-xs text-muted-foreground">Extracting blueprint…</p>
        </div>
      )}

      {phase === "placing" && (
        <p className="mt-2 text-xs text-cyan-200">
          Drag the blueprint away from the object. Release the pinch to pin it in place.
        </p>
      )}

      {phase === "pinned" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-cyan-200">
            Blueprint pinned. Hold your fingertip on the red Record target in the camera (the ring
            fills) to start capturing the real work steps.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={session.startProcedureRecording}>
              <CircleDot className="mr-1.5 h-4 w-4 text-red-400" />
              Record Procedure
            </Button>
            <Button size="sm" variant="secondary" onClick={session.beginSelection}>
              <Undo2 className="mr-1.5 h-4 w-4" />
              New selection
            </Button>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Recording procedure keyframes of the selected region (~3/s). Perform the work, then
            finish to build the replay.
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
              Replay shows the pinned blueprint with the recorded hand path and steps.
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
