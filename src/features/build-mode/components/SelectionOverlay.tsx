import { useRef, useState } from "react";
import { mirrorBox, mirrorPointX } from "@/lib/detection/mirror";
import { BUILD_MIN_SELECTION } from "../config";
import type { SelectedRegion } from "../types";

interface Props {
  active: boolean;
  onSelect: (region: SelectedRegion) => void;
  /** Front camera: input converts to RAW space; render flips back to visual. */
  mirrored?: boolean;
}

/**
 * Faint dashed marker over the ORIGINAL selected region — shown once the ghost
 * has been pulled away so the user still sees which real-world area the
 * procedure keyframes are captured from. Purely visual. The region is RAW
 * (capture) space; `mirrored` flips it to the visual position on the selfie.
 */
export function SelectedRegionMarker({
  region,
  mirrored = false,
}: {
  region: SelectedRegion;
  mirrored?: boolean;
}) {
  const box = mirrorBox(region, mirrored);
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-sm border border-dashed border-cyan-400/50"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
    >
      <span className="absolute -top-4 left-0 rounded bg-black/55 px-1 text-[8px] text-cyan-300/90">
        source
      </span>
    </div>
  );
}

/**
 * Build Mode region selector: drag a rectangle over the live video to lock the
 * object/area to blueprint. Same normalized-0..1 card coordinates as
 * ZoneOverlay/DetectionOverlay, so the selection matches the visible crop the
 * capture pipeline uses. Pointer events only while `active`.
 */
export function SelectionOverlay({ active, onSelect, mirrored = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  if (!active) return null;

  // Pointer → RAW space (flips x on the mirrored selfie) so the selected
  // region matches the unmirrored capture pipeline.
  const norm = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const vx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return {
      x: mirrorPointX(vx, mirrored),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  // RAW-space rect (what onSelect receives / the capture uses).
  const rect = drag
    ? {
        x: Math.min(drag.x1, drag.x2),
        y: Math.min(drag.y1, drag.y2),
        w: Math.abs(drag.x2 - drag.x1),
        h: Math.abs(drag.y2 - drag.y1),
      }
    : null;
  // Visual-space rect for display (flipped back on the mirrored preview).
  const viewRect = rect ? mirrorBox(rect, mirrored) : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = norm(e);
        setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      }}
      onPointerMove={
        drag
          ? (e) => {
              const p = norm(e);
              setDrag((d) => (d ? { ...d, x2: p.x, y2: p.y } : d));
            }
          : undefined
      }
      onPointerUp={
        drag
          ? () => {
              if (rect && rect.w >= BUILD_MIN_SELECTION && rect.h >= BUILD_MIN_SELECTION) {
                onSelect(rect);
              }
              setDrag(null);
            }
          : undefined
      }
    >
      {/* dimmed backdrop + hint */}
      <div className="pointer-events-none absolute inset-0 bg-black/30" />
      {!drag && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-cyan-200 backdrop-blur">
            Drag a box around the object to blueprint
          </span>
        </div>
      )}
      {viewRect && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-cyan-300 bg-cyan-400/10 shadow-[0_0_18px_rgba(34,211,238,0.45)]"
          style={{
            left: `${viewRect.x * 100}%`,
            top: `${viewRect.y * 100}%`,
            width: `${viewRect.w * 100}%`,
            height: `${viewRect.h * 100}%`,
          }}
        />
      )}
    </div>
  );
}
