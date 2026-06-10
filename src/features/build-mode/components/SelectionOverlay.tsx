import { useRef, useState } from "react";
import { BUILD_MIN_SELECTION } from "../config";
import type { SelectedRegion } from "../types";

interface Props {
  active: boolean;
  onSelect: (region: SelectedRegion) => void;
}

/**
 * Faint dashed marker over the ORIGINAL selected region — shown once the ghost
 * has been pulled away so the user still sees which real-world area the
 * procedure keyframes are captured from. Purely visual.
 */
export function SelectedRegionMarker({ region }: { region: SelectedRegion }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-sm border border-dashed border-cyan-400/50"
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
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
export function SelectionOverlay({ active, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  if (!active) return null;

  const norm = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const rect = drag
    ? {
        x: Math.min(drag.x1, drag.x2),
        y: Math.min(drag.y1, drag.y2),
        w: Math.abs(drag.x2 - drag.x1),
        h: Math.abs(drag.y2 - drag.y1),
      }
    : null;

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
      {rect && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-cyan-300 bg-cyan-400/10 shadow-[0_0_18px_rgba(34,211,238,0.45)]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
        />
      )}
    </div>
  );
}
