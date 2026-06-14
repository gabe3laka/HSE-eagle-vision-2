import { useEffect, useState } from "react";
import {
  Check,
  CircleDot,
  FolderOpen,
  Hammer,
  Hand,
  Loader2,
  MessageCircle,
  Play,
  Route,
  Save,
  ScanSearch,
  Sparkles,
  Square,
  Target,
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
import { PlanInputDrawer } from "./PlanInputDrawer";
import { PlanStepNavigator } from "./PlanStepNavigator";

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
  /** Controlled "reply" drawer (so a Plan callout tap can open the goal input). */
  replyOpen?: boolean;
  onReplyOpenChange?: (open: boolean) => void;
  /** When the Plan holographic console is showing, IT owns the multi-object
   *  step navigator — suppress the panel's duplicate so the step UI isn't shown
   *  twice. The single-object guided-steps list is unaffected. */
  hideSceneNavigator?: boolean;
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
  replyOpen,
  onReplyOpenChange,
  hideSceneNavigator = false,
}: Props) {
  const { phase, frameCount, backendStatus, error } = session;
  const backend = BACKEND_STATUS[backendStatus];
  const isPlan = workflowMode === "plan";
  const buildStep =
    phase === "review"
      ? 4
      : phase === "recording" || phase === "pinned"
        ? 3
        : phase === "placing"
          ? 2
          : phase === "selected" || phase === "extracting"
            ? 1
            : 0;
  const planStep =
    session.planStage === "plan_review"
      ? 3
      : session.planStage === "plan_generating_steps" ||
          session.planStage === "plan_guiding" ||
          phase === "review"
        ? 2
        : session.planStage === "plan_waiting_for_intent"
          ? 1
          : 0;
  const currentStep = isPlan ? planStep : buildStep;
  const workflowSteps = isPlan
    ? ["Capture item", "Set goal", "Follow guide", "Review"]
    : ["Select", "Extract", "Place", "Record", "Replay"];

  // Saved blueprint procedures (owner-only via RLS) + save/load/delete.
  const { user } = useAuth();
  const { data: saved = [] } = useSavedBlueprints();
  const saveBlueprint = useSaveBlueprint();
  const deleteBlueprint = useDeleteBlueprint();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => setSaveState("idle"), [session.baseFrame]);

  // The Plan goal input drawer (fixed bottom sheet — see PlanInputDrawer). It
  // opens AUTOMATICALLY in plan_waiting_for_intent, and on demand via "Ask
  // follow-up" / "Change goal" / a floating callout's "tap to reply" (the open
  // state can be controlled by the parent so callout taps reach it).
  const [internalReplyOpen, setInternalReplyOpen] = useState(false);
  const drawerOpen = replyOpen ?? internalReplyOpen;
  const setDrawerOpen = onReplyOpenChange ?? setInternalReplyOpen;
  // Respect a manual close while waiting for the first goal (until stage changes).
  const [closedWaiting, setClosedWaiting] = useState(false);
  useEffect(() => {
    if (session.planStage !== "plan_waiting_for_intent") setClosedWaiting(false);
  }, [session.planStage]);
  const drawerVisible =
    isPlan &&
    session.planStage !== "plan_generating_steps" &&
    (drawerOpen || (session.planStage === "plan_waiting_for_intent" && !closedWaiting));
  const closeDrawer = () => {
    setDrawerOpen(false);
    if (session.planStage === "plan_waiting_for_intent") setClosedWaiting(true);
  };

  /** Free-text goal: the first goal confirms the intent; later ones are
   *  follow-ups re-reasoned over the same blueprint. Both trigger DeepSeek. */
  const handleGoalText = (text: string) => {
    if (session.planStage === "plan_waiting_for_intent") {
      void session.confirmIntent("custom", text);
    } else {
      void session.askFollowUp(text);
    }
    setDrawerOpen(false);
  };
  /** Quick-action chip (clear task type) — submits immediately. */
  const handleQuickGoal = (taskType: PlanTaskType, label: string) => {
    if (session.planStage === "plan_waiting_for_intent") {
      void session.confirmIntent(taskType);
    } else {
      void session.askFollowUp(label);
    }
    setDrawerOpen(false);
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
  const hasScenePlan = isPlan && session.sceneBlueprint != null;
  const showGuidance =
    planGuiding &&
    !hasScenePlan &&
    aiFrame != null &&
    !!(
      aiFrame.nextAction ||
      aiFrame.safetyWarning ||
      aiFrame.qualityCheck ||
      (aiFrame.planSteps?.length ?? 0) > 0
    );
  return (
    <section
      className={`console-panel overflow-hidden p-4 ${
        isPlan ? "border-violet-300/15" : "border-emerald-300/15"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 ${
              isPlan
                ? "bg-violet-400/10 text-violet-200 ring-violet-300/10"
                : "bg-emerald-400/10 text-emerald-200 ring-emerald-300/10"
            }`}
          >
            {isPlan ? <Route className="h-4 w-4" /> : <Hammer className="h-4 w-4" />}
          </span>
          <div>
            <p className="console-eyebrow">{isPlan ? "Guided workflow" : "Procedure studio"}</p>
            <span className="text-sm font-semibold">
              {isPlan ? "Plan Assistant" : "Build Studio"}
            </span>
          </div>
        </div>
        {phase === "recording" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-cyan-300">
            <CircleDot className="h-3.5 w-3.5 animate-pulse text-red-400" />
            {frameCount} keyframes
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {isPlan
          ? "Capture an item or parts, tell me the goal, and I’ll generate guided steps."
          : "Create and arrange a clean virtual blueprint, then record the procedure."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          title="Build backend"
          className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${
            backend.live ? "bg-cyan-500/10 text-cyan-200" : "bg-muted/40 text-muted-foreground"
          }`}
        >
          {backend.label}
        </span>
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

      <div
        className={`mt-4 grid gap-1.5 ${
          isPlan ? "grid-cols-4" : "grid-cols-5"
        } rounded-xl bg-black/20 p-1.5`}
      >
        {workflowSteps.map((label, index) => {
          const complete = index < currentStep;
          const activeStep = index === currentStep;
          return (
            <div
              key={label}
              className={`flex min-h-12 flex-col items-center justify-center rounded-lg px-1 text-center transition-colors ${
                activeStep
                  ? isPlan
                    ? "bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/15"
                    : "bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-300/15"
                  : complete
                    ? "text-emerald-300"
                    : "text-muted-foreground/65"
              }`}
            >
              <span className="mb-1 flex h-4 w-4 items-center justify-center rounded-full border border-current/30 text-[9px]">
                {complete ? <Check className="h-2.5 w-2.5" /> : index + 1}
              </span>
              <span className="text-[8px] font-semibold uppercase tracking-wide">{label}</span>
            </div>
          );
        })}
      </div>

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
            {isPlan
              ? "Hold pinch to capture the item for planning — or touch the box."
              : "Hold pinch to extract the blueprint — or touch the box."}
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
          <p className="text-xs text-muted-foreground">
            {isPlan ? "Capturing item for planning…" : "Extracting blueprint…"}
          </p>
        </div>
      )}

      {phase === "placing" && (
        <p className="mt-2 text-xs text-cyan-200">
          Drag/pinch the ghost into position. Release to pin it.
        </p>
      )}

      {phase === "pinned" && !isPlan && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-cyan-200">
            Blueprint pinned. Hold the red Record target to start recording.
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
            Perform the work. Hold the red Stop target to finish — or press below.
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
              {isPlan ? "Review or ask a follow-up." : "Replay and save the procedure."}
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

      {/* Plan: item captured → ask the goal (the fixed bottom drawer opens
          automatically; this slim card re-opens it if dismissed). */}
      {isPlan && session.planStage === "plan_waiting_for_intent" && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-violet-400/30 bg-violet-500/5 px-2.5 py-2">
          <p className="text-xs text-violet-100">Item captured. Tell me what you want to do.</p>
          <Button size="sm" className="shrink-0" onClick={() => setDrawerOpen(true)}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Set goal
          </Button>
        </div>
      )}

      {isPlan && session.planStage === "plan_generating_steps" && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-violet-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Thinking through selected parts and next steps…
        </div>
      )}

      {/* Confirmed goal + reasoning source + follow-up drawer. */}
      {isPlan && session.userIntent?.confirmed && session.planStage !== "plan_generating_steps" && (
        <div className="mt-3 rounded-xl border border-violet-300/20 bg-violet-400/5 p-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
              <Target className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                  Goal
                </span>
                {session.reasoningStatus === "ok" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[9px] font-semibold text-cyan-300">
                    <Sparkles className="h-3 w-3" /> AI plan
                  </span>
                )}
                {session.reasoningStatus === "fallback" && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-300">
                    Basic guide
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs font-medium leading-relaxed text-violet-50">
                {intentLabel(session.userIntent)}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={() => setDrawerOpen(true)}
            >
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
              Ask follow-up
            </Button>
            {session.planStage !== "plan_review" && (
              <Button size="sm" variant="secondary" className="h-7" onClick={session.clearIntent}>
                Change goal
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Holographic Scene Canvas: user-gated Previous/Next step navigation for
          the multi-object plan (only when a scene was built; the single-object
          plan keeps its guided-steps list below). Suppressed when the Plan
          console is showing — IT renders the navigator (no duplicate). */}
      {isPlan && planGuiding && session.sceneBlueprint && !hideSceneNavigator && (
        <PlanStepNavigator
          scene={session.sceneBlueprint}
          onPrevious={session.goToPreviousPlanStep}
          onNext={session.goToNextPlanStep}
          onReset={session.resetPlanSteps}
          fallbackSafetyNote={aiFrame?.safetyWarning}
          fallbackQualityCheck={aiFrame?.qualityCheck}
        />
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
        <details className="mt-3 rounded-xl border border-white/5 bg-black/20 p-2">
          <summary className="cursor-pointer list-none text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Build diagnostics
          </summary>
          <div className="mt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
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
        </details>
      )}

      {/* Fixed bottom goal/follow-up drawer — always on-screen when open. */}
      {isPlan && (
        <PlanInputDrawer
          open={drawerVisible}
          onOpenChange={(o) => (o ? setDrawerOpen(true) : closeDrawer())}
          stage={session.planStage}
          suggestedGoals={aiFrame?.suggestedGoals}
          thinking={session.generatingPlan}
          onSubmitText={handleGoalText}
          onQuickGoal={handleQuickGoal}
        />
      )}
    </section>
  );
}
