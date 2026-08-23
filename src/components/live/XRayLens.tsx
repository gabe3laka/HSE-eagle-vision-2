import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { BackendPoseOverlay } from "@/components/live/BackendPoseOverlay";
import { mirrorPoints } from "@/lib/detection/mirror";
import { riskLevelColor } from "@/lib/detection/riskTypes";
import type { BackendEntity, BackendPose, DetectionZone } from "@/lib/detection/types";
import type { HSETrack } from "@/lib/detection/hseTypes";
import type { LensContext } from "@/features/report-composer/lib/reasoningClient";
import {
  isLensRenderable,
  lensDisplayBox,
  matchEntityForTrack,
  pickFocusedTrack,
} from "./xrayLensCore";

/** EagleVisionHUD's category palette — same tints, never a new palette. */
const CATEGORY_TINT: Record<string, string> = {
  person: "rgba(34,211,238,0.9)",
  vehicle: "rgba(251,191,36,0.95)",
  ppe: "rgba(52,211,153,0.9)",
  "fall-hazard": "rgba(249,115,22,0.9)",
  "trip-hazard": "rgba(251,191,36,0.85)",
  "fire-safety": "rgba(248,113,113,0.9)",
  "access-egress": "rgba(125,211,252,0.9)",
};
const tint = (cat: string) => CATEGORY_TINT[cat] ?? "rgba(125,211,252,0.6)";

const ZONE_TINT: Record<DetectionZone["kind"], string> = {
  restricted: "rgba(248,113,113,0.5)",
  exit: "rgba(52,211,153,0.5)",
};

const MIN_R = 60; // px radius (120px diameter)
const MAX_R = 180; // px radius (360px diameter)
const NUDGE_PX = 8;

function defaultRadius(): number {
  if (typeof window === "undefined") return 100;
  const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
  return Math.min(130, Math.max(75, 22 * vmin)); // diameter clamp(150px, 44vmin, 260px)
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

type Phase = "hidden" | "tracking" | "pinned";

/**
 * X-Ray Lens — a draggable loupe over the live camera. Outside the circle the
 * operator sees the clean feed; inside it, a perfectly aligned "sensor view":
 * dot grid, track wireframes, skeletons, zone hatching and deterministic
 * S×L risk tiles (display only — scores come from the worker, never computed
 * here). Additive: every existing overlay keeps rendering untouched.
 *
 * Pointer-move updates only CSS custom properties via rAF — React re-renders
 * happen only on pin/unpin/dismiss and when the focused entity changes.
 */
export function XRayLens({
  tracks,
  poses,
  entities,
  zones,
  mirrored,
  disabled,
  flagEnabled,
  reasoningSource,
  onLensContext,
}: {
  tracks: HSETrack[];
  poses: BackendPose[];
  entities: BackendEntity[];
  zones: DetectionZone[];
  mirrored: boolean;
  /** True while zone editing or scan-focus capture own the video gestures. */
  disabled: boolean;
  flagEnabled: boolean;
  reasoningSource?: string | null;
  onLensContext?: (ctx: LensContext | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef({ x: 0, y: 0, r: defaultRadius() });
  const rafRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);
  const pinchRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    baseDist: number;
    baseR: number;
  } | null>(null);
  const lastTapRef = useRef(0);
  const dragMovedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("hidden");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const renderable = isLensRenderable({ flagEnabled, disabled });

  /** Latest track/entity data for rAF + effects without re-subscribing. */
  const dataRef = useRef({ tracks, entities });
  dataRef.current = { tracks, entities };
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const applyGeom = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const g = geomRef.current;
    el.style.setProperty("--lx", `${g.x}px`);
    el.style.setProperty("--ly", `${g.y}px`);
    el.style.setProperty("--lr", `${g.r}px`);
  }, []);

  const computeFocus = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const id = pickFocusedTrack(
      dataRef.current.tracks,
      geomRef.current,
      { w: rect.width, h: rect.height },
      mirrored,
    );
    setFocusedId((prev) => (prev === id ? prev : id));
  }, [mirrored]);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyGeom();
      computeFocus();
    });
  }, [applyGeom, computeFocus]);

  /** Debounced (400ms) settle → aria-live announcement of the focused object. */
  const scheduleSettle = useCallback(() => {
    if (settleRef.current != null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      if (phaseRef.current === "hidden") return;
      const t = dataRef.current.tracks.find((tr) => tr.id === focusedRef.current);
      if (!t) {
        setAnnounce("Lens settled. No object in focus.");
        return;
      }
      const e = matchEntityForTrack(t, dataRef.current.entities);
      setAnnounce(`Lens focused on ${t.label}${e?.risk_level ? `, risk ${e.risk_level}` : ""}.`);
    }, 400);
  }, []);
  const focusedRef = useRef<string | null>(null);
  focusedRef.current = focusedId;

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      geomRef.current.x = clientX - rect.left;
      geomRef.current.y = clientY - rect.top;
      scheduleFrame();
      scheduleSettle();
    },
    [scheduleFrame, scheduleSettle],
  );

  const dismiss = useCallback(() => {
    setPhase("hidden");
    setFocusedId(null);
    setAnnounce("");
  }, []);

  // Recompute focus while pinned as tracks drift under the glass.
  useEffect(() => {
    if (phase !== "hidden") computeFocus();
  }, [phase, tracks, computeFocus]);

  // Emit lens context: pinned + focused → freeze a context snapshot; else null.
  useEffect(() => {
    if (!onLensContext) return;
    if (phase !== "pinned" || !focusedId) {
      onLensContext(null);
      return;
    }
    const t = dataRef.current.tracks.find((tr) => tr.id === focusedId);
    if (!t) {
      onLensContext(null);
      return;
    }
    const e = matchEntityForTrack(t, dataRef.current.entities);
    onLensContext({
      track_id: t.id,
      label: t.label,
      category: t.category,
      bbox: { ...t.bbox },
      risk_level: e?.risk_level,
      severity: e?.severity,
      likelihood: e?.likelihood,
      risk_reason: e?.risk_reason,
      recommended_action: e?.recommended_action,
      produced_by: e?.produced_by,
      frame_ts: Date.now(),
    });
    // Intentionally NOT depending on tracks/entities: the context freezes at
    // pin/focus time instead of chasing every frame.
  }, [phase, focusedId, onLensContext]);

  // Hide (and release context) whenever the lens becomes non-renderable.
  useEffect(() => {
    if (!renderable && phase !== "hidden") dismiss();
  }, [renderable, phase, dismiss]);

  // Keyboard: x toggles, arrows nudge a pinned lens, Escape dismisses.
  useEffect(() => {
    if (!renderable) return;
    const onKey = (ev: KeyboardEvent) => {
      if (isTypingTarget(ev.target)) return;
      if (ev.key === "x" || ev.key === "X") {
        if (phaseRef.current === "hidden") {
          const el = rootRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          geomRef.current.x = rect.width / 2;
          geomRef.current.y = rect.height / 2;
          setPhase("pinned");
          scheduleFrame();
          scheduleSettle();
        } else {
          dismiss();
        }
        return;
      }
      if (phaseRef.current !== "pinned") return;
      if (ev.key === "Escape") {
        dismiss();
        return;
      }
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-NUDGE_PX, 0],
        ArrowRight: [NUDGE_PX, 0],
        ArrowUp: [0, -NUDGE_PX],
        ArrowDown: [0, NUDGE_PX],
      };
      const d = nudge[ev.key];
      if (d) {
        ev.preventDefault();
        geomRef.current.x += d[0];
        geomRef.current.y += d[1];
        scheduleFrame();
        scheduleSettle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renderable, dismiss, scheduleFrame, scheduleSettle]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (settleRef.current != null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  if (!renderable) return null;

  /* ---- capture-surface handlers (tracking phase; pinned uses the bezel) --- */

  const onSurfacePointerMove = (ev: React.PointerEvent) => {
    if (ev.pointerType === "mouse" && phase !== "pinned") {
      if (phase === "hidden") setPhase("tracking");
      moveTo(ev.clientX, ev.clientY);
    } else if (phase === "tracking" && ev.pointerType !== "mouse") {
      dragMovedRef.current = true;
      moveTo(ev.clientX, ev.clientY);
    }
  };

  const onSurfacePointerDown = (ev: React.PointerEvent) => {
    if (ev.pointerType === "mouse") {
      // Desktop: the lens already follows the hover — a click pins it here.
      moveTo(ev.clientX, ev.clientY);
      setPhase("pinned");
    } else {
      // Mobile: appear where touched, drag to move, lift to pin.
      dragMovedRef.current = false;
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      moveTo(ev.clientX, ev.clientY);
      setPhase("tracking");
    }
  };

  const onSurfacePointerUp = (ev: React.PointerEvent) => {
    if (ev.pointerType !== "mouse" && phase === "tracking") setPhase("pinned");
  };

  const onSurfacePointerLeave = (ev: React.PointerEvent) => {
    if (ev.pointerType === "mouse" && phase === "tracking") dismiss();
  };

  /* ---- bezel handlers (pinned): unpin, drag, pinch-resize, double-tap ----- */

  const onBezelPointerDown = (ev: React.PointerEvent) => {
    ev.stopPropagation();
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const pinch = pinchRef.current ?? {
      pointers: new Map(),
      baseDist: 0,
      baseR: geomRef.current.r,
    };
    pinch.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch.pointers.size === 2) {
      const [a, b] = [...pinch.pointers.values()];
      pinch.baseDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.baseR = geomRef.current.r;
    }
    pinchRef.current = pinch;
    dragMovedRef.current = false;
  };

  const onBezelPointerMove = (ev: React.PointerEvent) => {
    const pinch = pinchRef.current;
    if (!pinch || !pinch.pointers.has(ev.pointerId)) return;
    ev.stopPropagation();
    pinch.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch.pointers.size >= 2 && pinch.baseDist > 0) {
      const [a, b] = [...pinch.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      geomRef.current.r = Math.min(MAX_R, Math.max(MIN_R, (pinch.baseR * dist) / pinch.baseDist));
      scheduleFrame();
    } else if (ev.pointerType !== "mouse") {
      // One-finger drag on the bezel repositions a pinned lens.
      dragMovedRef.current = true;
      moveTo(ev.clientX, ev.clientY);
    }
  };

  const onBezelPointerUp = (ev: React.PointerEvent) => {
    ev.stopPropagation();
    const pinch = pinchRef.current;
    pinch?.pointers.delete(ev.pointerId);
    if (pinch && pinch.pointers.size < 2) pinch.baseDist = 0;
    if (ev.pointerType === "mouse") {
      // Click the bezel to unpin (back to hover-tracking).
      setPhase("tracking");
      return;
    }
    if (!dragMovedRef.current) {
      const now = performance.now();
      if (now - lastTapRef.current < 320) {
        dismiss(); // double-tap the bezel dismisses
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
    }
  };

  /* ---- reveal content (display space; mirrored geometry) ------------------ */

  const focusedTrack = focusedId ? tracks.find((t) => t.id === focusedId) : undefined;
  const focusedEntity = focusedTrack ? matchEntityForTrack(focusedTrack, entities) : null;
  const rulesOnly =
    !focusedEntity?.risk_reason &&
    (focusedEntity?.produced_by === "rules" || reasoningSource === "rules" || !focusedEntity);

  return (
    <div
      ref={rootRef}
      data-testid="xray-lens-root"
      data-phase={phase}
      className="absolute inset-0 z-40"
      style={{ pointerEvents: phase === "pinned" ? "none" : "auto", touchAction: "none" }}
      onPointerMove={onSurfacePointerMove}
      onPointerDown={onSurfacePointerDown}
      onPointerUp={onSurfacePointerUp}
      onPointerLeave={onSurfacePointerLeave}
    >
      {phase !== "hidden" && (
        <>
          {/* Reveal layer — the "sensor view", clipped to the lens circle. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: "circle(var(--lr) at var(--lx) var(--ly))" }}
            data-testid="xray-reveal"
          >
            {/* Faint cyan dot-grid ground so the lens reads as instrumentation. */}
            <div
              className="absolute inset-0 bg-cyan-950/25"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, rgba(34,211,238,0.5) 1px, transparent 1px)",
                backgroundSize: "14px 14px",
                opacity: 0.35,
              }}
            />

            {/* Zone membership: hatched polygon fills (45°, 6px pitch). */}
            {zones.map((z) => {
              const pts = mirrorPoints(z.points, mirrored)
                .map((p) => `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`)
                .join(", ");
              return (
                <div
                  key={z.id}
                  className="absolute inset-0"
                  style={{
                    clipPath: `polygon(${pts})`,
                    backgroundImage: `repeating-linear-gradient(45deg, ${ZONE_TINT[z.kind]} 0 1px, transparent 1px 6px)`,
                  }}
                />
              );
            })}

            {/* Track wireframes: corner ticks for stable, dashed for unstable. */}
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              {tracks.map((t) => {
                const b = lensDisplayBox(t.bbox, mirrored);
                const x = b.x * 100;
                const y = b.y * 100;
                const w = b.w * 100;
                const h = b.h * 100;
                const isFocused = t.id === focusedId;
                const color = tint(t.category);
                const sw = isFocused ? 2 : 1;
                if (!t.stable) {
                  return (
                    <rect
                      key={t.id}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill="none"
                      stroke={color}
                      strokeWidth={sw}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                      style={isFocused ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
                    />
                  );
                }
                const L = Math.max(1.5, Math.min(5, Math.min(w, h) * 0.28));
                const d = [
                  `M ${x} ${y + L} L ${x} ${y} L ${x + L} ${y}`,
                  `M ${x + w - L} ${y} L ${x + w} ${y} L ${x + w} ${y + L}`,
                  `M ${x + w} ${y + h - L} L ${x + w} ${y + h} L ${x + w - L} ${y + h}`,
                  `M ${x + L} ${y + h} L ${x} ${y + h} L ${x} ${y + h - L}`,
                ].join(" ");
                return (
                  <path
                    key={t.id}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    style={isFocused ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
                  />
                );
              })}
            </svg>

            {/* Skeletons: reuse the existing pose overlay verbatim. */}
            <BackendPoseOverlay poses={poses} mirrored={mirrored} />

            {/* Deterministic risk tiles ([LEVEL] S×L=score · produced_by). */}
            {entities.map((e, i) => {
              if (!e.risk_level && e.severity == null) return null;
              const b = lensDisplayBox(e.bbox, mirrored);
              const isFocusTile = !!focusedEntity && focusedEntity === e;
              const level = e.risk_level;
              const bg = riskLevelColor(level).replace(/0\.9\d\)/, "0.85)");
              return (
                <div
                  key={e.track_id ?? `${e.label}-${i}`}
                  className="absolute -translate-y-full pb-0.5"
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, maxWidth: "70%" }}
                >
                  <div
                    className="w-fit rounded-sm px-1 py-0.5 font-mono text-[10px] leading-tight text-slate-950"
                    style={{ background: bg }}
                  >
                    [{String(level ?? "—").toUpperCase()}] S{e.severity ?? "?"}×L
                    {e.likelihood ?? "?"}
                    {e.risk_score != null ? `=${e.risk_score}` : ""}
                    {e.produced_by ? (
                      <span className="ml-1 text-[9px] opacity-80">{e.produced_by}</span>
                    ) : null}
                  </div>
                  {/* Focused entity: the tile expands into the reason card. */}
                  {isFocusTile && (
                    <div className="mt-0.5 w-56 max-w-full rounded-md border border-cyan-200/30 bg-slate-950/90 px-2 py-1.5 text-[11px] leading-snug text-cyan-50">
                      {e.risk_reason && !rulesOnly ? (
                        <>
                          <p className="line-clamp-2">{e.risk_reason}</p>
                          {e.recommended_action && (
                            <p className="mt-0.5 text-cyan-200/90">→ {e.recommended_action}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-cyan-200/70">rules only</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Slow scan sweep — instrumentation flourish, killed by reduced motion. */}
            {!reducedMotion && (
              <div
                className="animate-scan absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent"
                aria-hidden
              />
            )}
          </div>

          {/* Bezel — the one interactive element of the lens itself. */}
          <div
            data-testid="xray-bezel"
            role="button"
            aria-label={phase === "pinned" ? "Lens pinned — click to unpin" : "Lens"}
            className="absolute rounded-full border border-cyan-200/40 shadow-[0_0_34px_rgba(34,211,238,0.22)]"
            style={{
              left: "var(--lx)",
              top: "var(--ly)",
              width: "calc(var(--lr) * 2)",
              height: "calc(var(--lr) * 2)",
              transform: "translate(-50%, -50%)",
              boxShadow:
                "inset 0 0 0 1px rgba(34,211,238,0.25), 0 0 34px rgba(34,211,238,0.22), 0 8px 30px rgba(0,0,0,0.35)",
              pointerEvents: "auto",
              touchAction: "none",
            }}
            onPointerDown={onBezelPointerDown}
            onPointerMove={onBezelPointerMove}
            onPointerUp={onBezelPointerUp}
          >
            {phase === "pinned" && (
              <span
                data-testid="xray-pin"
                className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/40 bg-slate-950/90 p-1 text-cyan-200"
              >
                <Lock className="h-3 w-3" aria-hidden />
              </span>
            )}
          </div>
        </>
      )}

      {/* Screen-reader narration of what the settled lens focuses. */}
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
    </div>
  );
}
