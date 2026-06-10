import type { BuildHandLandmark } from "../types";

/**
 * Renders the tracked wrist/hand points over the camera card (Build Mode only).
 * The primary pointer gets a ring so the user can see which wrist is "the
 * cursor". Purely visual — interaction runs in FloatingBlueprintLayer.
 */
export function HandPointerLayer({
  landmarks,
  primaryId,
}: {
  landmarks: BuildHandLandmark[];
  primaryId?: string | null;
}) {
  if (landmarks.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {landmarks.map((lm) => {
        const primary = lm.id === primaryId;
        return (
          <div
            key={lm.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${lm.x * 100}%`, top: `${lm.y * 100}%` }}
          >
            <div
              className={
                primary
                  ? "h-4 w-4 rounded-full border-2 border-amber-300 bg-amber-300/30 shadow-[0_0_10px_rgba(251,191,36,0.7)]"
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
