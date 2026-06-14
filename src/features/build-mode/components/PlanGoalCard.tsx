import { CheckCircle2, Loader2, Target } from "lucide-react";

/**
 * Plan console — "AI GOAL" glass card (mockup). Shows the confirmed goal with a
 * cyan left border + target icon; while the reasoner is generating it shows the
 * "AI is analyzing the scene…" subtext + spinner, and a green check once a plan
 * exists. PURE presentation — no logic, no network.
 */
export function PlanGoalCard({
  goal,
  analyzing,
  hasPlan,
  className,
}: {
  /** The confirmed user goal (free text). Empty → a waiting prompt. */
  goal?: string | null;
  /** True while the plan is being generated. */
  analyzing?: boolean;
  /** True once a plan/scene exists. */
  hasPlan?: boolean;
  className?: string;
}) {
  const goalText = goal?.trim() || "Tell me what you want to do";
  return (
    <div
      className={`console-panel relative overflow-hidden border-l-2 border-l-cyan-400/70 p-3 ${className ?? ""}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
          <Target className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="console-eyebrow flex items-center gap-1.5">
            AI Goal
            {hasPlan && !analyzing && (
              <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-label="Plan ready" />
            )}
          </p>
          <p className="mt-1 text-sm font-medium leading-snug text-foreground" aria-live="polite">
            {goalText}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {analyzing ? (
              <>
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-cyan-300" />
                AI is analyzing the scene and creating a plan…
              </>
            ) : hasPlan ? (
              "Plan ready. Follow the highlighted step on the scene."
            ) : (
              "Capture the parts, then set a goal to generate guided steps."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
