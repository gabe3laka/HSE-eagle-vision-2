import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanStage, PlanTaskType } from "../types";

/**
 * The Plan goal/follow-up input — a fixed bottom drawer that is ALWAYS visible
 * when open (it does not live below the fold in the panel, so "tap to reply"
 * on a floating callout reliably reveals a text box on the phone).
 *
 *   plan_waiting_for_intent → opens automatically (first goal).
 *   plan_guiding / review   → opened by "Ask follow-up" / "tap to reply".
 *
 * Enter submits; empty text does nothing. Quick chips submit immediately
 * (clear actions); "Custom" focuses the text box.
 */

/** Quick goals — clear actions submit immediately on tap. */
const QUICK_GOALS: Array<{ label: string; taskType: PlanTaskType }> = [
  { label: "Identify this", taskType: "identify" },
  { label: "Inspect it", taskType: "inspect" },
  { label: "Build / assemble", taskType: "build" },
  { label: "Troubleshoot", taskType: "troubleshoot" },
  { label: "Explain this", taskType: "identify" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: PlanStage;
  /** Reasoner-suggested goals (chips below the quick actions). */
  suggestedGoals?: string[];
  thinking?: boolean;
  /** Free-text goal or follow-up. */
  onSubmitText: (text: string) => void;
  /** A quick-action chip (clear task type) — submits immediately. */
  onQuickGoal: (taskType: PlanTaskType, label: string) => void;
}

export function PlanInputDrawer({
  open,
  onOpenChange,
  stage,
  suggestedGoals,
  thinking = false,
  onSubmitText,
  onQuickGoal,
}: Props) {
  const [planDraft, setPlanDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the text box whenever the drawer opens (no jsx autofocus).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const firstGoal = stage === "plan_waiting_for_intent";
  const submit = () => {
    const text = planDraft.trim();
    if (!text) return; // empty text does nothing
    onSubmitText(text);
    setPlanDraft("");
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-50 px-3 lg:bottom-6">
      <div className="mx-auto max-w-xl space-y-3 rounded-[22px] border border-violet-300/25 bg-[rgba(8,8,24,0.96)] p-4 shadow-[0_24px_90px_-24px_rgba(124,58,237,0.75)] ring-1 ring-white/5 backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <div>
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-200">
              <Sparkles className="h-3.5 w-3.5" /> Plan command
            </span>
            <p className="mt-1 text-[10px] text-violet-200/55">
              Describe the outcome. SafeLens will turn it into guided steps.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close goal input"
            className="text-violet-300/70 transition-colors hover:text-violet-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-violet-50">
          {firstGoal
            ? "What are you trying to build, inspect, repair, troubleshoot, or understand?"
            : "Ask a follow-up or refine the goal."}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_GOALS.map((g) => (
            <button
              key={g.label}
              type="button"
              className="min-h-8 rounded-full border border-violet-300/25 bg-violet-400/[0.07] px-3 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/20"
              onClick={() => onQuickGoal(g.taskType, g.label)}
            >
              {g.label}
            </button>
          ))}
          <button
            type="button"
            className="min-h-8 rounded-full border border-violet-300/25 bg-violet-400/[0.07] px-3 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/20"
            onClick={() => inputRef.current?.focus()}
          >
            Custom
          </button>
        </div>

        {(suggestedGoals?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestedGoals!.slice(0, 4).map((g, i) => (
              <button
                key={`${g}-${i}`}
                type="button"
                className="min-h-8 rounded-full border border-cyan-300/20 bg-cyan-500/[0.08] px-3 py-1 text-[11px] text-cyan-100 transition-colors hover:bg-cyan-500/20"
                onClick={() => onSubmitText(g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-stretch gap-2 rounded-xl border border-violet-300/15 bg-black/30 p-1.5 focus-within:border-violet-300/35">
          <input
            ref={inputRef}
            value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. “Help me assemble this PCB board with these cables”"
            className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-sm text-violet-50 placeholder:text-violet-300/35 focus:outline-none"
          />
          <Button
            size="sm"
            className="min-h-11 shrink-0 rounded-lg px-4"
            onClick={submit}
            disabled={!planDraft.trim() || thinking}
          >
            {thinking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : firstGoal ? (
              "Generate plan"
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
