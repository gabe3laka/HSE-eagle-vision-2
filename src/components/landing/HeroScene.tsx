import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  clampLensCenter,
  riskTileText,
  SCENE_OBJECTS,
  sweepPosition,
  ZONE_POINTS,
} from "./heroSceneCore";
import { riskLevelColor } from "@/lib/detection/riskTypes";

/* Scene space: 160×90 units (16:9). `slice` keeps base art and overlays in the
 * SAME cropped coordinate system on every viewport, so alignment is exact. */
const VB = "0 0 160 90";
const SX = 160;
const SY = 90;
const pt = (p: { x: number; y: number }) => `${p.x * SX},${p.y * SY}`;

/** The illustrated warehouse bay — drawn twice (base + sensor copy) so the
 *  lens reveals a perfectly aligned second view. Muted, low-contrast: it is a
 *  backdrop for the hero, not an illustration showcase. */
function SceneArt() {
  return (
    <svg
      viewBox={VB}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      {/* back wall, teal rim light at the horizon, slate ground */}
      <rect width="160" height="52" fill="#0c1420" />
      <rect y="50" width="160" height="2.5" fill="rgba(45,212,191,0.16)" />
      <rect y="52" width="160" height="38" fill="#141e2c" />
      <path d="M0 90 L40 52 M160 90 L120 52 M80 52 L80 90" stroke="#1b2736" strokeWidth="0.6" />
      {/* wall panels + high window strip */}
      <path d="M20 0 V50 M60 0 V50 M100 0 V50 M140 0 V50" stroke="#111a28" strokeWidth="0.8" />
      <rect x="8" y="6" width="144" height="7" fill="#12202e" stroke="#1c2c3d" strokeWidth="0.5" />
      {/* pallet stack (left) */}
      <g stroke="#0b1220" strokeWidth="0.5">
        <rect x="16" y="34" width="19" height="9" fill="#33405280" />
        <rect x="15" y="43" width="21" height="10" fill="#3a475a" />
        <rect x="15.5" y="53" width="20" height="10" fill="#42506480" />
        <path d="M15 56 h21 M15 46 h21" stroke="#25324475" strokeWidth="1.2" />
        <rect x="14" y="61.5" width="23" height="2.4" fill="#4a3b28" />
      </g>
      {/* floor-marked pedestrian walkway (the forklift is crossing it) */}
      <polygon
        points={ZONE_POINTS.map(pt).join(" ")}
        fill="rgba(45,212,191,0.03)"
        stroke="rgba(45,212,191,0.28)"
        strokeWidth="0.7"
        strokeDasharray="3 2.2"
      />
      {/* worker near the pallets */}
      <g>
        <circle cx="47.2" cy="38.5" r="2.6" fill="#94a3b8" />
        <rect x="44.3" y="41.6" width="5.8" height="9.5" rx="1.6" fill="#f59e0b" opacity="0.7" />
        <rect x="44.3" y="44" width="5.8" height="2" fill="#cbd5e1" opacity="0.5" />
        <path
          d="M45.6 51 L45 62 M48.8 51 L49.6 62"
          stroke="#64748b"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      {/* forklift crossing, forks toward the worker */}
      <g stroke="#0b1220" strokeWidth="0.5">
        <rect x="74" y="45" width="17" height="11" rx="1.5" fill="#8a6d1f" opacity="0.8" />
        <rect x="82" y="37.5" width="8" height="8.5" rx="1" fill="#3c4a5e" />
        <rect x="83.6" y="39" width="4.8" height="4" fill="#141e2c" />
        <rect x="70.5" y="38" width="2" height="21" fill="#475569" />
        <path d="M70.5 58 H62.5 M70.5 55 H62.5" stroke="#94a3b8" strokeWidth="1.4" />
        <circle cx="78" cy="59.5" r="3.4" fill="#1e293b" stroke="#475569" strokeWidth="0.8" />
        <circle cx="88.5" cy="59.5" r="2.7" fill="#1e293b" stroke="#475569" strokeWidth="0.8" />
        <rect x="90" y="42" width="2.4" height="3" fill="#fbbf24" opacity="0.5" />
      </g>
      {/* exit door (right) with a pallet part-blocking it */}
      <g>
        <rect
          x="128"
          y="28"
          width="17"
          height="36"
          fill="#0f1a26"
          stroke="#233448"
          strokeWidth="0.8"
        />
        <rect x="130" y="31" width="13" height="33" fill="#16283a" />
        <rect x="135.4" y="46" width="1.6" height="4.5" rx="0.8" fill="#64748b" />
        <rect
          x="129.5"
          y="22.5"
          width="14"
          height="4.4"
          rx="0.8"
          fill="rgba(52,211,153,0.35)"
          stroke="rgba(52,211,153,0.5)"
          strokeWidth="0.4"
        />
        <rect
          x="124.5"
          y="50"
          width="14"
          height="9"
          fill="#3a475a"
          stroke="#0b1220"
          strokeWidth="0.5"
        />
        <rect x="123.6" y="59" width="15.6" height="2.4" fill="#4a3b28" />
      </g>
    </svg>
  );
}

/** Sensor-side annotations: hatched zone + corner-tick outlines, in the Live
 *  category tints, plus authored `[LEVEL] S×L` tiles. SVG text keeps the tiles
 *  aligned with the art under the mobile `slice` crop. */
function SensorMarks() {
  const ticks = useMemo(
    () =>
      SCENE_OBJECTS.map((o) => {
        const x = o.bbox.x * SX;
        const y = o.bbox.y * SY;
        const w = o.bbox.w * SX;
        const h = o.bbox.h * SY;
        const L = Math.min(5, Math.min(w, h) * 0.3);
        const d = [
          `M${x} ${y + L} V${y} H${x + L}`,
          `M${x + w - L} ${y} H${x + w} V${y + L}`,
          `M${x + w} ${y + h - L} V${y + h} H${x + w - L}`,
          `M${x + L} ${y + h} H${x} V${y + h - L}`,
        ].join(" ");
        return { o, x, y, w, d };
      }),
    [],
  );
  return (
    <svg
      viewBox={VB}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <pattern
          id="hero-hatch"
          width="4"
          height="4"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="4" height="4" fill="rgba(45,212,191,0.06)" />
          <rect width="1" height="4" fill="rgba(45,212,191,0.35)" />
        </pattern>
      </defs>
      <polygon
        points={ZONE_POINTS.map(pt).join(" ")}
        fill="url(#hero-hatch)"
        stroke="rgba(45,212,191,0.55)"
        strokeWidth="0.7"
      />
      {ticks.map(({ o, d }) => (
        <path
          key={o.id}
          d={d}
          fill="none"
          stroke={o.tint}
          strokeWidth={o.level === "RED" ? 2 : 1.4}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />
      ))}
      {ticks.map(({ o, x, y, w }, i) => {
        const label = riskTileText(o);
        const tw = label.length * 1.58 + 3;
        const tx = Math.min(Math.max(x + w / 2 - tw / 2, 1), SX - tw - 1);
        const ty = Math.max(y - (i % 2 ? 10.2 : 5.4), 1.5);
        return (
          <g key={`tile-${o.id}`} data-testid="hero-risk-tile">
            <rect x={tx} y={ty} width={tw} height="4.4" rx="0.9" fill={riskLevelColor(o.level)} />
            <text
              x={tx + tw / 2}
              y={ty + 3.2}
              textAnchor="middle"
              fontSize="2.9"
              textLength={tw - 2.2}
              lengthAdjust="spacingAndGlyphs"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight="600"
              fill="#0b1220"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The landing lens: the X-Ray mechanic from Live, standalone — no camera, no
 * backend, no risk engine. A clipped sensor copy of an illustrated scene the
 * visitor sweeps a lens across. Pointer moves update three CSS custom
 * properties inside requestAnimationFrame; React never re-renders per move.
 * Auto-sweeps after 2s idle (skipped under prefers-reduced-motion) until the
 * first pointer input takes control.
 */
export function HeroScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  /** Normalized lens center + px radius; px derived at apply time. */
  const geomRef = useRef({ nx: 0.52, ny: 0.55, r: 84 });
  const rafRef = useRef<number | null>(null);
  const sweepRafRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const interactedRef = useRef(false);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const apply = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const g = geomRef.current;
    el.style.setProperty("--lx", `${(g.nx * rect.width).toFixed(1)}px`);
    el.style.setProperty("--ly", `${(g.ny * rect.height).toFixed(1)}px`);
    el.style.setProperty("--lr", `${g.r}px`);
  }, []);

  const scheduleApply = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      apply();
    });
  }, [apply]);

  /** First pointer input takes control and stops the demo loop for good. */
  const takeControl = useCallback(() => {
    interactedRef.current = true;
    if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
    if (sweepRafRef.current != null) cancelAnimationFrame(sweepRafRef.current);
    idleTimerRef.current = null;
    sweepRafRef.current = null;
  }, []);

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const p = clampLensCenter(clientX - rect.left, clientY - rect.top, {
        w: rect.width,
        h: rect.height,
      });
      geomRef.current.nx = p.x / rect.width;
      geomRef.current.ny = p.y / rect.height;
      scheduleApply();
    },
    [scheduleApply],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    geomRef.current.r = Math.round(
      Math.min(118, Math.max(56, Math.min(rect.width, rect.height) * 0.32)),
    );
    apply();
    if (reducedMotion) return; // parked over the forklift, still draggable

    idleTimerRef.current = window.setTimeout(() => {
      const start = performance.now();
      const loop = (now: number) => {
        if (interactedRef.current) return;
        const pos = sweepPosition(now - start);
        geomRef.current.nx = pos.x;
        geomRef.current.ny = pos.y;
        apply();
        sweepRafRef.current = requestAnimationFrame(loop);
      };
      sweepRafRef.current = requestAnimationFrame(loop);
    }, 2000);

    return () => {
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
      if (sweepRafRef.current != null) cancelAnimationFrame(sweepRafRef.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [apply, reducedMotion]);

  return (
    <div>
      <div
        ref={rootRef}
        data-testid="hero-scene"
        className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-2xl border border-border sm:aspect-video"
        style={
          {
            boxShadow: "var(--shadow-float)",
            touchAction: "none",
            "--lx": "52%",
            "--ly": "55%",
            "--lr": "84px",
          } as React.CSSProperties
        }
        onPointerDown={(e) => {
          takeControl();
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          // Mouse follows on hover; touch/pen only while pressed (captured).
          if (e.pointerType !== "mouse" && !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          takeControl();
          moveTo(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          // Lifting leaves the lens where it was.
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <SceneArt />

        {/* Sensor view, revealed only inside the lens circle */}
        <div
          data-testid="hero-reveal"
          className="absolute inset-0"
          style={{ clipPath: "circle(var(--lr) at var(--lx) var(--ly))" }}
        >
          <div className="absolute inset-0" style={{ filter: "saturate(0.45) brightness(0.66)" }}>
            <SceneArt />
          </div>
          <div
            className="absolute inset-0 opacity-35"
            style={{
              backgroundImage: "radial-gradient(rgba(34,211,238,0.8) 1px, transparent 1px)",
              backgroundSize: "14px 14px",
            }}
          />
          <SensorMarks />
          {!reducedMotion && (
            <div className="animate-scan absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
          )}
        </div>

        {/* Bezel — same glow language as the Live lens */}
        <div
          className="pointer-events-none absolute rounded-full border border-cyan-200/40"
          style={{
            left: "calc(var(--lx) - var(--lr))",
            top: "calc(var(--ly) - var(--lr))",
            width: "calc(var(--lr) * 2)",
            height: "calc(var(--lr) * 2)",
            boxShadow:
              "inset 0 0 0 1px rgba(34,211,238,0.18), 0 0 22px rgba(34,211,238,0.22), inset 0 0 18px rgba(34,211,238,0.08)",
          }}
        />
      </div>
      {/* Honesty rule: authored numbers, clearly labelled. */}
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Illustrated example — the same lens runs on your live camera.
      </p>
    </div>
  );
}
