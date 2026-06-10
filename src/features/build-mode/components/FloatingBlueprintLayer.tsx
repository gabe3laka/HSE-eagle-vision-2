import { useCallback, useEffect, useRef, useState } from "react";
import { Locate, Minus, Move, Plus } from "lucide-react";
import { BlueprintOverlay } from "./BlueprintOverlay";
import type { BlueprintFrame, BlueprintTransform, SelectedRegion } from "../types";

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

interface Props {
  region: SelectedRegion;
  frame: BlueprintFrame | null;
  /** Pulsing border while keyframes are being recorded. */
  recording?: boolean;
}

/**
 * The detachable blueprint ghost. It spawns locked onto the selected region,
 * then the user can touch-drag it anywhere over the camera (the real object
 * stays visible behind), scale it, and snap it back with Reset. Transform state
 * is {x,y,scale} offsets in visible-card fractions, per the Build Mode spec.
 */
export function FloatingBlueprintLayer({ region, frame, recording }: Props) {
  const [t, setT] = useState<BlueprintTransform>({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // New selection → snap the ghost back onto the object.
  useEffect(() => {
    setT({ x: 0, y: 0, scale: 1 });
  }, [region]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const host = hostRef.current?.parentElement; // the camera-card layer
      if (!host) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: t.x,
        baseY: t.y,
      };
    },
    [t.x, t.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    const host = hostRef.current?.parentElement;
    if (!d || d.pointerId !== e.pointerId || !host) return;
    const r = host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    setT((prev) => ({
      ...prev,
      x: d.baseX + (e.clientX - d.startX) / r.width,
      y: d.baseY + (e.clientY - d.startY) / r.height,
    }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }, []);

  const zoom = useCallback((dir: 1 | -1) => {
    setT((prev) => ({
      ...prev,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale + dir * 0.25)),
    }));
  }, []);

  const reset = useCallback(() => setT({ x: 0, y: 0, scale: 1 }), []);

  const detached = Math.abs(t.x) > 0.01 || Math.abs(t.y) > 0.01 || Math.abs(t.scale - 1) > 0.01;

  return (
    <div
      ref={hostRef}
      className={`absolute z-30 touch-none select-none rounded-md ${
        recording ? "animate-pulse" : ""
      }`}
      style={{
        left: `${(region.x + t.x) * 100}%`,
        top: `${(region.y + t.y) * 100}%`,
        width: `${region.w * t.scale * 100}%`,
        height: `${region.h * t.scale * 100}%`,
        boxShadow: "0 0 22px rgba(56,189,248,0.35)",
        border: "1px solid rgba(56,189,248,0.65)",
        background: "rgba(2,16,28,0.25)",
        backdropFilter: "blur(1px)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {frame ? (
        <BlueprintOverlay frame={frame} />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] text-cyan-200/80">building blueprint…</span>
        </div>
      )}

      {/* grip + controls — small, inside the ghost so they travel with it */}
      <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 backdrop-blur">
        <Move className="h-3 w-3 text-cyan-200" />
        <button
          type="button"
          aria-label="Shrink blueprint"
          className="text-cyan-200 hover:text-white"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoom(-1)}
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Enlarge blueprint"
          className="text-cyan-200 hover:text-white"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoom(1)}
        >
          <Plus className="h-3 w-3" />
        </button>
        {detached && (
          <button
            type="button"
            aria-label="Reset blueprint position"
            className="text-cyan-200 hover:text-white"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={reset}
          >
            <Locate className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
