import { Component, useEffect, useRef, type ReactNode } from "react";

/**
 * Holographic materialization FX for the Plan scene canvas — a scanline reveal,
 * cyan shimmer, brief noise "materialization", and a few drifting particles near
 * the active object. ASCILINE-INSPIRED look, but built natively here (no
 * ASCILINE code/import, no backend, no video).
 *
 * Hard rules (all enforced):
 *  - OFF by default; only renders when VITE_PLAN_HOLOGRAM_FX === "true".
 *  - Respects prefers-reduced-motion (renders nothing when reduced).
 *  - pointer-events-none — never blocks taps/drags.
 *  - Guarded by an error boundary — if it throws, Plan Mode keeps working.
 */

const FX_ENABLED = import.meta.env.VITE_PLAN_HOLOGRAM_FX === "true";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface FxProps {
  /** Master gate from the renderer (FX still requires the env flag). */
  active: boolean;
  /** Card-fraction (0..1) focus point for particles — usually the active object. */
  focus: { x: number; y: number } | null;
}

/** Error boundary: any FX failure degrades to nothing — planning is never broken. */
class FxBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Swallow — the canvas FX is purely cosmetic.
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

function FxCanvas({ focus }: { focus: FxProps["focus"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const start = performance.now();
    const particles: Particle[] = [];

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

    const draw = (now: number) => {
      if (!running) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);

      // Materialization noise — strong at the start, fades within ~1.2s.
      const materialize = Math.max(0, 1 - t / 1.2);
      if (materialize > 0.01) {
        ctx.save();
        ctx.globalAlpha = 0.12 * materialize;
        for (let i = 0; i < 60; i++) {
          ctx.fillStyle = i % 2 ? "rgba(34,211,238,1)" : "rgba(125,211,252,1)";
          const px = Math.random() * w;
          const py = Math.random() * h;
          ctx.fillRect(px, py, 2, 2);
        }
        ctx.restore();
      }

      // Scanline reveal — a soft cyan band sweeping top→bottom.
      const bandY = ((t * 0.22) % 1) * h;
      const grad = ctx.createLinearGradient(0, bandY - 26, 0, bandY + 26);
      grad.addColorStop(0, "rgba(34,211,238,0)");
      grad.addColorStop(0.5, "rgba(34,211,238,0.16)");
      grad.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, bandY - 26, w, 52);

      // Faint horizontal scanlines (CRT shimmer).
      ctx.save();
      ctx.globalAlpha = 0.05 + 0.02 * Math.sin(t * 2);
      ctx.strokeStyle = "rgba(125,211,252,1)";
      ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();

      // Particles near the active object.
      const f = focusRef.current;
      if (f) {
        const fx = f.x * w;
        const fy = f.y * h;
        if (particles.length < 26 && Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          const sp = 4 + Math.random() * 10;
          particles.push({
            x: fx + (Math.random() - 0.5) * 14,
            y: fy + (Math.random() - 0.5) * 14,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 6,
            life: 1,
          });
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * 0.016;
        p.y += p.vy * 0.016;
        p.life -= 0.02;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life) * 0.8;
        ctx.fillStyle = "rgba(34,211,238,1)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />;
}

export function HologramScanFx({ active, focus }: FxProps) {
  // Gate: env flag off, master inactive, or reduced-motion → render nothing.
  if (!FX_ENABLED || !active || prefersReducedMotion()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <FxBoundary>
        <FxCanvas focus={focus} />
      </FxBoundary>
    </div>
  );
}
