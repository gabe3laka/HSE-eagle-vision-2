import { BUILD_EXTRACT_HOLD_MS } from "../config";

const R = 14;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Mini countdown clock shown while a pinch is being HELD to extract a
 * blueprint: the amber ring fills over the hold duration and the remaining
 * seconds tick down in the middle. Purely presentational — the caller owns
 * positioning and the hold timing.
 */
export function PinchHoldRing({
  progress,
  label,
  durationMs = BUILD_EXTRACT_HOLD_MS,
}: {
  /** 0..1 — how much of the hold has elapsed. */
  progress: number;
  label?: string;
  durationMs?: number;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const secondsLeft = Math.max(0, Math.ceil(((1 - p) * durationMs) / 1000));
  return (
    <div className="pointer-events-none flex flex-col items-center gap-0.5">
      <span className="relative flex h-11 w-11 items-center justify-center">
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden>
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(34,211,238,0.35)"
            strokeWidth="2.5"
          />
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="none"
            stroke="rgb(251,191,36)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - p)}
          />
        </svg>
        <span className="text-[12px] font-bold text-amber-200">{secondsLeft}</span>
      </span>
      {label && (
        <span className="whitespace-nowrap rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-amber-200 backdrop-blur">
          {label}
        </span>
      )}
    </div>
  );
}
