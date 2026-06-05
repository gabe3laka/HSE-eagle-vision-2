import type { BackendEntity } from "@/lib/detection/types";

// Teal — deliberately distinct from the red/amber severity hazard boxes so the
// dry-run entities can't be mistaken for real safety detections.
const BOX_COLOR = "rgba(20,184,166,0.95)";

/**
 * Dev-only overlay for the DEIMv2 backend dry-run. Draws the raw detected
 * entities (teal boxes + label/confidence) over the live video. Purely
 * informational — these are NOT hazards and never enter the risk engine.
 *
 * Boxes use normalized 0..1 bbox coords rendered as percentages, matching
 * `DetectionOverlay`, so no video pixel dimensions are required.
 */
export function BackendEntityOverlay({
  entities,
}: {
  entities: BackendEntity[];
  videoWidth?: number;
  videoHeight?: number;
}) {
  if (!import.meta.env.DEV || entities.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {entities.map((e, i) => (
        <div
          key={`${e.label}-${i}`}
          className="absolute rounded-md border-2"
          style={{
            left: `${e.bbox.x * 100}%`,
            top: `${e.bbox.y * 100}%`,
            width: `${e.bbox.w * 100}%`,
            height: `${e.bbox.h * 100}%`,
            borderColor: BOX_COLOR,
            boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 12px ${BOX_COLOR}`,
          }}
        >
          <span
            className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-black"
            style={{ backgroundColor: BOX_COLOR }}
          >
            {e.label} · {Math.round(e.confidence * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}
