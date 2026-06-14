import { type ReactNode, useMemo } from "react";
import { Hexagon, Pause } from "lucide-react";
import type { BuildModeSession } from "../hooks/useBuildModeSession";
import { intentLabel } from "../lib/blueprint";
import { estimatePlanConfidence } from "../lib/sceneBlueprint";
import {
  derivePlanSafetyNotes,
  planAssistantSummary,
  planConnectionState,
} from "../lib/planConsole";
import { PlanAiAssistant } from "./PlanAiAssistant";
import { PlanDetectedObjects } from "./PlanDetectedObjects";
import { PlanGoalCard } from "./PlanGoalCard";
import { PlanProgressBar } from "./PlanProgressBar";
import { PlanSafetyNotes } from "./PlanSafetyNotes";
import { PlanStepNavigator } from "./PlanStepNavigator";
import { PlanStepsOverview } from "./PlanStepsOverview";

/**
 * Plan Mode "holographic planning console" — the responsive chrome that wraps
 * the EXISTING camera card (passed in as `camera`) to match the two reference
 * mockups. It NEVER wraps or resizes the camera card's coordinate system: the
 * `<CameraView>` slot keeps its own sizing/crop math and the hologram renders
 * inside it exactly as before. This component only arranges glass panels AROUND
 * that slot:
 *
 *   mobile  : a single column — header, goal, camera (+ hologram), step card,
 *             safety + quality, progress, AI assistant.
 *   lg+     : an operator console — left rail (goal / detected objects / safety),
 *             center (the camera + floating step card), right rail (progress /
 *             steps overview), and a bottom dock (view chips · prev/pause/next ·
 *             AI assistant).
 *
 * All state comes from the session; this is presentational composition only.
 */
export function PlanConsole({
  session,
  camera,
  fallbackSafetyNote,
  fallbackQualityCheck,
}: {
  session: BuildModeSession;
  /** The existing camera card node (Live.tsx renders <CameraView> into this). */
  camera: ReactNode;
  fallbackSafetyNote?: string;
  fallbackQualityCheck?: string;
}) {
  const scene = session.sceneBlueprint;
  const goal = session.userIntent?.confirmed ? intentLabel(session.userIntent) : null;
  const generating = session.generatingPlan;
  const hasPlan = scene != null;

  const connection = planConnectionState({
    generating,
    reasoningStatus: session.reasoningStatus,
  });
  const assistantSummary = planAssistantSummary({
    generating,
    reasoningStatus: session.reasoningStatus,
    hasPlan,
  });
  const confidence = useMemo(
    () =>
      estimatePlanConfidence({ reasoningStatus: session.reasoningStatus, objects: scene?.objects }),
    [session.reasoningStatus, scene?.objects],
  );
  const safetyNotes = useMemo(
    () => derivePlanSafetyNotes(scene, { fallbackSafety: fallbackSafetyNote }),
    [scene, fallbackSafetyNote],
  );

  const activeStep = scene ? scene.assemblySteps[scene.currentStepIndex] : undefined;
  const activeObjectId = activeStep?.objectId ?? null;

  // Shared building blocks (rendered in different slots per breakpoint).
  const goalCard = <PlanGoalCard goal={goal} analyzing={generating} hasPlan={hasPlan} />;
  const detectedObjects = scene ? (
    <PlanDetectedObjects objects={scene.objects} activeObjectId={activeObjectId} />
  ) : null;
  const safety = safetyNotes.length > 0 ? <PlanSafetyNotes notes={safetyNotes} /> : null;
  const progress = scene ? (
    <PlanProgressBar
      currentIndex={scene.currentStepIndex}
      total={scene.assemblySteps.length}
      confidence={confidence}
    />
  ) : null;
  const stepsOverview = scene ? <PlanStepsOverview scene={scene} /> : null;
  const stepNavigator = scene ? (
    <PlanStepNavigator
      scene={scene}
      onPrevious={session.goToPreviousPlanStep}
      onNext={session.goToNextPlanStep}
      onReset={session.resetPlanSteps}
      fallbackSafetyNote={fallbackSafetyNote}
      fallbackQualityCheck={fallbackQualityCheck}
    />
  ) : null;
  const aiAssistant = (
    <PlanAiAssistant summary={assistantSummary} thinking={connection === "thinking"} />
  );

  return (
    <div className="space-y-3">
      <PlanConsoleHeader connection={connection} />

      {/* MOBILE / default: single stacked column. The lg console below is hidden
          on small screens. */}
      <div className="space-y-3 lg:hidden">
        {goalCard}
        {camera}
        {stepNavigator}
        {(safety || progress) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {safety}
            {progress}
          </div>
        )}
        {detectedObjects}
        {stepsOverview}
        {aiAssistant}
      </div>

      {/* lg+ : operator console. Left rail / center camera / right rail, then a
          bottom dock. The camera slot is untouched — only panels arrange around
          it. */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-[260px_minmax(0,1fr)_260px] items-start gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
          <div className="space-y-3">
            {goalCard}
            {detectedObjects}
            {safety}
          </div>
          {/* min-w-0 so the camera column can shrink without overflow. */}
          <div className="min-w-0 space-y-3">
            {camera}
            {stepNavigator}
          </div>
          <div className="space-y-3">
            {progress}
            {stepsOverview}
          </div>
        </div>

        {/* Bottom dock: view chips · transport · AI assistant. */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <PlanViewChips className="hidden xl:flex" />
          <PlanTransportDock
            onPrevious={session.goToPreviousPlanStep}
            onNext={session.goToNextPlanStep}
            onPause={session.resetPlanSteps}
            disabled={!scene}
            atFirst={!scene || scene.currentStepIndex <= 0}
            atLast={!scene || scene.currentStepIndex >= scene.assemblySteps.length - 1}
          />
          {aiAssistant}
        </div>
      </div>
    </div>
  );
}

/** Top bar: hex brand mark + EAGLE VISION, centered PLAN MODE, AI-connected. */
function PlanConsoleHeader({ connection }: { connection: "thinking" | "connected" | "idle" }) {
  const dot =
    connection === "connected"
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
      : connection === "thinking"
        ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse"
        : "bg-muted-foreground";
  const label =
    connection === "connected"
      ? "AI Connected"
      : connection === "thinking"
        ? "Thinking…"
        : "AI Idle";
  return (
    <div className="console-panel flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center text-cyan-300">
          <Hexagon className="h-8 w-8" strokeWidth={1.5} />
          <span className="absolute text-[8px] font-bold text-cyan-100">SL</span>
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">SafeLens</p>
          <p className="console-eyebrow">Eagle Vision</p>
        </div>
      </div>
      <span className="hidden rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200 sm:inline-flex">
        ● Plan Mode
      </span>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/90">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        {label}
      </span>
    </div>
  );
}

/** Bottom-dock preview chips (HOLOGRAPHIC VIEW / TOP VIEW / CONNECTION GUIDE).
 *  Static affordances for now — the holographic view is the live scene. */
function PlanViewChips({ className }: { className?: string }) {
  const chips = ["Holographic view", "Top view", "Connection guide"];
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {chips.map((c, i) => (
        <span
          key={c}
          className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
            i === 0
              ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-200"
              : "border-white/10 bg-black/20 text-muted-foreground"
          }`}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/** Centered ‹ PREVIOUS · ⏸ · NEXT STEP › transport (bottom dock, lg+). */
function PlanTransportDock({
  onPrevious,
  onNext,
  onPause,
  disabled,
  atFirst,
  atLast,
}: {
  onPrevious: () => void;
  onNext: () => void;
  onPause: () => void;
  disabled?: boolean;
  atFirst?: boolean;
  atLast?: boolean;
}) {
  return (
    <div className="console-panel flex items-center justify-center gap-2 px-3 py-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={disabled || atFirst}
        aria-label="Previous step"
        className="min-h-10 rounded-lg border border-white/10 bg-black/20 px-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/90 transition-colors hover:bg-white/5 disabled:opacity-40"
      >
        ‹ Previous
      </button>
      <button
        type="button"
        onClick={onPause}
        disabled={disabled}
        aria-label="Restart from step 1"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-foreground/90 transition-colors hover:bg-white/5 disabled:opacity-40"
      >
        <Pause className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={disabled || atLast}
        aria-label="Next step"
        className="min-h-10 rounded-lg border border-cyan-300/40 bg-cyan-400/15 px-3 text-[11px] font-semibold uppercase tracking-wide text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:opacity-40"
      >
        Next step ›
      </button>
    </div>
  );
}
