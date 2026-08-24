/* The tile dissolve, instrumentation dressing and loupe bezel adapt ThreeUI's
 * KoiStudies, UplinkLoader and Sketchbook (github.com/MengTo/threeui, MIT,
 * © Meng To / Design+Code) — see THIRD_PARTY_NOTICES.md. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  artToBox,
  clampLensCenter,
  sliceLayout,
  SWEEP_PATH,
  sweepPosition,
  type Layout,
} from "./heroSceneCore";
import {
  decayTrail,
  ENTRY_MS,
  isCellRevealed,
  pushTrailPoint,
  smoothstep,
  tileSizeFor,
  type TrailPoint,
} from "./dissolveCore";
import { grainTextures } from "./grainTextures";
import { SensorMarks } from "./SensorMarks";
import { SceneArt } from "./SceneArt";

const BACK_W = 480; // fixed canvas backing store (16:9, matches the viewBox)
const BACK_H = 270;

/**
 * The landing lens, rendered as a tile dissolve: an opaque cover canvas shows
 * the clean scene and destination-out holes resolve the sensor view beneath
 * it, cell by cell, with a ragged noise edge and a decaying wake. Pointer
 * moves touch CSS vars + the canvas only; React never re-renders per move.
 */
export function HeroScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geomRef = useRef({ nx: 0.51, ny: 0.68, r: 84 });
  const trailRef = useRef<TrailPoint[]>([]);
  const coverRef = useRef<HTMLImageElement | null>(null);
  const coverUrlRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);
  const lastRef = useRef(0);
  const entryRef = useRef(0);
  const interactedRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const sweepStartRef = useRef(0);
  const prevRef = useRef<{ x: number; y: number } | null>(null);

  const [layout, setLayout] = useState<Layout>(() => sliceLayout(672, 378));
  const [coverReady, setCoverReady] = useState(false);
  const [grain, setGrain] = useState<{ mul: string; add: string } | null>(null);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const applyVars = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const g = geomRef.current;
    el.style.setProperty("--lx", `${(g.nx * layoutRef.current.w).toFixed(1)}px`);
    el.style.setProperty("--ly", `${(g.ny * layoutRef.current.h).toFixed(1)}px`);
    el.style.setProperty("--lr", `${g.r}px`);
  }, []);
  const layoutRef = useRef<Layout>(sliceLayout(672, 378));

  /** One dissolve pass over the cover canvas. */
  const paint = useCallback((entry: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const L = layoutRef.current;
    if (!canvas || !ctx || L.w === 0) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, BACK_W, BACK_H);
    const img = coverRef.current;
    if (img) {
      ctx.drawImage(
        img,
        (L.ox * BACK_W) / L.w,
        (L.oy * BACK_H) / L.h,
        (160 * L.s * BACK_W) / L.w,
        (90 * L.s * BACK_H) / L.h,
      );
    }
    ctx.globalCompositeOperation = "destination-out";
    const g = geomRef.current;
    const points: TrailPoint[] = [
      { x: g.nx * L.w, y: g.ny * L.h, radius: g.r, life: 1 },
      ...trailRef.current,
    ];
    const tile = tileSizeFor(L.w);
    const cols = Math.ceil(L.w / tile);
    const rows = Math.ceil(L.h / tile);
    const bw = (tile * BACK_W) / L.w;
    const bh = (tile * BACK_H) / L.h;
    // Only scan cells the trail can possibly reach — not the whole grid.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const reach = p.radius + tile;
      minX = Math.min(minX, p.x - reach);
      maxX = Math.max(maxX, p.x + reach);
      minY = Math.min(minY, p.y - reach);
      maxY = Math.max(maxY, p.y + reach);
    }
    const c0 = Math.max(0, Math.floor(minX / tile));
    const c1 = Math.min(cols - 1, Math.ceil(maxX / tile));
    const r0 = Math.max(0, Math.floor(minY / tile));
    const r1 = Math.min(rows - 1, Math.ceil(maxY / tile));
    ctx.fillStyle = "#000";
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (isCellRevealed((c + 0.5) * tile, (r + 0.5) * tile, c, r, tile, points, entry)) {
          ctx.fillRect(c * bw - 0.3, r * bh - 0.3, bw + 0.6, bh + 0.6);
        }
      }
    }
  }, []);

  /** Master loop: auto-sweep + trail decay + dissolve. Idles to zero when the
   *  wake is gone, the entry is complete and the sweep is off. */
  const tick = useCallback(
    (now: number) => {
      if (!aliveRef.current) {
        runningRef.current = false;
        return;
      }
      const dt = Math.min(48, Math.max(0, now - lastRef.current));
      lastRef.current = now;
      const L = layoutRef.current;

      const sweeping = !interactedRef.current && sweepStartRef.current > 0;
      if (sweeping) {
        const pos = sweepPosition(now - sweepStartRef.current);
        const prev = prevRef.current;
        // The sweep is authored in ART space; map it through the slice crop
        // so the dwells land on the forklift on any viewport shape.
        const bp = artToBox(pos.x, pos.y, L);
        if (prev && Math.hypot(bp.x - prev.x, bp.y - prev.y) > 3) {
          trailRef.current = pushTrailPoint(trailRef.current, prev.x, prev.y, geomRef.current.r);
        }
        prevRef.current = { x: bp.x, y: bp.y };
        geomRef.current.nx = bp.x / L.w;
        geomRef.current.ny = bp.y / L.h;
        applyVars();
      }

      trailRef.current = decayTrail(trailRef.current, dt);
      const entryRaw = (now - entryRef.current) / ENTRY_MS;
      paint(smoothstep(entryRaw));

      if (sweeping || trailRef.current.length > 0 || entryRaw < 1) {
        requestAnimationFrame(tick);
      } else {
        runningRef.current = false;
      }
    },
    [applyVars, paint],
  );

  const ensureLoop = useCallback(() => {
    if (runningRef.current || reducedMotion) return;
    runningRef.current = true;
    lastRef.current = performance.now();
    requestAnimationFrame(tick);
  }, [reducedMotion, tick]);

  const takeControl = useCallback(() => {
    interactedRef.current = true;
    sweepStartRef.current = 0;
    if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
  }, []);

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const p = clampLensCenter(clientX - rect.left, clientY - rect.top, {
        w: rect.width,
        h: rect.height,
      });
      const g = geomRef.current;
      trailRef.current = pushTrailPoint(
        trailRef.current,
        g.nx * rect.width,
        g.ny * rect.height,
        g.r,
      );
      g.nx = p.x / rect.width;
      g.ny = p.y / rect.height;
      applyVars();
      if (reducedMotion) paint(1);
      else ensureLoop();
    },
    [applyVars, ensureLoop, paint, reducedMotion],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    aliveRef.current = true; // StrictMode re-runs the effect after cleanup
    setGrain(grainTextures());

    const measure = () => {
      const r = el.getBoundingClientRect();
      const L = sliceLayout(r.width, r.height);
      layoutRef.current = L;
      setLayout(L);
      geomRef.current.r = Math.round(
        Math.min(200, Math.max(72, Math.min(L.s * 19, Math.min(r.width, r.height) * 0.34))),
      );
      if (!interactedRef.current) {
        const park = artToBox(SWEEP_PATH[1].x, SWEEP_PATH[1].y, L);
        geomRef.current.nx = park.x / L.w;
        geomRef.current.ny = park.y / L.h;
      }
      applyVars();
      if (reducedMotion) paint(1);
      else ensureLoop();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    // Build the opaque cover from the clean scene's own SVG — one raster.
    const svg = baseRef.current?.querySelector("svg");
    if (svg) {
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute("width", "1600");
      clone.setAttribute("height", "900");
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        // NOTE: the blob URL must stay alive — Chromium rasterizes SVG images
        // lazily at draw time, and a revoked URL draws nothing.
        coverRef.current = img;
        coverUrlRef.current = url;
        setCoverReady(true);
        entryRef.current = performance.now();
        if (reducedMotion) paint(1);
        else ensureLoop();
      };
      img.src = url;
    }

    if (!reducedMotion) {
      idleTimerRef.current = window.setTimeout(() => {
        if (!interactedRef.current) {
          sweepStartRef.current = performance.now();
          prevRef.current = null;
          ensureLoop();
        }
      }, 2000);
    }

    return () => {
      aliveRef.current = false;
      ro.disconnect();
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
      if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const still = reducedMotion;
  return (
    <div>
      <div
        ref={rootRef}
        data-testid="hero-scene"
        className="fixed inset-0 z-0 select-none overflow-hidden"
        style={
          {
            touchAction: "pan-y",
            "--lx": "52%",
            "--ly": "66%",
            "--lr": "84px",
          } as React.CSSProperties
        }
        onPointerDown={(e) => {
          takeControl();
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse" && !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          takeControl();
          moveTo(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        {/* sensor view — fully painted, revealed only through the dissolve */}
        <div data-testid="hero-reveal" className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{ filter: "saturate(0.55) brightness(0.6) contrast(1.06)" }}
          >
            <SceneArt />
          </div>
          <div className="absolute inset-0" style={{ background: "rgba(34,211,238,0.05)" }} />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: "radial-gradient(rgba(34,211,238,0.8) 1px, transparent 1px)",
              backgroundSize: "14px 14px",
            }}
          />
          {grain && (
            <>
              <div
                className="absolute"
                style={{
                  inset: -60,
                  backgroundImage: `url(${grain.mul})`,
                  backgroundRepeat: "repeat",
                  backgroundSize: "80px 80px",
                  mixBlendMode: "overlay",
                  opacity: 0.34,
                  animation: still ? undefined : "hero-grain-shift .6s steps(1,end) infinite",
                }}
              />
              <div
                className="absolute"
                style={{
                  inset: -60,
                  backgroundImage: `url(${grain.add})`,
                  backgroundRepeat: "repeat",
                  backgroundSize: "80px 80px",
                  opacity: 0.03,
                  animation: still ? undefined : "hero-grain-shift .72s steps(1,end) infinite",
                }}
              />
            </>
          )}
          <div
            className="absolute inset-0"
            style={{
              opacity: 0.18,
              background:
                "repeating-linear-gradient(to bottom, rgba(165,243,252,.05) 0 1px, transparent 1px 3px)",
            }}
          />
          <SensorMarks layout={layout} still={still} />
        </div>

        {/* clean scene under the canvas until its raster is ready (no flash) */}
        <div ref={baseRef} className="absolute inset-0" style={{ opacity: coverReady ? 0 : 1 }}>
          <SceneArt />
        </div>
        <canvas
          ref={canvasRef}
          width={BACK_W}
          height={BACK_H}
          className="absolute inset-0 h-full w-full"
          aria-hidden
        />

        {/* the loupe: a true annulus over the glass (Sketchbook's mask stops) */}
        <div
          className="pointer-events-none absolute"
          style={{
            left: "calc(var(--lx) - var(--lr))",
            top: "calc(var(--ly) - var(--lr))",
            width: "calc(var(--lr) * 2)",
            height: "calc(var(--lr) * 2)",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "linear-gradient(146deg, #cfe0ea 0%, #93a9b8 14%, #55707f 32%, #2c3c49 50%, #7d94a4 66%, #c3d6e2 80%, #3f5666 100%)",
              boxShadow: "inset 0 1px 1px rgba(255,255,255,.8), inset 0 -2px 3px rgba(16,36,48,.5)",
              WebkitMaskImage:
                "radial-gradient(circle closest-side at 50% 50%, transparent 0 88.2%, #000 89.8% 100%)",
              maskImage:
                "radial-gradient(circle closest-side at 50% 50%, transparent 0 88.2%, #000 89.8% 100%)",
              filter: "drop-shadow(0 6px 16px rgba(2,8,14,.45))",
            }}
          />
          {/* highlight arc, upper-left of the ring */}
          <div
            className="absolute rounded-full"
            style={{
              inset: "1.5%",
              border: "2px solid transparent",
              borderTopColor: "rgba(255,255,255,.4)",
              borderLeftColor: "rgba(255,255,255,.18)",
              transform: "rotate(-12deg)",
            }}
          />
          {/* 1px cyan line where glass meets bezel */}
          <div
            className="absolute rounded-full"
            style={{ inset: "5.4%", border: "1px solid rgba(34,211,238,.4)" }}
          />
        </div>
      </div>
    </div>
  );
}
