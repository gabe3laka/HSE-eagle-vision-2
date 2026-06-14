import { useMemo } from "react";
import { mirrorPointX } from "@/lib/detection/mirror";
import { HologramScanFx } from "./HologramScanFx";
import type {
  PlanAssemblyStep,
  PlanSceneBlueprint,
  PlanSceneObject,
  SelectedRegion,
} from "../types";

/**
 * Holographic Scene Canvas renderer (Plan Mode multi-object planning).
 *
 * Draws a PlanSceneBlueprint as a 2.5D hologram over the camera card: every
 * detected object is a cyan translucent ghost; ONLY the active step's object
 * animates from its current position to its target (CSS transform transition),
 * with a from→to arrow, an amber target ring, and a readable instruction card.
 * Completed objects go green, warnings pulse red. NO real 3D, NO point cloud,
 * NO video — pure SVG vectors + CSS transitions.
 *
 * Coordinates: objects are region-local 0..1; we map them to CARD space via the
 * selected region, then into the 0..100 SVG viewBox. The selfie `mirrored`
 * preview flips geometry horizontally at draw time (matching the other
 * overlays) while text stays readable (re-positioned, never CSS-flipped).
 *
 * Guards: if the active step has no objectId we show its callout only (no
 * movement, no crash); an empty scene renders nothing.
 */

const CYAN = "rgba(34,211,238,1)";
const CYAN_SOFT = "rgba(34,211,238,0.16)";
const CYAN_GHOST = "rgba(56,189,248,0.6)";
const AMBER = "rgba(251,191,36,1)";
const GREEN = "rgba(52,211,153,1)";
const RED = "rgba(248,113,113,1)";

/** Per-state stroke/fill palette (matches the BlueprintOverlay hologram look). */
function objectColors(state: PlanSceneObject["state"]): { stroke: string; fill: string } {
  switch (state) {
    case "placed":
      return { stroke: GREEN, fill: "rgba(52,211,153,0.16)" };
    case "warning":
      return { stroke: RED, fill: "rgba(248,113,113,0.16)" };
    case "moving":
      return { stroke: AMBER, fill: "rgba(251,191,36,0.16)" };
    case "highlighted":
      return { stroke: CYAN, fill: CYAN_SOFT };
    case "idle":
    default:
      return { stroke: CYAN_GHOST, fill: CYAN_SOFT };
  }
}

interface CardPoint {
  x: number;
  y: number;
}

export function PlanHologramRenderer({
  scene,
  region,
  mirrored = false,
}: {
  scene: PlanSceneBlueprint;
  /** The selected scene region in card space (region-local coords map through it). */
  region: SelectedRegion;
  /** Selfie preview: flip geometry horizontally, keep text readable. */
  mirrored?: boolean;
}) {
  // Region-local 0..1 → CARD 0..1 (then ×100 for the viewBox). The mirror flip
  // is applied in CARD space so objects land on the mirrored real-world parts.
  const toCard = useMemo(() => {
    return (p: CardPoint): CardPoint => {
      const cardX = region.x + p.x * region.w;
      const cardY = region.y + p.y * region.h;
      return { x: mirrorPointX(cardX, mirrored) * 100, y: cardY * 100 };
    };
  }, [region, mirrored]);

  const activeStep: PlanAssemblyStep | undefined =
    scene.assemblySteps[scene.currentStepIndex] ??
    scene.assemblySteps.find((s) => s.status === "active");
  const activeObject = activeStep?.objectId
    ? scene.objects.find((o) => o.id === activeStep.objectId)
    : undefined;

  if (scene.objects.length === 0 && !activeStep) return null;

  // Active object animates current→target; everything else stays put.
  const activeTo = activeObject?.target ?? (activeStep?.to ? activeStep.to : undefined);

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Optional ASCILINE-inspired FX (scanlines/shimmer/particles). Guarded:
          off by default, reduced-motion aware, never blocks interaction, and
          isolated so a failure can't break planning. Centered on the active
          object (card space). */}
      <HologramScanFx
        active
        focus={activeObject ? toCardFraction(activeObject.current, region, mirrored) : null}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* Static ghosts: every non-active object as a translucent outline. */}
        {scene.objects.map((obj) => {
          const isActive = obj.id === activeObject?.id;
          if (isActive) return null;
          return <ObjectGhost key={obj.id} obj={obj} at={obj.current} toCard={toCard} />;
        })}

        {/* Arrow from→to for the active move. */}
        {activeObject && activeTo && (
          <MoveArrow from={toCard(activeObject.current)} to={toCard(activeTo)} />
        )}

        {/* Amber target ring where the active object is heading. */}
        {activeTo && <TargetRing at={toCard(activeTo)} />}

        {/* The active object — animates to its target via a CSS transform on a
            wrapper <g>. When it has no target it just highlights in place. */}
        {activeObject && (
          <ActiveObject
            obj={activeObject}
            from={toCard(activeObject.current)}
            to={activeTo ? toCard(activeTo) : toCard(activeObject.current)}
            warning={activeStep?.status === "active" && activeObject.state === "warning"}
          />
        )}
      </svg>

      {/* Readable instruction card for the active step (text outside tiny SVG). */}
      {activeStep && (
        <InstructionCard
          step={activeStep}
          anchor={
            activeObject
              ? toCardFraction(activeTo ?? activeObject.current, region, mirrored)
              : { x: 0.5, y: 0.5 }
          }
          stepNumber={scene.currentStepIndex + 1}
          stepTotal={scene.assemblySteps.length}
        />
      )}
    </div>
  );
}

/** Region-local point → card FRACTION (0..1), mirror-aware (for HTML overlays). */
function toCardFraction(
  p: CardPoint,
  region: SelectedRegion,
  mirrored: boolean,
): { x: number; y: number } {
  const cardX = region.x + p.x * region.w;
  const cardY = region.y + p.y * region.h;
  return { x: mirrorPointX(cardX, mirrored), y: cardY };
}

/** A single object's shape at a given position: mask contour when present,
 *  otherwise its bbox rectangle. Both translated so the shape centers on `at`. */
function objectShape(
  obj: PlanSceneObject,
  at: CardPoint,
  toCard: (p: CardPoint) => CardPoint,
):
  | { kind: "polygon"; points: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number } {
  const dx = at.x - obj.center.x;
  const dy = at.y - obj.center.y;
  if (obj.maskContour && obj.maskContour.length >= 3) {
    const points = obj.maskContour
      .map((p) => {
        const c = toCard({ x: p.x + dx, y: p.y + dy });
        return `${c.x},${c.y}`;
      })
      .join(" ");
    return { kind: "polygon", points };
  }
  // bbox rect → card corners (mirror can swap left/right, so normalize).
  const tl = toCard({ x: obj.bbox.x + dx, y: obj.bbox.y + dy });
  const br = toCard({ x: obj.bbox.x + obj.bbox.w + dx, y: obj.bbox.y + obj.bbox.h + dy });
  const x = Math.min(tl.x, br.x);
  const y = Math.min(tl.y, br.y);
  return { kind: "rect", x, y, w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y) };
}

function ShapeNode({
  obj,
  at,
  toCard,
  stroke,
  fill,
  strokeWidth = 0.8,
  dashed = false,
}: {
  obj: PlanSceneObject;
  at: CardPoint;
  toCard: (p: CardPoint) => CardPoint;
  stroke: string;
  fill: string;
  strokeWidth?: number;
  dashed?: boolean;
}) {
  const shape = objectShape(obj, at, toCard);
  const common = {
    fill,
    stroke,
    strokeWidth,
    strokeLinejoin: "round" as const,
    ...(dashed ? { strokeDasharray: "1.6 1.2" } : {}),
  };
  if (shape.kind === "polygon") return <polygon points={shape.points} {...common} />;
  return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={1} {...common} />;
}

/** A static (non-active) object ghost. */
function ObjectGhost({
  obj,
  at,
  toCard,
}: {
  obj: PlanSceneObject;
  at: CardPoint;
  toCard: (p: CardPoint) => CardPoint;
}) {
  const { stroke, fill } = objectColors(obj.state);
  const center = toCard(at);
  return (
    <g opacity={obj.state === "idle" ? 0.72 : 0.95}>
      <ShapeNode obj={obj} at={at} toCard={toCard} stroke={stroke} fill={fill} />
      <circle cx={center.x} cy={center.y} r={0.7} fill={stroke} opacity={0.8} />
    </g>
  );
}

/** The active object: rendered at its FROM position, then CSS-transformed to its
 *  TO position (translate in viewBox units) so the move animates smoothly. */
function ActiveObject({
  obj,
  from,
  to,
  warning,
}: {
  obj: PlanSceneObject;
  from: CardPoint;
  to: CardPoint;
  warning?: boolean;
}) {
  const { stroke, fill } = objectColors(warning ? "warning" : "moving");
  const tx = to.x - from.x;
  const ty = to.y - from.y;
  // Draw the shape anchored at the object's CURRENT (from) center in viewBox
  // space, then translate the whole group by the from→to delta so the move
  // animates smoothly via the CSS transition.
  return (
    <g
      style={{
        transform: `translate(${tx}px, ${ty}px)`,
        transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      className={warning ? "animate-pulse" : undefined}
    >
      {/* Re-anchor the shape so its center sits on `from` in viewBox space. */}
      <g transform={`translate(${from.x}, ${from.y})`}>
        <ShapeNodeCentered obj={obj} stroke={stroke} fill={fill} strokeWidth={1.1} />
      </g>
    </g>
  );
}

/** Active object's shape, drawn centered on the local origin (0,0). */
function ShapeNodeCentered({
  obj,
  stroke,
  fill,
  strokeWidth,
}: {
  obj: PlanSceneObject;
  stroke: string;
  fill: string;
  strokeWidth: number;
}) {
  // Express the shape relative to its own center, scaled to viewBox units.
  if (obj.maskContour && obj.maskContour.length >= 3) {
    const points = obj.maskContour
      .map((p) => `${(p.x - obj.center.x) * 100},${(p.y - obj.center.y) * 100}`)
      .join(" ");
    return (
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  }
  const w = obj.bbox.w * 100;
  const h = obj.bbox.h * 100;
  return (
    <rect
      x={-w / 2}
      y={-h / 2}
      width={w}
      height={h}
      rx={1}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}

/** Movement arrow from→to (amber), with a small arrowhead. */
function MoveArrow({ from, to }: { from: CardPoint; to: CardPoint }) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  if (!Number.isFinite(ang)) return null;
  const head = 3;
  const a1 = ang + Math.PI - 0.42;
  const a2 = ang + Math.PI + 0.42;
  return (
    <g opacity={0.95}>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={AMBER}
        strokeWidth={1}
        strokeLinecap="round"
        strokeDasharray="2.4 1.6"
      />
      <line
        x1={to.x}
        y1={to.y}
        x2={to.x + Math.cos(a1) * head}
        y2={to.y + Math.sin(a1) * head}
        stroke={AMBER}
        strokeWidth={1}
        strokeLinecap="round"
      />
      <line
        x1={to.x}
        y1={to.y}
        x2={to.x + Math.cos(a2) * head}
        y2={to.y + Math.sin(a2) * head}
        stroke={AMBER}
        strokeWidth={1}
        strokeLinecap="round"
      />
    </g>
  );
}

/** Amber target ring (where the active object should land). */
function TargetRing({ at }: { at: CardPoint }) {
  return (
    <g opacity={0.95} className="animate-pulse">
      <circle cx={at.x} cy={at.y} r={5} fill="none" stroke={AMBER} strokeWidth={0.7} />
      <circle cx={at.x} cy={at.y} r={2.4} fill="none" stroke={AMBER} strokeWidth={0.7} />
      <line x1={at.x - 6.5} y1={at.y} x2={at.x + 6.5} y2={at.y} stroke={AMBER} strokeWidth={0.4} />
      <line x1={at.x} y1={at.y - 6.5} x2={at.x} y2={at.y + 6.5} stroke={AMBER} strokeWidth={0.4} />
    </g>
  );
}

/** Readable floating instruction card for the active step (HTML, not SVG). */
function InstructionCard({
  step,
  anchor,
  stepNumber,
  stepTotal,
}: {
  step: PlanAssemblyStep;
  anchor: { x: number; y: number };
  stepNumber: number;
  stepTotal: number;
}) {
  // Place the card on the side of the anchor with the most room; clamp inside.
  const onLeft = anchor.x > 0.55;
  const top = Math.max(0.04, Math.min(0.82, anchor.y - 0.06));
  const style: React.CSSProperties = onLeft
    ? { right: `${(1 - anchor.x) * 100 + 4}%`, top: `${top * 100}%` }
    : { left: `${anchor.x * 100 + 4}%`, top: `${top * 100}%` };
  return (
    <div
      className="absolute z-[1] max-w-[44%] rounded-md border px-2 py-1.5 shadow-lg backdrop-blur-sm"
      style={{
        ...style,
        borderColor: step.safetyNote ? "rgba(248,113,113,0.9)" : "rgba(251,191,36,0.7)",
        background: step.safetyNote ? "rgba(69,10,10,0.92)" : "rgba(69,46,5,0.92)",
      }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-200/90">
        Step {stepNumber} / {stepTotal}
      </p>
      <p className="mt-0.5 text-[11px] font-medium leading-tight text-white/95">{step.title}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-white/80">{step.instruction}</p>
      {step.safetyNote && (
        <p className="mt-0.5 text-[10px] font-medium leading-tight text-red-200">
          ⚠ {step.safetyNote}
        </p>
      )}
      {step.qualityCheck && (
        <p className="mt-0.5 text-[10px] leading-tight text-emerald-200">✓ {step.qualityCheck}</p>
      )}
    </div>
  );
}
