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
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3">
      <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-violet-400/40 bg-[rgba(16,8,38,0.96)] p-3 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-200">
            <Sparkles className="h-3.5 w-3.5" /> Goal
          </span>
          <button
            type="button"
            aria-label="Close goal input"
            className="text-violet-300/70 transition-colors hover:text-violet-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-violet-100">
          {firstGoal
            ? "What are you trying to build, inspect, repair, troubleshoot, or understand?"
            : "Ask a follow-up or refine the goal."}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_GOALS.map((g) => (
            <button
              key={g.label}
              type="button"
              className="rounded-full border border-violet-300/40 bg-black/30 px-2.5 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/25"
              onClick={() => onQuickGoal(g.taskType, g.label)}
            >
              {g.label}
            </button>
          ))}
          <button
            type="button"
            className="rounded-full border border-violet-300/40 bg-black/30 px-2.5 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/25"
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
                className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100 transition-colors hover:bg-cyan-500/25"
                onClick={() => onSubmitText(g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. “Help me assemble this PCB board with these cables”"
            className="min-w-0 flex-1 rounded-md border border-violet-300/30 bg-black/40 px-2.5 py-1.5 text-xs text-violet-50 placeholder:text-violet-300/40 focus:border-violet-300/60 focus:outline-none"
          />
          <Button
            size="sm"
            className="shrink-0"
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
