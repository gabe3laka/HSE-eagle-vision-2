import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  MoveRight,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanSceneBlueprint } from "../types";

/**
 * User-gated navigation for the multi-object Plan scene, styled as the mockup's
 * floating "STEP N OF M" card + Previous · Restart · Next STEP dock. This
 * component only PRESENTS the current scene state; Previous, Next, and Reset
 * remain owned by the session (no logic moved here).
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
  const atFirst = index <= 0;
  const atLast = index >= total - 1;
  const activeObject = step?.objectId
    ? scene.objects.find((object) => object.id === step.objectId)
    : undefined;
  const moves = !!(activeObject?.target || step?.to);
  const safetyNote = step?.safetyNote ?? fallbackSafetyNote;
  const qualityCheck = step?.qualityCheck ?? fallbackQualityCheck;

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-300/25 bg-[linear-gradient(150deg,rgba(34,211,238,0.1),rgba(6,18,32,0.6))] shadow-[0_0_24px_-12px_rgba(34,211,238,0.6)]">
      {/* Step header — "STEP N OF M" + a next chevron affordance. */}
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2.5">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300"
          aria-live="polite"
        >
          Step {index + 1} of {total}
        </span>
        {!atLast && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next step"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-300/40 text-cyan-200 transition-colors hover:bg-cyan-400/15"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {step && (
        <div className="space-y-3 px-3 py-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-400/15 text-base font-semibold text-cyan-100 ring-2 ring-cyan-400/15">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                {activeObject ? (
                  <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[9px] font-medium text-amber-200">
                    {activeObject.label}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {step.instruction}
              </p>
              {/* Move mini-diagram (from → to) when this step relocates a part. */}
              {moves && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-300/20 bg-amber-400/5 px-2 py-1 text-[9px] font-medium text-amber-200">
                  <span className="h-2 w-2 rounded-sm border border-amber-300/60" aria-hidden />
                  <MoveRight className="h-3 w-3" aria-hidden />
                  <span className="h-2 w-2 rounded-full border border-amber-300/60" aria-hidden />
                  <span className="ml-0.5 uppercase tracking-wide">Move into position</span>
                </div>
              )}
            </div>
          </div>

          {(safetyNote || qualityCheck) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {safetyNote && (
                <div className="rounded-lg border border-cyan-300/15 bg-cyan-400/5 p-2.5">
                  <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-300">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Safety note
                  </span>
                  <p className="mt-1 text-[10px] leading-relaxed text-cyan-100/80">{safetyNote}</p>
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

      {/* Bottom dock — ‹ PREVIOUS · ⏸/restart · NEXT STEP › */}
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-3">
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
          aria-label={atLast ? "Final step" : "Next step"}
        >
          {atLast ? "Complete" : "Next step"}
          {!atLast && <ChevronRight className="ml-1 h-4 w-4" />}
        </Button>
      </div>
      {atLast && (
        <p className="px-3 pb-3 text-center text-[10px] text-cyan-200/60">
          Final step reached. Review the plan before continuing.
        </p>
      )}
    </div>
  );
}
