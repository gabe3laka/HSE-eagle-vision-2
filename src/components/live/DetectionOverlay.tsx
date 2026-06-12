import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { mirrorBox } from "@/lib/detection/mirror";
import type { LiveBox } from "@/lib/detection/types";

/**
 * Draws hazard bounding boxes over the live video, coloured by severity.
 * `mirrored` (front camera): box GEOMETRY is flipped to match the mirrored
 * video; the label travels with the box and stays readable (never flipped).
 */
export function DetectionOverlay({ boxes, mirrored }: { boxes: LiveBox[]; mirrored?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {boxes.map((b, i) => {
        const sev = SEVERITY_META[b.severity];
        const meta = HAZARDS[b.hazardType];
        const box = mirrorBox(b.bbox, !!mirrored);
        return (
          <div
            key={`${b.hazardType}-${i}`}
            className="absolute rounded-md border-2 transition-all duration-150"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              borderColor: sev.stroke,
              boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 16px ${sev.stroke}`,
            }}
          >
            <span
              className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: sev.stroke }}
            >
              {meta.short} · {Math.round(b.confidence * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
