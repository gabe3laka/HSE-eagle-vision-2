import type { ExtractCandidate } from "../types";

/**
 * Build Mode "scanning" overlay: outlines every LIVE detection box as an
 * extractable blueprint candidate (cyan dashed, distinct from the HSE hazard
 * colours), highlights the one under the finger/pinch, and labels it
 * "Pinch to blueprint". Rendered only while Build Mode is choosing a source
 * (idle phase) — once extraction starts, FloatingBlueprintLayer takes over
 * with "Extracting…" / "✓ Blueprint extracted".
 */
export function ExtractableCandidateOverlay({
  candidates,
  highlightId,
}: {
  candidates: ExtractCandidate[];
  highlightId?: string | null;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {candidates.map((c) => {
        const hot = c.id === highlightId;
        return (
          <div
            key={c.id}
            className={`absolute rounded-md border-2 border-dashed transition-colors ${
              hot
                ? "border-cyan-300 bg-cyan-400/15 shadow-[0_0_20px_rgba(34,211,238,0.6)]"
                : "border-cyan-400/55 bg-cyan-400/5"
            }`}
            style={{
              left: `${c.bbox.x * 100}%`,
              top: `${c.bbox.y * 100}%`,
              width: `${c.bbox.w * 100}%`,
              height: `${c.bbox.h * 100}%`,
            }}
          >
            <span
              className={`absolute -top-4 left-0 whitespace-nowrap rounded px-1 text-[8px] font-semibold ${
                hot ? "bg-cyan-400 text-black" : "bg-black/55 text-cyan-300"
              }`}
            >
              {hot ? `Pinch to blueprint · ${c.label}` : c.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
