import { Loader2 } from "lucide-react";

/**
 * Plan console — "AI ASSISTANT" panel (mockup, bottom dock right): a glowing
 * "AI" orb plus a short status line ("Thinking…" while generating, else a one
 * line summary). PURE presentation — copy is derived upstream
 * (planAssistantSummary). No network.
 */
export function PlanAiAssistant({
  summary,
  thinking,
  className,
}: {
  summary: string;
  thinking?: boolean;
  className?: string;
}) {
  return (
    <div className={`console-panel flex items-center gap-3 p-3 ${className ?? ""}`}>
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-[10px] font-bold text-cyan-100 ring-1 ring-cyan-300/30 ${
          thinking ? "animate-pulse" : ""
        }`}
        aria-hidden
      >
        AI
        <span className="absolute inset-0 rounded-full shadow-[0_0_14px_rgba(34,211,238,0.45)]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="console-eyebrow">AI Assistant</p>
        <p
          className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-snug text-foreground/90"
          aria-live="polite"
        >
          {thinking && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-cyan-300" />}
          {summary}
        </p>
      </div>
    </div>
  );
}
