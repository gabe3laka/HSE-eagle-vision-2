import { ChevronLeft, ChevronRight, Layers, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanSceneBlueprint } from "../types";

/**
 * Step navigator for the holographic scene canvas (Plan multi-object planning).
 *
 * One object animates per step; the user gates progress with Previous / Next
 * (NO auto-advance). Shows "Step N of M", the active step's instruction, its
 * safety note + quality check, and a "Scene: X objects detected" indicator.
 * Large touch targets + aria-labels on the icon-only buttons; mobile-friendly.
 */
export function PlanStepNavigator({
  scene,
  onPrevious,
  onNext,
  onReset,
}: {
  scene: PlanSceneBlueprint;
  onPrevious: () => void;
  onNext: () => void;
  onReset?: () => void;
}) {
  const total = scene.assemblySteps.length;
  if (total === 0) return null;
  const index = Math.max(0, Math.min(total - 1, scene.currentStepIndex));
  const step = scene.assemblySteps[index];
  const objectCount = scene.objects.length;
  const atFirst = index <= 0;
  const atLast = index >= total - 1;
  const activeObject = step?.objectId
    ? scene.objects.find((o) => o.id === step.objectId)
    : undefined;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-violet-400/25 bg-violet-500/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
          <Layers className="h-3 w-3" />
          Scene: {objectCount} object{objectCount === 1 ? "" : "s"} detected
        </span>
        <span className="text-[11px] font-medium text-violet-100" aria-live="polite">
          Step {index + 1} of {total}
        </span>
      </div>

      {step && (
        <div className="space-y-1">
          <p className="text-[12px] font-semibold text-violet-50">
            {step.title}
            {activeObject ? (
              <span className="ml-1.5 font-normal text-violet-200/70">· {activeObject.label}</span>
            ) : null}
          </p>
          <p className="text-[11px] leading-snug text-violet-100/90">{step.instruction}</p>
          {step.safetyNote && (
            <p className="text-[11px] font-medium leading-snug text-red-300">⚠ {step.safetyNote}</p>
          )}
          {step.qualityCheck && (
            <p className="text-[11px] leading-snug text-emerald-300">✓ {step.qualityCheck}</p>
          )}
        </div>
      )}

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
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      {atLast && (
        <p className="text-center text-[10px] text-violet-200/60">
          Last step — the plan is complete.
        </p>
      )}
    </div>
  );
}
