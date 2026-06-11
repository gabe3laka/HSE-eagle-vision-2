import { useEffect, useState } from "react";
import {
  CircleDot,
  FolderOpen,
  Hammer,
  Hand,
  Loader2,
  Play,
  Route,
  Save,
  ScanSearch,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import type { BlueprintReplayControls } from "../hooks/useBlueprintReplay";
import type { BuildModeSession } from "../hooks/useBuildModeSession";
import {
  useDeleteBlueprint,
  useSaveBlueprint,
  useSavedBlueprints,
} from "../hooks/useSavedBlueprints";
import { intentLabel } from "../lib/blueprint";
import { serializeBlueprintSave } from "../lib/sourceAssets";
import { compressImageB64 } from "../lib/thumbnail";
import type { BlueprintWorkflowMode, BuildBackendStatus, PlanTaskType } from "../types";
import { BlueprintTimeline } from "./BlueprintTimeline";

/** Quick goal options shown after a Plan blueprint is extracted. */
const TASK_OPTIONS: Array<{ value: PlanTaskType; label: string }> = [
  { value: "identify", label: "Identify this" },
  { value: "inspect", label: "Inspect it" },
  { value: "repair", label: "Repair it" },
  { value: "build", label: "Build / assemble" },
  { value: "clean", label: "Clean it" },
  { value: "install-remove", label: "Install / remove" },
  { value: "troubleshoot", label: "Troubleshoot" },
  { value: "custom", label: "Custom task" },
];

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

/** On-phone extraction diagnostics — makes any silent failure visible. */
export interface BuildDebugInfo {
  phase: string;
  hasRegion: boolean;
  hasBaseFrame: boolean;
  hasGhostFrame: boolean;
  extractStatus: string;
  pointer: { x: number; y: number } | null;
  pointerInsideRegion: boolean;
  pinchActive: boolean;
  candidateCount: number;
  candidateUnderPinch: boolean;
  candidateLabel: string | null;
}

interface Props {
  session: BuildModeSession;
  replay: BlueprintReplayControls;
  cameraActive: boolean;
  /** Detection loop running — extractable candidates only exist while /detect flows. */
  monitoringRunning?: boolean;
  /** One-tap "Start detection for Build" (camera + monitoring). */
  onStartDetection?: () => void;
  /** Live extractable candidates currently on screen. */
  candidateCount?: number;
  handStatus?: HandControlStatus;
  debug?: BuildDebugInfo;
  /** Build = record/document; Plan = guided work. Same engine, same panel. */
  workflowMode?: BlueprintWorkflowMode;
}

/**
 * Build/Plan control card (below the camera): drives the
 * detect → pinch-extract → pin → record → review workflow, and surfaces the
 * AI guidance carried on the latest blueprint frame (intent / next action /
 * safety / guided plan steps).
 */
export function BuildModePanel({
  session,
  replay,
  cameraActive,
  monitoringRunning,
  onStartDetection,
  candidateCount = 0,
  handStatus,
  debug,
  workflowMode = "build",
}: Props) {
  const { phase, frameCount, backendStatus, error } = session;
  const backend = BACKEND_STATUS[backendStatus];
  const isPlan = workflowMode === "plan";

  // Saved blueprint procedures (owner-only via RLS) + save/load/delete.
  const { user } = useAuth();
  const { data: saved = [] } = useSavedBlueprints();
  const saveBlueprint = useSaveBlueprint();
  const deleteBlueprint = useDeleteBlueprint();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => setSaveState("idle"), [session.baseFrame]);
  /** Free-text goal for Plan mode's "custom task" path. */
  const [customText, setCustomText] = useState("");
  const submitCustom = () => {
    const text = customText.trim();
    if (!text) return;
    void session.confirmIntent("custom", text);
    setCustomText("");
  };

  const handleSave = async () => {
    const { region, baseFrame, frames, placement } = session;
    if (!region || !baseFrame || saveState === "saving") return;
    setSaveState("saving");
    try {
      // Saved form: geometry + notes + replay JSON only; the object image
      // shrinks to one compressed thumbnail (never per-frame images).
      const asset = session.getAsset(baseFrame.sourceAssetId);
      const thumbnailB64 = asset?.imageB64 ? await compressImageB64(asset.imageB64) : null;
      const stamp = new Date().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      await saveBlueprint.mutateAsync(
        serializeBlueprintSave({
          name: `${session.extractSource?.label || (isPlan ? "Plan" : "Build")} — ${stamp}`,
          workflowMode,
          backendMode: session.backendMode,
          region,
          placement,
          baseFrame,
          frames,
          sourceAsset: asset,
          thumbnailB64,
        }),
      );
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const saveButton = (
    <Button size="sm" variant="secondary" onClick={() => void handleSave()} disabled={!user}>
      <Save className="mr-1.5 h-4 w-4" />
      {saveState === "saving"
        ? "Saving…"
        : saveState === "saved"
          ? "Saved ✓"
          : saveState === "error"
            ? "Save failed — retry"
            : "Save blueprint"}
    </Button>
  );

  // AI guidance comes with each blueprint frame (mock or backend) — show the
  // freshest one from extraction onward. In Plan mode it is GATED on the user
  // confirming a goal first (no generic guidance before intent).
  const aiFrame = session.latestFrame ?? session.baseFrame;
  const planGuiding =
    !isPlan || session.planStage === "plan_guiding" || session.planStage === "plan_review";
  const showGuidance =
    planGuiding &&
    aiFrame != null &&
    !!(
      aiFrame.nextAction ||
      aiFrame.safetyWarning ||
      aiFrame.qualityCheck ||
      (aiFrame.planSteps?.length ?? 0) > 0
    );
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          {isPlan ? (
            <Route className="h-4 w-4 text-cyan-400" />
          ) : (
            <Hammer className="h-4 w-4 text-cyan-400" />
          )}
          {isPlan ? "Plan Mode" : "Build Mode"}
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
          {!monitoringRunning ? (
            <>
              <p className="text-xs text-cyan-200">
                Start monitoring to detect extractable objects — detected boxes are the blueprint
                source.
              </p>
              <Button size="sm" onClick={onStartDetection}>
                <Play className="mr-1.5 h-4 w-4" />
                Start detection for Build
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {candidateCount > 0
                ? `${candidateCount} extractable object${candidateCount === 1 ? "" : "s"} detected. Hold a pinch on a highlighted box for 4 seconds (the mini clock fills) to pull out its blueprint${isPlan ? " and start the guided steps" : ""}.`
                : "Scanning… point the camera at an object. Detected boxes become pinch-extractable."}
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={session.beginSelection}
            disabled={!cameraActive}
          >
            <ScanSearch className="mr-1.5 h-4 w-4" />
            Select object manually
          </Button>
          {!cameraActive && (
            <p className="text-[11px] text-muted-foreground">Enable the camera first.</p>
          )}

          {/* Saved procedures: load one back into the live session, or delete. */}
          {user && saved.length > 0 && (
            <div className="space-y-1 border-t border-border/60 pt-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                Saved blueprints ({saved.length})
              </span>
              <ul className="space-y-1">
                {saved.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate" title={b.name}>
                      {b.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-cyan-300">
                      {b.workflowMode}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 font-medium text-cyan-300 transition-colors hover:text-cyan-100"
                      onClick={() => session.loadSavedBlueprint(b)}
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => deleteBlueprint.mutate(b.id)}
                      aria-label={`Delete blueprint ${b.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
            Object selected. Hold a pinch inside the glowing box for 4 seconds (the clock fills) to
            pull out the blueprint — or touch-drag it.
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
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={session.startProcedureRecording}>
              <CircleDot className="mr-1.5 h-4 w-4 text-red-400" />
              Record Procedure
            </Button>
            <Button size="sm" variant="secondary" onClick={session.beginSelection}>
              <Undo2 className="mr-1.5 h-4 w-4" />
              New selection
            </Button>
            {saveButton}
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Recording procedure keyframes of the selected region (~3/s). Perform the work, then hold
            your fingertip on the red Stop target in the camera — or press below.
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              Replay shows the pinned blueprint with the recorded hand path and steps.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {saveButton}
              <Button size="sm" variant="secondary" onClick={session.beginSelection}>
                <Undo2 className="mr-1.5 h-4 w-4" />
                New selection
              </Button>
            </div>
          </div>
          {!user && (
            <p className="text-[10px] text-muted-foreground">Sign in to save blueprints.</p>
          )}
        </div>
      )}

      {/* Plan intent capture: after the ghost appears, ask the goal BEFORE
          guiding (no generic guidance until confirmed). */}
      {isPlan && session.planStage === "plan_waiting_for_intent" && (
        <div className="mt-2 space-y-2 rounded-lg border border-violet-400/30 bg-violet-500/5 px-2.5 py-2">
          <p className="text-xs font-medium text-violet-100">
            What do you want to do with this item?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TASK_OPTIONS.map((opt) =>
              opt.value === "custom" ? null : (
                <button
                  key={opt.value}
                  type="button"
                  className="rounded-full border border-violet-300/40 bg-black/30 px-2.5 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/25"
                  onClick={() => void session.confirmIntent(opt.value)}
                >
                  {opt.label}
                </button>
              ),
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCustom();
              }}
              placeholder="…or type a goal, e.g. “How do I assemble these?”"
              className="min-w-0 flex-1 rounded-md border border-violet-300/30 bg-black/40 px-2 py-1 text-[11px] text-violet-50 placeholder:text-violet-300/40 focus:border-violet-300/60 focus:outline-none"
            />
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={submitCustom}
              disabled={!customText.trim()}
            >
              Ask
            </Button>
          </div>
        </div>
      )}
      {isPlan && session.planStage === "plan_generating_steps" && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-violet-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating guided steps for “{intentLabel(session.userIntent)}”…
        </div>
      )}
      {isPlan && session.userIntent?.confirmed && session.planStage !== "plan_generating_steps" && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-violet-200">
          <span>
            Goal: <span className="font-medium capitalize">{intentLabel(session.userIntent)}</span>
          </span>
          <button
            type="button"
            className="text-violet-300/70 underline-offset-2 hover:underline"
            onClick={session.clearIntent}
          >
            change
          </button>
        </p>
      )}

      {/* AI guidance carried on the blueprint frames: detected intent, the
          suggested next action (updates while working), safety/quality notes
          and — in Plan mode — the guided step list. */}
      {showGuidance && aiFrame && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-2">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
            <span>{isPlan ? "Guided steps" : "AI notes"}</span>
            {aiFrame.activityLabel && (
              <span className="font-normal normal-case text-muted-foreground">
                {aiFrame.activityLabel}
              </span>
            )}
          </div>
          {aiFrame.detectedIntent && (
            <p className="text-[11px] text-muted-foreground">Intent: {aiFrame.detectedIntent}</p>
          )}
          {aiFrame.safetyWarning && (
            <p className="text-[11px] font-medium text-red-400">⚠ {aiFrame.safetyWarning}</p>
          )}
          {aiFrame.nextAction && (
            <p className="text-[11px] text-amber-300">▶ Next: {aiFrame.nextAction}</p>
          )}
          {aiFrame.qualityCheck && (
            <p className="text-[11px] text-emerald-300">✓ Check: {aiFrame.qualityCheck}</p>
          )}
          {aiFrame.planSteps && aiFrame.planSteps.length > 0 && (
            <ol className="space-y-0.5">
              {aiFrame.planSteps.map((s, i) => (
                <li
                  key={s.id}
                  className={`flex items-start gap-1.5 text-[11px] ${
                    s.status === "active"
                      ? "font-medium text-cyan-200"
                      : s.status === "completed"
                        ? "text-muted-foreground line-through"
                        : "text-muted-foreground"
                  }`}
                >
                  <span>{s.status === "completed" ? "✓" : `${i + 1}.`}</span>
                  <span>
                    {s.title}
                    {s.status === "active" ? ` — ${s.instruction}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">build error: {error}</p>}

      {/* TEMP debug readout — makes extraction failures obvious on the phone. */}
      {debug && (
        <div className="mt-2 rounded bg-black/40 px-2 py-1 font-mono text-[9px] leading-relaxed text-muted-foreground">
          phase {debug.phase} · region {debug.hasRegion ? "yes" : "no"} · base{" "}
          {debug.hasBaseFrame ? "yes" : "no"} · ghost {debug.hasGhostFrame ? "yes" : "no"}
          <br />
          extract: <span className="text-cyan-300">{debug.extractStatus}</span> · pinch{" "}
          {debug.pinchActive ? "ON" : "off"} · inside{" "}
          {debug.pointerInsideRegion ? <span className="text-cyan-300">yes</span> : "no"} · ptr{" "}
          {debug.pointer ? `${debug.pointer.x.toFixed(2)},${debug.pointer.y.toFixed(2)}` : "—"}
          <br />
          candidates {debug.candidateCount} · under pinch{" "}
          {debug.candidateUnderPinch ? <span className="text-cyan-300">yes</span> : "no"} · label{" "}
          {debug.candidateLabel ?? "—"}
        </div>
      )}
    </div>
  );
}
