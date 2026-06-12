import { mirrorPointX } from "@/lib/detection/mirror";
import type { BuildHandLandmark, BuildPinchState } from "../types";

/**
 * Renders the tracked hand points over the camera card (Build Mode only).
 *
 * MediaPipe finger mode: the INDEX fingertip is the pointer (crosshair dot,
 * ring + glow while pinching), the thumb tip renders smaller, wrists faint.
 * Wrist-fallback mode: the existing wrist dots (primary ringed + labeled).
 * Purely visual — interaction runs in FloatingBlueprintLayer (raw coords).
 * `mirrored` flips the dot POSITIONS on the selfie preview so they land on the
 * user's visible hand; the hint text stays readable.
 */
export function HandPointerLayer({
  landmarks,
  primaryId,
  pinch,
  hint,
  mirrored = false,
}: {
  landmarks: BuildHandLandmark[];
  primaryId?: string | null;
  pinch?: BuildPinchState | null;
  /** Phase-appropriate fingertip hint (e.g. "pinch a detected box") — replaces
   *  the generic "pinch to grab" so the label never misleads. */
  hint?: string | null;
  mirrored?: boolean;
}) {
  if (landmarks.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {landmarks.map((lm) => {
        const primary = lm.id === primaryId;
        const finger = lm.source === "mediapipe-hand";
        const pinching = primary && finger && !!pinch?.active;
        const vx = mirrorPointX(lm.x, mirrored);

        if (finger && lm.role === "index-tip") {
          return (
            <div
              key={lm.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${vx * 100}%`, top: `${lm.y * 100}%` }}
            >
              <div
                className={
                  pinching
                    ? "h-5 w-5 rounded-full border-2 border-amber-300 bg-amber-300/40 shadow-[0_0_14px_rgba(251,191,36,0.85)]"
                    : "h-3.5 w-3.5 rounded-full border-2 border-cyan-300 bg-cyan-300/30 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                }
              />
              {primary && (
                <span
                  className={`absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1 text-[8px] ${
                    pinching ? "text-amber-200" : "text-cyan-200"
                  }`}
                >
                  {pinching ? "pinching" : (hint ?? "pinch to grab")}
                </span>
              )}
            </div>
          );
        }

        if (finger && lm.role === "thumb-tip") {
          return (
            <div
              key={lm.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${vx * 100}%`, top: `${lm.y * 100}%` }}
            >
              <div
                className={
                  pinch?.active
                    ? "h-2.5 w-2.5 rounded-full border border-amber-300 bg-amber-300/40"
                    : "h-2 w-2 rounded-full border border-cyan-300/80 bg-cyan-300/25"
                }
              />
            </div>
          );
        }

        // Wrist dots — faint companions in finger mode, the pointer in fallback.
        return (
          <div
            key={lm.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${vx * 100}%`, top: `${lm.y * 100}%` }}
          >
            <div
              className={
                primary
                  ? "h-4 w-4 rounded-full border-2 border-amber-300 bg-amber-300/30 shadow-[0_0_10px_rgba(251,191,36,0.7)]"
                  : finger
                    ? "h-2 w-2 rounded-full border border-cyan-300/60 bg-cyan-300/20"
                    : "h-2.5 w-2.5 rounded-full border border-cyan-300 bg-cyan-300/40"
              }
            />
            {primary && lm.hand && lm.hand !== "unknown" && (
              <span className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1 text-[8px] text-amber-200">
                {lm.hand} wrist
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
