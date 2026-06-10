import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Locate, Minus, Move, Plus } from "lucide-react";
import { pointerInBounds } from "../lib/handTracking";
import { BlueprintOverlay } from "./BlueprintOverlay";
import type {
  BlueprintFrame,
  BlueprintTransform,
  BuildHandInteraction,
  BuildHandLandmark,
  SelectedRegion,
} from "../types";

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

// Wrist-pointer interaction tuning (Build Mode MVP):
const HAND_DWELL_MS = 300; // hover this long inside the ghost → grab
const HAND_LOST_RELEASE_MS = 400; // pointer gone this long → release
const HAND_STALE_MS = 700; // tracking stream stopped updating → treat as lost
const HAND_TICK_MS = 90; // state-machine evaluation cadence

type HandMode = BuildHandInteraction["mode"];

interface Props {
  region: SelectedRegion;
  frame: BlueprintFrame | null;
  /** Pulsing border while keyframes are being recorded. */
  recording?: boolean;
  /** Tracked wrist pointer (card coords). Null → touch-only behavior. */
  handPointer?: BuildHandLandmark | null;
  /** Reports hover/grab/drag state up for the status chip. */
  onHandInteraction?: (interaction: BuildHandInteraction) => void;
}

/**
 * The detachable blueprint ghost. It spawns locked onto the selected region,
 * then the user can move it two ways while the real object stays visible:
 *
 *  1. Touch drag (existing MVP behavior — always available as the fallback).
 *  2. Hand control: hold the tracked WRIST pointer inside the ghost for a
 *     short dwell (~300 ms) to grab it, move the wrist to drag, and it
 *     releases when tracking is lost for ~400 ms (or a touch takes over).
 *
 * Build Mode uses wrist-based hand control for MVP. True finger pinch requires
 * a future MediaPipe Hands / hand-landmarker adapter.
 *
 * Transform state is {x,y,scale} offsets in visible-card fractions.
 */
export function FloatingBlueprintLayer({
  region,
  frame,
  recording,
  handPointer,
  onHandInteraction,
}: Props) {
  const [t, setT] = useState<BlueprintTransform>({ x: 0, y: 0, scale: 1 });
  const [handMode, setHandMode] = useState<HandMode>("idle");
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // Refs read by the hand state machine (interval-driven, no effect churn).
  const tRef = useRef(t);
  tRef.current = t;
  const regionRef = useRef(region);
  regionRef.current = region;
  const handRef = useRef<BuildHandLandmark | null>(handPointer ?? null);
  handRef.current = handPointer ?? null;
  const onHandRef = useRef(onHandInteraction);
  onHandRef.current = onHandInteraction;
  const modeRef = useRef<HandMode>("idle");
  const hoverStartRef = useRef(0);
  const lastSeenRef = useRef(0);
  const grabOffsetRef = useRef({ dx: 0, dy: 0 });

  // New selection → snap the ghost back onto the object.
  useEffect(() => {
    setT({ x: 0, y: 0, scale: 1 });
  }, [region]);

  const setModeBoth = useCallback((mode: HandMode) => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    setHandMode(mode);
    const p = handRef.current;
    onHandRef.current?.({
      active: p != null,
      mode,
      controllingHandId: p?.id,
      pointer: p ? { x: p.x, y: p.y, confidence: p.confidence } : undefined,
    });
  }, []);

  // Wrist-pointer state machine: idle → hover (inside ghost) → grab after
  // dwell → dragging follows the wrist → release when tracking drops out.
  useEffect(() => {
    if (!handPointer && modeRef.current === "idle") return; // nothing to do
    const tick = () => {
      const now = Date.now();
      const p = handRef.current;
      const fresh = p != null && now - p.timestampMs <= HAND_STALE_MS;

      // Touch drag always wins — hand control yields immediately.
      if (dragRef.current) {
        setModeBoth("idle");
        return;
      }

      if (!fresh) {
        if (modeRef.current === "grab" || modeRef.current === "dragging") {
          if (now - lastSeenRef.current > HAND_LOST_RELEASE_MS) setModeBoth("idle");
        } else {
          setModeBoth("idle");
        }
        return;
      }
      lastSeenRef.current = now;

      const cur = tRef.current;
      const reg = regionRef.current;
      const bounds = {
        x: reg.x + cur.x,
        y: reg.y + cur.y,
        w: reg.w * cur.scale,
        h: reg.h * cur.scale,
      };
      const inside = pointerInBounds(p, bounds);

      switch (modeRef.current) {
        case "idle":
          if (inside) {
            hoverStartRef.current = now;
            setModeBoth("hover");
          }
          break;
        case "hover":
          if (!inside) {
            setModeBoth("idle");
          } else if (now - hoverStartRef.current >= HAND_DWELL_MS) {
            grabOffsetRef.current = { dx: p.x - bounds.x, dy: p.y - bounds.y };
            setModeBoth("grab");
          }
          break;
        case "grab":
        case "dragging": {
          const nx = p.x - reg.x - grabOffsetRef.current.dx;
          const ny = p.y - reg.y - grabOffsetRef.current.dy;
          if (Math.abs(nx - cur.x) > 0.002 || Math.abs(ny - cur.y) > 0.002) {
            setT((prev) => ({ ...prev, x: nx, y: ny }));
            setModeBoth("dragging");
          }
          break;
        }
      }
    };
    const id = setInterval(tick, HAND_TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [handPointer, setModeBoth]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const host = hostRef.current?.parentElement; // the camera-card layer
      if (!host) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setModeBoth("idle"); // touch takes over from hand control
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: t.x,
        baseY: t.y,
      };
    },
    [t.x, t.y, setModeBoth],
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

  const reset = useCallback(() => {
    setModeBoth("idle");
    setT({ x: 0, y: 0, scale: 1 });
  }, [setModeBoth]);

  const detached = Math.abs(t.x) > 0.01 || Math.abs(t.y) > 0.01 || Math.abs(t.scale - 1) > 0.01;
  const handEngaged = handMode === "grab" || handMode === "dragging";
  const borderColor = handEngaged
    ? "rgba(251,191,36,0.95)" // amber: wrist has grabbed the ghost
    : handMode === "hover"
      ? "rgba(125,211,252,0.95)" // bright: wrist hovering, dwell running
      : "rgba(56,189,248,0.65)";

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
        boxShadow: handEngaged
          ? "0 0 26px rgba(251,191,36,0.45)"
          : "0 0 22px rgba(56,189,248,0.35)",
        border: `${handMode === "hover" || handEngaged ? 2 : 1}px solid ${borderColor}`,
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

      {/* hand-control badge while the wrist is engaging the ghost */}
      {(handMode === "hover" || handEngaged) && (
        <div className="pointer-events-none absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 backdrop-blur">
          <Hand className={`h-3 w-3 ${handEngaged ? "text-amber-300" : "text-cyan-200"}`} />
          <span className={`text-[9px] ${handEngaged ? "text-amber-300" : "text-cyan-200"}`}>
            {handEngaged ? "dragging" : "hold to grab"}
          </span>
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
