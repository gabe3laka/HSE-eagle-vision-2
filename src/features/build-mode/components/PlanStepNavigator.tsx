import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanSceneBlueprint } from "../types";

/**
 * User-gated navigation for the multi-object Plan scene. This component only
 * presents the current scene state; Previous, Next, and Reset remain owned by
 * the session.
 */
export function PlanStepNavigator({
  scene,
  onPrevious,
  onNext,
  onReset,
  fallbackSafetyNote,
  fallbackQualityCheck,
}: {
  scene: PlanSceneBlueprint;
  onPrevious: () => void;
  onNext: () => void;
  onReset?: () => void;
  fallbackSafetyNote?: string;
  fallbackQualityCheck?: string;
}) {
  const total = scene.assemblySteps.length;
  if (total === 0) return null;

  const index = Math.max(0, Math.min(total - 1, scene.currentStepIndex));
  const step = scene.assemblySteps[index];
  const objectCount = scene.objects.length;
  const atFirst = index <= 0;
  const atLast = index >= total - 1;
  const activeObject = step?.objectId
    ? scene.objects.find((object) => object.id === step.objectId)
    : undefined;
  const safetyNote = step?.safetyNote ?? fallbackSafetyNote;
  const qualityCheck = step?.qualityCheck ?? fallbackQualityCheck;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-violet-300/20 bg-[linear-gradient(145deg,rgba(139,92,246,0.09),rgba(6,182,212,0.04))]">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
          <Layers className="h-3 w-3" />
          {objectCount} object{objectCount === 1 ? "" : "s"} detected
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200"
          aria-live="polite"
        >
          Step {index + 1} of {total}
        </span>
      </div>

      {step && (
        <div className="space-y-3 px-3 py-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/10 text-base font-semibold text-cyan-200">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-violet-50">{step.title}</h3>
                {activeObject ? (
                  <span className="rounded-full border border-violet-300/15 bg-violet-400/10 px-2 py-0.5 text-[9px] font-medium text-violet-200">
                    {activeObject.label}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-violet-100/85">
                {step.instruction}
              </p>
            </div>
          </div>

          {(safetyNote || qualityCheck) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {safetyNote && (
                <div className="rounded-lg border border-amber-300/15 bg-amber-400/5 p-2.5">
                  <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Safety note
                  </span>
                  <p className="mt-1 text-[10px] leading-relaxed text-amber-100/80">{safetyNote}</p>
                </div>
              )}
              {qualityCheck && (
                <div className="rounded-lg border border-emerald-300/15 bg-emerald-400/5 p-2.5">
                  <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Quality check
                  </span>
                  <p className="mt-1 text-[10px] leading-relaxed text-emerald-100/80">
                    {qualityCheck}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-white/5 px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Plan progress
          </span>
          <span className="text-[10px] font-medium text-cyan-200">
            {index + 1}/{total}
          </span>
        </div>
        <ol className="mb-3 flex items-center" aria-label="Plan progress">
          {scene.assemblySteps.map((planStep, stepIndex) => {
            const completed = stepIndex < index;
            const active = stepIndex === index;
            return (
              <li key={planStep.id} className="flex min-w-0 flex-1 items-center last:flex-none">
                <span
                  title={`${stepIndex + 1}. ${planStep.title}`}
                  aria-label={`Step ${stepIndex + 1}: ${planStep.title}, ${
                    completed ? "completed" : active ? "active" : "pending"
                  }`}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    completed
                      ? "border-cyan-300/40 bg-cyan-400/20 text-cyan-100"
                      : active
                        ? "border-cyan-300 bg-cyan-400/10 text-cyan-100 ring-4 ring-cyan-400/10"
                        : "border-white/15 bg-black/15 text-muted-foreground"
                  }`}
                >
                  {completed ? <Check className="h-3 w-3" /> : stepIndex + 1}
                </span>
                {stepIndex < total - 1 && (
                  <span
                    className={`h-px min-w-2 flex-1 ${
                      completed ? "bg-cyan-300/50" : "bg-white/10"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="min-h-10 flex-1"
            onClick={onPrevious}
            disabled={atFirst}
            aria-label="Previous step"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          {onReset && (
            <Button
              size="icon"
              variant="secondary"
              className="min-h-10 min-w-10"
              onClick={onReset}
              aria-label="Restart from step 1"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="sm"
            className="min-h-10 flex-1"
            onClick={onNext}
            disabled={atLast}
            aria-label="Next step"
          >
            {atLast ? "Complete" : "Next"}
            {!atLast && <ChevronRight className="ml-1 h-4 w-4" />}
          </Button>
        </div>
        {atLast && (
          <p className="mt-2 text-center text-[10px] text-violet-200/60">
            Final step reached. Review the plan before continuing.
          </p>
        )}
      </div>
    </div>
  );
}
