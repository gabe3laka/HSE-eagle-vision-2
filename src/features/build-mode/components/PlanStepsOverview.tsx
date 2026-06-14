import { Check, ChevronRight, Lock } from "lucide-react";
import type { PlanSceneBlueprint } from "../types";

/**
 * Plan console — "STEPS OVERVIEW" panel (mockup): the full ordered step list.
 * The current step is highlighted with a chevron, completed steps carry a check,
 * future steps are plain/locked. PURE presentation — navigation lives in the
 * step navigator / session.
 */
export function PlanStepsOverview({
  scene,
  className,
}: {
  scene: PlanSceneBlueprint;
  className?: string;
}) {
  const steps = scene.assemblySteps;
  if (steps.length === 0) return null;
  const idx = Math.max(0, Math.min(steps.length - 1, scene.currentStepIndex));
  return (
    <div className={`console-panel p-3 ${className ?? ""}`}>
      <p className="console-eyebrow">Steps overview</p>
      <ol className="mt-2 space-y-1">
        {steps.map((step, i) => {
          const completed = i < idx;
          const current = i === idx;
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors ${
                current ? "border-cyan-300/40 bg-cyan-400/10" : "border-transparent"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  completed
                    ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-200"
                    : current
                      ? "border-cyan-300 bg-cyan-400/15 text-cyan-100 ring-2 ring-cyan-400/20"
                      : "border-white/15 bg-black/15 text-muted-foreground"
                }`}
              >
                {completed ? (
                  <Check className="h-3 w-3" />
                ) : current ? (
                  i + 1
                ) : (
                  <Lock className="h-2.5 w-2.5" aria-label="Locked" />
                )}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  current
                    ? "font-medium text-foreground"
                    : completed
                      ? "text-muted-foreground"
                      : "text-muted-foreground/70"
                }`}
              >
                {step.title}
              </span>
              {current && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
