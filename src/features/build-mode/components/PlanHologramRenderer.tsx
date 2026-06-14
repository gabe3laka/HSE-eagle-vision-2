import { useId, useMemo } from "react";
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
 * Draws a PlanSceneBlueprint as a 2.5D hologram over the camera card: a faint
 * cyan perspective "cutting-mat" grid behind everything, every detected object
 * as a HYBRID ghost (a cyan-tinted real-crop fill clipped to its shape PLUS a
 * glowing cyan wireframe outline) tagged with a numbered badge + label pill.
 * ONLY the active step's object animates from its current position to its target
 * (CSS transform transition), glowing amber with a from→to dashed arrow, an
 * amber target ring, and a readable instruction card. Completed objects go
 * green, warnings pulse red. NO real 3D, NO point cloud, NO video — pure SVG
 * vectors + CSS transitions.
 *
 * Coordinates: objects are region-local 0..1; we map them to CARD space via the
 * selected region, then into the 0..100 SVG viewBox. The selfie `mirrored`
 * preview flips geometry horizontally at draw time (matching the other
 * overlays) while text stays readable (re-positioned, never CSS-flipped).
 *
 * Hybrid crop: `assetImage` is the FULL region crop (a data URL). Region-local
 * 0..1 maps 1:1 onto that image, so we draw it across the whole region rect and
 * clip it per-object to each object's shape (SVG <clipPath>). No image →
 * wireframe-only fallback (never breaks). On the mirrored selfie the image is
 * flipped horizontally to line up with the flipped geometry.
 *
 * Guards: if the active step has no objectId we show its callout only (no
 * movement, no crash); an empty scene renders nothing.
 */

const CYAN = "rgba(34,211,238,1)";
const CYAN_SOFT = "rgba(34,211,238,0.16)";
const CYAN_GHOST = "rgba(56,189,248,0.6)";
const CYAN_TINT = "rgba(34,211,238,0.34)"; // wash over the real-crop fill
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
  assetImage,
}: {
  scene: PlanSceneBlueprint;
  /** The selected scene region in card space (region-local coords map through it). */
  region: SelectedRegion;
  /** Selfie preview: flip geometry horizontally, keep text readable. */
  mirrored?: boolean;
  /** Optional FULL region crop (data URL) for the hybrid real-crop fill. When
   *  absent the objects render wireframe-only — never breaks. */
  assetImage?: string;
}) {
  const uid = useId().replace(/:/g, "");
  // Region-local 0..1 → CARD 0..1 (then ×100 for the viewBox). The mirror flip
  // is applied in CARD space so objects land on the mirrored real-world parts.
  const toCard = useMemo(() => {
    return (p: CardPoint): CardPoint => {
      const cardX = region.x + p.x * region.w;
      const cardY = region.y + p.y * region.h;
      return { x: mirrorPointX(cardX, mirrored) * 100, y: cardY * 100 };
    };
  }, [region, mirrored]);

  // The region rect in viewBox space (where the full crop image is painted).
  const regionRect = useMemo(() => {
    const a = toCard({ x: 0, y: 0 });
    const b = toCard({ x: 1, y: 1 });
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  }, [toCard]);

  const activeStep: PlanAssemblyStep | undefined =
    scene.assemblySteps[scene.currentStepIndex] ??
    scene.assemblySteps.find((s) => s.status === "active");
  const activeObject = activeStep?.objectId
    ? scene.objects.find((o) => o.id === activeStep.objectId)
    : undefined;

  if (scene.objects.length === 0 && !activeStep) return null;

  // Active object animates current→target; everything else stays put.
  const activeTo = activeObject?.target ?? (activeStep?.to ? activeStep.to : undefined);
  const hasCrop = !!assetImage;

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
        <defs>
          {/* Faint cyan perspective grid ("cutting-mat") behind the objects. */}
          <pattern id={`plan-grid-${uid}`} width="6.5" height="6.5" patternUnits="userSpaceOnUse">
            <path
              d="M 6.5 0 L 0 0 0 6.5"
              fill="none"
              stroke="rgba(34,211,238,0.16)"
              strokeWidth={0.22}
            />
          </pattern>
          {/* One clip path per object so the full-region crop is masked to each
              object's shape (region-local; mirror-aware via toCard). */}
          {hasCrop &&
            scene.objects.map((obj) => (
              <clipPath
                key={`clip-${obj.id}`}
                id={`plan-clip-${uid}-${obj.id}`}
                clipPathUnits="userSpaceOnUse"
              >
                <ClipShape obj={obj} at={obj.current} toCard={toCard} />
              </clipPath>
            ))}
        </defs>

        {/* Perspective grid — subtle, always on (cheap). Clipped to the region. */}
        <PerspectiveGrid rect={regionRect} gridId={`plan-grid-${uid}`} />

        {/* Static ghosts: every non-active object as a hybrid (crop fill +
            wireframe outline). The active object is drawn separately so it can
            animate. */}
        {scene.objects.map((obj) => {
          const isActive = obj.id === activeObject?.id;
          if (isActive) return null;
          return (
            <ObjectGhost
              key={obj.id}
              obj={obj}
              at={obj.current}
              toCard={toCard}
              clipId={hasCrop ? `plan-clip-${uid}-${obj.id}` : undefined}
              assetImage={assetImage}
              regionRect={regionRect}
              mirrored={mirrored}
            />
          );
        })}

        {/* Numbered badge + label pill for every object (anchored to its center). */}
        {scene.objects.map((obj, i) => (
          <ObjectBadge
            key={`badge-${obj.id}`}
            obj={obj}
            number={i + 1}
            at={obj.current}
            toCard={toCard}
            active={obj.id === activeObject?.id}
          />
        ))}

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
            clipId={hasCrop ? `plan-clip-${uid}-${activeObject.id}` : undefined}
            assetImage={assetImage}
            regionRect={regionRect}
            mirrored={mirrored}
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

/** Subtle cyan perspective grid behind the objects, clipped to the region rect. */
function PerspectiveGrid({
  rect,
  gridId,
}: {
  rect: { x: number; y: number; w: number; h: number };
  gridId: string;
}) {
  if (rect.w <= 0 || rect.h <= 0) return null;
  return (
    <g opacity={0.8}>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={`url(#${gridId})`} />
      {/* A faint outline frames the planning surface like a cutting mat. */}
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        fill="none"
        stroke="rgba(34,211,238,0.22)"
        strokeWidth={0.3}
      />
    </g>
  );
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

/** The plain shape geometry node used inside a <clipPath> (no styling). */
function ClipShape({
  obj,
  at,
  toCard,
}: {
  obj: PlanSceneObject;
  at: CardPoint;
  toCard: (p: CardPoint) => CardPoint;
}) {
  const shape = objectShape(obj, at, toCard);
  if (shape.kind === "polygon") return <polygon points={shape.points} />;
  return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={1} />;
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

/** The cyan-tinted real-crop fill for one object: the full-region image painted
 *  across the region rect, clipped to the object's shape, washed cyan. Mirror
 *  flips the image horizontally to match the flipped geometry. */
function CropFill({
  clipId,
  assetImage,
  regionRect,
  mirrored,
}: {
  clipId: string;
  assetImage: string;
  regionRect: { x: number; y: number; w: number; h: number };
  mirrored: boolean;
}) {
  if (regionRect.w <= 0 || regionRect.h <= 0) return null;
  // Flip the painted image horizontally about the region's center on the selfie
  // preview so the crop lines up with the mirrored geometry/clip.
  const transform = mirrored
    ? `translate(${2 * regionRect.x + regionRect.w}, 0) scale(-1, 1)`
    : undefined;
  return (
    <g clipPath={`url(#${clipId})`}>
      <g transform={transform}>
        <image
          href={assetImage}
          x={regionRect.x}
          y={regionRect.y}
          width={regionRect.w}
          height={regionRect.h}
          preserveAspectRatio="none"
          opacity={0.55}
        />
      </g>
      {/* Cyan wash so the real crop reads as a hologram, not a photo. */}
      <rect
        x={regionRect.x}
        y={regionRect.y}
        width={regionRect.w}
        height={regionRect.h}
        fill={CYAN_TINT}
      />
    </g>
  );
}

/** A static (non-active) object ghost — hybrid (crop fill + wireframe outline). */
function ObjectGhost({
  obj,
  at,
  toCard,
  clipId,
  assetImage,
  regionRect,
  mirrored,
}: {
  obj: PlanSceneObject;
  at: CardPoint;
  toCard: (p: CardPoint) => CardPoint;
  clipId?: string;
  assetImage?: string;
  regionRect: { x: number; y: number; w: number; h: number };
  mirrored: boolean;
}) {
  const { stroke, fill } = objectColors(obj.state);
  const center = toCard(at);
  return (
    <g opacity={obj.state === "idle" ? 0.78 : 0.96}>
      {clipId && assetImage && (
        <CropFill
          clipId={clipId}
          assetImage={assetImage}
          regionRect={regionRect}
          mirrored={mirrored}
        />
      )}
      <ShapeNode
        obj={obj}
        at={at}
        toCard={toCard}
        stroke={stroke}
        fill={clipId && assetImage ? "none" : fill}
      />
      <circle cx={center.x} cy={center.y} r={0.7} fill={stroke} opacity={0.8} />
    </g>
  );
}

/** A small circular numbered badge + label pill for an object, anchored above
 *  its shape. HTML-free (SVG) so it lives in the same flipped viewBox; the text
 *  is upright (mirror flips position only, never the glyphs). */
function ObjectBadge({
  obj,
  number,
  at,
  toCard,
  active,
}: {
  obj: PlanSceneObject;
  number: number;
  at: CardPoint;
  toCard: (p: CardPoint) => CardPoint;
  active: boolean;
}) {
  const shape = objectShape(obj, at, toCard);
  // Anchor the badge at the top-center of the object's bounds, clamped inside.
  let bx: number;
  let topY: number;
  if (shape.kind === "rect") {
    bx = shape.x + shape.w / 2;
    topY = shape.y;
  } else {
    const c = toCard(at);
    bx = c.x;
    topY = c.y - 4;
  }
  const cx = Math.max(4, Math.min(96, bx));
  const cy = Math.max(4, topY - 2.6);
  const color = active ? AMBER : CYAN;
  const label = (obj.label || "object").slice(0, 16);
  // Approximate pill width from the label length (viewBox units).
  const pillW = Math.min(40, 6 + label.length * 1.85);
  const pillLeft = Math.max(1, Math.min(99 - pillW, cx + 2.6));
  return (
    <g>
      {/* Numbered circular badge. */}
      <circle cx={cx} cy={cy} r={2.4} fill="rgba(2,16,28,0.82)" stroke={color} strokeWidth={0.5} />
      <text x={cx} y={cy + 1.1} fontSize={3} fontWeight={700} textAnchor="middle" fill={color}>
        {number}
      </text>
      {/* Label pill to the right of the badge. */}
      <rect
        x={pillLeft}
        y={cy - 2}
        width={pillW}
        height={4}
        rx={2}
        fill="rgba(2,16,28,0.78)"
        stroke={color}
        strokeWidth={0.3}
        opacity={0.95}
      />
      <text
        x={pillLeft + 1.6}
        y={cy + 1}
        fontSize={2.6}
        fontWeight={600}
        fill={active ? "#fde68a" : "#a5f3fc"}
      >
        {label}
      </text>
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
  clipId,
  assetImage,
  regionRect,
  mirrored,
}: {
  obj: PlanSceneObject;
  from: CardPoint;
  to: CardPoint;
  warning?: boolean;
  clipId?: string;
  assetImage?: string;
  regionRect: { x: number; y: number; w: number; h: number };
  mirrored: boolean;
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
      {/* The hybrid crop fill is anchored at the object's current position
          (clipped via its clipPath, which is computed at `current`); it rides
          along with the translate so it tracks the moving outline. */}
      {clipId && assetImage && (
        <CropFill
          clipId={clipId}
          assetImage={assetImage}
          regionRect={regionRect}
          mirrored={mirrored}
        />
      )}
      {/* Re-anchor the shape so its center sits on `from` in viewBox space. */}
      <g transform={`translate(${from.x}, ${from.y})`}>
        <ShapeNodeCentered
          obj={obj}
          stroke={stroke}
          fill={clipId && assetImage ? "none" : fill}
          strokeWidth={1.1}
        />
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
