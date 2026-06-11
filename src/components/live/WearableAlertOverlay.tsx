import type { HSESeverity } from "@/lib/detection/hseTypes";

/**
 * Phase 6/7 — the wearable visual alert layer: a coloured border pulse around
 * the whole camera card matching the highest-risk severity (the visual twin of
 * the haptic pattern). Cyan = scanning, amber = low/medium, orange/red = high,
 * red flash = critical. Sits above the HUD, below interactive controls.
 */

interface Props {
  severity: HSESeverity | null;
}

const RING: Record<HSESeverity, { color: string; pulse: boolean }> = {
  info: { color: "rgba(34,211,238,0.0)", pulse: false },
  low: { color: "rgba(34,211,238,0.55)", pulse: false },
  medium: { color: "rgba(251,191,36,0.6)", pulse: true },
  high: { color: "rgba(249,115,22,0.7)", pulse: true },
  critical: { color: "rgba(239,68,68,0.85)", pulse: true },
};

export function WearableAlertOverlay({ severity }: Props) {
  if (!severity || severity === "info") return null;
  const ring = RING[severity];
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-10 rounded-2xl ${
        ring.pulse ? "animate-pulse" : ""
      }`}
      style={{
        boxShadow: `inset 0 0 0 3px ${ring.color}, inset 0 0 28px ${ring.color}`,
      }}
    />
  );
}
