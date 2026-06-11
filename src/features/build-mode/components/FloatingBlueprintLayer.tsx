import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Loader2, Locate, Minus, Move, Pin, Plus } from "lucide-react";
import { pointerInBounds } from "../lib/handTracking";
import { BUILD_EXTRACT_HOLD_MS } from "../config";
import { BlueprintOverlay } from "./BlueprintOverlay";
import { PinchHoldRing } from "./PinchHoldRing";
import type {
  BlueprintFrame,
  BlueprintSourceAsset,
  BlueprintTransform,
  BlueprintVisualMode,
  BuildHandInteraction,
  BuildHandLandmark,
  BuildPhase,
  BuildPinchState,
  SelectedRegion,
} from "../types";

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

// Wrist-pointer interaction tuning (fallback when MediaPipe is unavailable):
const HAND_DWELL_MS = 300; // hover this long inside the ghost → grab
const HAND_LOST_RELEASE_MS = 400; // pointer gone this long → release
const HAND_STALE_MS = 700; // tracking stream stopped updating → treat as lost
const HAND_TICK_MS = 90; // state-machine evaluation cadence

type HandMode = BuildHandInteraction["mode"];

interface Props {
  /** Build workflow phase — drives the layer's role (see component docs). */
  phase: BuildPhase;
  region: SelectedRegion;
  /** Ghost frame: base frame after extraction, replay frame in review. */
  frame: BlueprintFrame | null;
  /** Tracked hand pointer (card coords): MediaPipe index tip when available,
   *  wrist fallback otherwise. Null → touch-only behavior. */
  handPointer?: BuildHandLandmark | null;
  /** Live pinch state from MediaPipe Hands. Null → wrist dwell fallback. */
  pinch?: BuildPinchState | null;
  /** Pinch/touch started on the selected box ("selected") → extract blueprint. */
  onExtractRequest?: () => void;
  /** Drag released in "placing" (or repositioned later) → pin the ghost here. */
  onPinned?: (transform: BlueprintTransform) => void;
  /** Reports hover/grab/drag state up for the status chip. */
  onHandInteraction?: (interaction: BuildHandInteraction) => void;
  /** Ghost rendering style — defaults to "hybrid" (object crop + wireframe). */
  visualMode?: BlueprintVisualMode;
  /** Pixel store entry for the current frame's `sourceAssetId`. */
  sourceAsset?: BlueprintSourceAsset;
  /** Reports the ghost's live card-space bounds (region + drag transform) so an
   *  external layer (callout cards) can attach leader lines to it. */
  onBounds?: (bounds: { x: number; y: number; w: number; h: number }) => void;
  /** Show mask/anchor debug labels on the ghost (dev only). Default off. */
  showBlueprintDebugLabels?: boolean;
}

/**
 * The blueprint extraction surface + detachable ghost, by phase:
 *
 *  selected    The SELECTED BOX itself is the grab source: it glows over the
 *              real object; PINCHING inside it (or touching it) requests
 *              blueprint extraction. No ghost frame exists yet.
 *  extracting  Box pulses "extracting…" while the first frame is created.
 *  placing     The extracted ghost is attached to the hand: while the pinch
 *              is held it follows the pointer; RELEASING the pinch pins it
 *              (touch drag-end pins too; a Pin button is the escape hatch).
 *  pinned/     Ghost stays where pinned. It can still be re-dragged
 *  recording/  (pinch, wrist dwell, or touch) — re-drags just update the
 *  review      placement, never the phase.
 *
 * Movement inputs: touch always wins; MediaPipe pinch beats wrist dwell.
 * Transform is {x,y,scale} offsets in visible-card fractions.
 */
export function FloatingBlueprintLayer({
  phase,
  region,
  frame,
  handPointer,
  pinch,
  onExtractRequest,
  onPinned,
  onHandInteraction,
  visualMode = "hybrid",
  sourceAsset,
  onBounds,
  showBlueprintDebugLabels = false,
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
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const handRef = useRef<BuildHandLandmark | null>(handPointer ?? null);
  handRef.current = handPointer ?? null;
  const pinchRef = useRef<BuildPinchState | null>(pinch ?? null);
  pinchRef.current = pinch ?? null;
  const onHandRef = useRef(onHandInteraction);
  onHandRef.current = onHandInteraction;
  const onExtractRef = useRef(onExtractRequest);
  onExtractRef.current = onExtractRequest;
  const onPinnedRef = useRef(onPinned);
  onPinnedRef.current = onPinned;
  const modeRef = useRef<HandMode>("idle");
  const hoverStartRef = useRef(0);
  const lastSeenRef = useRef(0);
  const grabOffsetRef = useRef({ dx: 0, dy: 0 });
  const extractFiredRef = useRef(false);
  const extractHoldStartRef = useRef(0);
  /** 0..1 while the extraction pinch is being held; null otherwise. */
  const [extractProgress, setExtractProgress] = useState<number | null>(null);

  // New selection → snap the ghost back onto the object.
  useEffect(() => {
    setT({ x: 0, y: 0, scale: 1 });
  }, [region]);

  // Report live card-space bounds up so the external callout layer can attach
  // leader lines to the (draggable, scalable) ghost.
  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;
  useEffect(() => {
    onBoundsRef.current?.({
      x: region.x + t.x,
      y: region.y + t.y,
      w: region.w * t.scale,
      h: region.h * t.scale,
    });
  }, [region, t]);

  // Make the extraction moment unmistakable: flash a badge when the ghost is
  // born (phase enters "placing").
  const [extractedFlash, setExtractedFlash] = useState(false);
  const prevPhaseRef = useRef<BuildPhase>(phase);
  useEffect(() => {
    if (phase === "placing" && prevPhaseRef.current !== "placing") {
      setExtractedFlash(true);
      const id = setTimeout(() => setExtractedFlash(false), 1200);
      prevPhaseRef.current = phase;
      return () => clearTimeout(id);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

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

  /** A drag (hand or touch) ended — in "placing" this pins the ghost; in
   *  pinned/recording/review it just updates the stored placement. */
  const releaseDrag = useCallback(() => {
    const ph = phaseRef.current;
    if (ph === "placing" || ph === "pinned" || ph === "recording" || ph === "review") {
      onPinnedRef.current?.(tRef.current);
    }
  }, []);

  // Hand state machine. Roles by phase:
  //  selected: pinch inside the box → extract request (no ghost grab yet).
  //  placing: any active pinch grabs the ghost; release pins it.
  //  pinned+: hover → pinch-grab (or wrist dwell) → drag → release re-pins.
  useEffect(() => {
    if (!handPointer && modeRef.current === "idle") return; // nothing to do
    const tick = () => {
      const now = Date.now();
      const p = handRef.current;
      const fresh = p != null && now - p.timestampMs <= HAND_STALE_MS;
      const pn = pinchRef.current;
      const ph = phaseRef.current;

      // Touch drag always wins — hand control yields immediately.
      if (dragRef.current) {
        setModeBoth("idle");
        return;
      }

      if (!fresh) {
        if (modeRef.current === "grab" || modeRef.current === "dragging") {
          if (now - lastSeenRef.current > HAND_LOST_RELEASE_MS) {
            releaseDrag(); // wrist fallback: tracking lost while dragging → pin
            setModeBoth("idle");
          }
        } else {
          setModeBoth("idle");
          if (!pn?.active) extractFiredRef.current = false;
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

      // ── "selected"/"extracting": the box is the EXTRACTION SOURCE ──
      // The pinch must be HELD inside the box for BUILD_EXTRACT_HOLD_MS (a
      // mini countdown clock fills) before extraction fires — accidental
      // pinches don't create mistake blueprints.
      if (ph === "selected" || ph === "extracting") {
        if (ph === "selected" && pn?.active && inside && !extractFiredRef.current) {
          if (extractHoldStartRef.current === 0) extractHoldStartRef.current = now;
          const progress = Math.min(1, (now - extractHoldStartRef.current) / BUILD_EXTRACT_HOLD_MS);
          setExtractProgress(progress);
          if (progress >= 1) {
            extractFiredRef.current = true;
            extractHoldStartRef.current = 0;
            setExtractProgress(null);
            onExtractRef.current?.();
          }
        } else {
          extractHoldStartRef.current = 0;
          setExtractProgress(null);
          if (!pn?.active) extractFiredRef.current = false;
        }
        setModeBoth(inside ? "hover" : "idle");
        return;
      }

      // ── "placing": ghost is attached to the hand ──
      if (ph === "placing" && pn != null) {
        if (pn.active) {
          if (modeRef.current !== "grab" && modeRef.current !== "dragging") {
            // Attach: grab wherever the pinch is (inside → keep relative grip;
            // outside → hold the ghost by its centre).
            grabOffsetRef.current = inside
              ? { dx: p.x - bounds.x, dy: p.y - bounds.y }
              : { dx: bounds.w / 2, dy: bounds.h / 2 };
            setModeBoth("grab");
          }
          const nx = p.x - reg.x - grabOffsetRef.current.dx;
          const ny = p.y - reg.y - grabOffsetRef.current.dy;
          if (Math.abs(nx - cur.x) > 0.002 || Math.abs(ny - cur.y) > 0.002) {
            setT((prev) => ({ ...prev, x: nx, y: ny }));
            setModeBoth("dragging");
          }
        } else if (modeRef.current === "grab" || modeRef.current === "dragging") {
          releaseDrag(); // pinch released → pin the blueprint here
          setModeBoth(inside ? "hover" : "idle");
        } else {
          setModeBoth(inside ? "hover" : "idle");
        }
        return;
      }

      // ── pinned / recording / review (and placing without MediaPipe) ──
      if (pn != null) {
        // Finger control: hover → pinch to grab → drag → release re-pins.
        switch (modeRef.current) {
          case "idle":
            if (inside) setModeBoth("hover");
            break;
          case "hover":
            if (!inside) {
              setModeBoth("idle");
            } else if (pn.active) {
              grabOffsetRef.current = { dx: p.x - bounds.x, dy: p.y - bounds.y };
              setModeBoth("grab");
            }
            break;
          case "grab":
          case "dragging": {
            if (!pn.active) {
              releaseDrag();
              setModeBoth(inside ? "hover" : "idle");
              break;
            }
            const nx = p.x - reg.x - grabOffsetRef.current.dx;
            const ny = p.y - reg.y - grabOffsetRef.current.dy;
            if (Math.abs(nx - cur.x) > 0.002 || Math.abs(ny - cur.y) > 0.002) {
              setT((prev) => ({ ...prev, x: nx, y: ny }));
              setModeBoth("dragging");
            }
            break;
          }
        }
        return;
      }

      // ── Wrist fallback (no MediaPipe): dwell-to-grab ──
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
  }, [handPointer, setModeBoth, releaseDrag]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const host = hostRef.current?.parentElement; // the camera-card layer
      if (!host) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setModeBoth("idle"); // touch takes over from hand control
      // Touch fallback for extraction: touching the selected box pulls the
      // blueprint too (drag continues seamlessly once it appears).
      if (phaseRef.current === "selected") onExtractRef.current?.();
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

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      dragRef.current = null;
      releaseDrag(); // touch drag-end can pin the blueprint too
    },
    [releaseDrag],
  );

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

  const isSource = phase === "selected" || phase === "extracting";
  const isPlacing = phase === "placing";
  const detached = Math.abs(t.x) > 0.01 || Math.abs(t.y) > 0.01 || Math.abs(t.scale - 1) > 0.01;
  const handEngaged = handMode === "grab" || handMode === "dragging";
  const borderColor = isSource
    ? "rgba(34,211,238,0.95)" // glowing source box awaiting the pinch
    : handEngaged || isPlacing
      ? "rgba(251,191,36,0.95)" // amber: attached to the hand
      : handMode === "hover"
        ? "rgba(125,211,252,0.95)"
        : "rgba(56,189,248,0.65)";

  return (
    <div
      ref={hostRef}
      // No whole-object pulse — the ghost stays stable after pinch release.
      // State is conveyed by the subtle glow/border only.
      className="absolute z-30 touch-none select-none rounded-md"
      style={{
        left: `${(region.x + t.x) * 100}%`,
        top: `${(region.y + t.y) * 100}%`,
        width: `${region.w * t.scale * 100}%`,
        height: `${region.h * t.scale * 100}%`,
        boxShadow:
          handEngaged || isPlacing
            ? "0 0 26px rgba(251,191,36,0.45)"
            : isSource
              ? "0 0 24px rgba(34,211,238,0.55)"
              : "0 0 22px rgba(56,189,248,0.35)",
        border: `${isSource || isPlacing || handMode !== "idle" ? 2 : 1}px ${
          isSource ? "dashed" : "solid"
        } ${borderColor}`,
        background: isSource ? "rgba(34,211,238,0.08)" : "rgba(2,16,28,0.25)",
        backdropFilter: isSource ? undefined : "blur(1px)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Ghost content: nothing inside the source box; once extracted, the
          layered object-ghost (actual crop + mask + wireframe). */}
      {!isSource && frame && (
        <BlueprintOverlay
          frame={frame}
          sourceAsset={sourceAsset}
          visualMode={visualMode}
          showBlueprintDebugLabels={showBlueprintDebugLabels}
        />
      )}
      {/* Never leave the user staring at nothing: a visible shell while the
          ghost exists but its frame hasn't arrived yet. (isSource already
          excludes the selected/extracting phases.) */}
      {!isSource && !frame && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-amber-300/80 bg-cyan-400/5">
          <span className="text-[10px] font-bold tracking-widest text-amber-200">
            BLUEPRINT SHELL
          </span>
          <span className="text-[9px] text-cyan-200/80">waiting for frame…</span>
        </div>
      )}
      {phase === "extracting" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-200" />
          <span className="text-[10px] font-medium text-cyan-200">Extracting blueprint…</span>
        </div>
      )}
      {extractedFlash && (
        <div className="pointer-events-none absolute inset-x-0 -top-8 text-center">
          <span className="animate-pulse rounded-full bg-amber-400/90 px-2.5 py-1 text-[10px] font-bold text-black shadow-[0_0_18px_rgba(251,191,36,0.9)]">
            ✓ Blueprint extracted
          </span>
        </div>
      )}
      {/* Hold-to-extract countdown clock, centered on the box. */}
      {phase === "selected" && extractProgress != null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <PinchHoldRing progress={extractProgress} label="hold to extract…" />
        </div>
      )}
      {phase === "selected" && (
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center gap-1">
          <span className="pointer-events-none rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-medium text-cyan-200 backdrop-blur">
            Hold pinch 4s here to extract blueprint
          </span>
          {/* Touch/test fallback — separates pinch hit-testing problems from
              capture/render problems. */}
          <button
            type="button"
            className="rounded-full border border-cyan-300/70 bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-cyan-200 backdrop-blur active:bg-cyan-500/30"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onExtractRef.current?.();
            }}
          >
            Extract blueprint
          </button>
        </div>
      )}

      {/* hand-control badge while a hand is engaging the ghost */}
      {!isSource && (handMode === "hover" || handEngaged || isPlacing) && (
        <div className="pointer-events-none absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-black/70 px-1.5 py-0.5 backdrop-blur">
          <Hand className={`h-3 w-3 ${handEngaged ? "text-amber-300" : "text-cyan-200"}`} />
          <span className={`text-[9px] ${handEngaged ? "text-amber-300" : "text-cyan-200"}`}>
            {isPlacing
              ? "Release to pin blueprint"
              : pinch != null
                ? handEngaged
                  ? "pinching"
                  : "pinch to grab"
                : handEngaged
                  ? "dragging"
                  : "hold to grab"}
          </span>
        </div>
      )}

      {/* grip + controls — travel with the ghost (not on the source box) */}
      {!isSource && (
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
          {isPlacing && (
            <button
              type="button"
              aria-label="Pin blueprint here"
              className="text-amber-300 hover:text-white"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={releaseDrag}
            >
              <Pin className="h-3 w-3" />
            </button>
          )}
          {detached && !isPlacing && (
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
      )}
    </div>
  );
}
