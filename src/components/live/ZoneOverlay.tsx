import { useRef, useState } from "react";
import { rectZonePoints } from "@/lib/detection/zones";
import type { DetectionZone, ZonePoint } from "@/lib/detection/types";

const MIN_ZONE = 0.05; // ignore tiny accidental drags

const toPoints = (pts: ZonePoint[]) => pts.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");

interface Props {
  zones: DetectionZone[];
  editing: boolean;
  onCreate: (points: ZonePoint[]) => void;
}

/**
 * Draws restricted zones over the live video (faint, always visible) and, in
 * editing mode, lets the operator drag a rectangle to create one. Coordinates
 * are normalized 0..1 to the container — the same convention as DetectionOverlay,
 * so zones stay consistent with the rendered hazard boxes. Deletion is handled by
 * the zone list in the controls.
 */
export function ZoneOverlay({ zones, editing, onCreate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const norm = (e: React.PointerEvent): ZonePoint => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  return (
    <div
      ref={ref}
      className={`absolute inset-0 ${editing ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
      onPointerDown={
        editing
          ? (e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const p = norm(e);
              setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
            }
          : undefined
      }
      onPointerMove={
        editing && drag
          ? (e) => {
              const p = norm(e);
              setDrag((d) => (d ? { ...d, x2: p.x, y2: p.y } : d));
            }
          : undefined
      }
      onPointerUp={
        editing && drag
          ? () => {
              const w = Math.abs(drag.x2 - drag.x1);
              const h = Math.abs(drag.y2 - drag.y1);
              if (w >= MIN_ZONE && h >= MIN_ZONE) {
                onCreate(rectZonePoints(drag.x1, drag.y1, drag.x2, drag.y2));
              }
              setDrag(null);
            }
          : undefined
      }
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {zones.map((z) => (
          <polygon
            key={z.id}
            points={toPoints(z.points)}
            fill="rgba(239,68,68,0.12)"
            stroke="rgba(239,68,68,0.8)"
            strokeWidth={0.4}
          />
        ))}
        {drag && (
          <rect
            x={Math.min(drag.x1, drag.x2) * 100}
            y={Math.min(drag.y1, drag.y2) * 100}
            width={Math.abs(drag.x2 - drag.x1) * 100}
            height={Math.abs(drag.y2 - drag.y1) * 100}
            fill="rgba(239,68,68,0.15)"
            stroke="rgba(239,68,68,0.9)"
            strokeWidth={0.4}
            strokeDasharray="2 1.5"
          />
        )}
      </svg>

      {zones.map((z) => {
        const minX = Math.min(...z.points.map((p) => p.x));
        const minY = Math.min(...z.points.map((p) => p.y));
        return (
          <span
            key={z.id}
            className="pointer-events-none absolute rounded-br bg-red-500/80 px-1.5 py-0.5 text-[10px] font-semibold text-white"
            style={{ left: `${minX * 100}%`, top: `${minY * 100}%` }}
          >
            {z.label ?? "Zone"}
          </span>
        );
      })}
    </div>
  );
}
