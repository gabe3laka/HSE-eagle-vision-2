/**
 * Plan console — "PLAN PROGRESS" panel (mockup): a segmented progress bar (one
 * segment per step, filled up to and including the current step) plus the
 * heuristic "Plan Confidence: NN%" readout on the right. PURE presentation.
 */
export function PlanProgressBar({
  currentIndex,
  total,
  confidence,
  className,
}: {
  /** 0-based active step index. */
  currentIndex: number;
  /** Total number of steps. */
  total: number;
  /** Heuristic plan confidence 0..1 (see estimatePlanConfidence). */
  confidence: number;
  className?: string;
}) {
  if (total <= 0) return null;
  const idx = Math.max(0, Math.min(total - 1, currentIndex));
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return (
    <div className={`console-panel p-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="console-eyebrow">Plan progress</p>
        <span className="text-[11px] font-semibold text-cyan-200">Plan Confidence: {pct}%</span>
      </div>
      <div
        className="mt-2.5 flex items-center gap-1"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={idx + 1}
        aria-label={`Plan progress, step ${idx + 1} of ${total}`}
      >
        {Array.from({ length: total }, (_, i) => {
          const filled = i <= idx;
          const isCurrent = i === idx;
          return (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                filled
                  ? isCurrent
                    ? "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                    : "bg-cyan-400/60"
                  : "bg-white/10"
              }`}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Step {idx + 1} of {total}
      </p>
    </div>
  );
}
