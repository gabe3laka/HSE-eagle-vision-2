import { useId } from "react";
import { shouldShowBlueprintDebugLabels } from "../lib/debugLabels";
import type {
  BlueprintFrame,
  BlueprintNote,
  BlueprintPlanOverlay,
  BlueprintSourceAsset,
  BlueprintVisualMode,
  VirtualBlueprintPoint,
} from "../types";

const OUTLINE = "rgba(34,211,238,1)"; // bright cyan — must be unmissable
const OUTLINE_GLOW = "rgba(34,211,238,0.35)"; // wide soft underlay = glow
const OUTLINE_BACK = "rgba(56,189,248,0.55)"; // dimmer rear face of the extrusion
const EDGE = "rgba(56,189,248,0.45)"; // front↔back connector edges
const FILL = "rgba(34,211,238,0.16)"; // transparent body, clearly visible
const TINT = "rgba(34,211,238,0.18)"; // hologram wash over the object crop
const ANCHOR = "rgba(186,230,253,1)";
const STEP_BG = "rgba(8,47,73,0.92)";
const HAND = "rgba(252,211,77,0.9)";

/** Per-type colors for AI notes pinned on the blueprint. */
const NOTE_COLOR: Record<BlueprintNote["type"], string> = {
  instruction: "rgba(34,211,238,1)",
  safety: "rgba(248,113,113,1)",
  quality: "rgba(52,211,153,1)",
  observation: "rgba(125,211,252,1)",
  "next-step": "rgba(251,191,36,1)",
  intent: "rgba(196,181,253,1)",
};

// Fake 3D extrusion offset (viewBox units): the back face sits up-left so the
// ghost reads as a shallow wireframe slab, not a flat sticker.
const DEPTH_X = -3.2;
const DEPTH_Y = -3.8;

/**
 * Pure SVG renderer of one blueprint frame, layered bottom→top:
 *
 *   1. source image crop (the ACTUAL pinched object, semi-transparent)
 *   2. SAM2-style mask clipping (when present → floating cutout)
 *   3. cyan/blue hologram tint
 *   4. blueprint grid
 *   5. segmentation outline — or the 2.5D wireframe fallback
 *   6. anchors / sparse points
 *   7. AI-note MARKERS + numbered step markers (+ Plan step markers)
 *   8. Plan visual overlays — arrows / targets / highlights / warning zones
 *
 * Instruction TEXT is intentionally NOT drawn here (too small inside a phone
 * crop) — BlueprintCalloutLayer renders it as external cards with leader lines
 * back to these markers. This overlay keeps only the markers/anchors/overlays.
 *
 * visualMode: "hybrid" (default — crop/mask plus wireframe on top),
 * "object-ghost" (crop/mask + primary outline only), "wireframe" (legacy
 * cyan wireframe, no crop). Frames without a transient crop always render as
 * wireframe. Geometry is region-local 0..1 drawn in a 0..100 viewBox — a
 * technical blueprint illusion, never a real 3D reconstruction. A degenerate
 * outline falls back to an inset bounding box so the ghost always has a body.
 */
export function BlueprintOverlay({
  frame,
  sourceAsset,
  visualMode = "hybrid",
  showBlueprintDebugLabels = false,
}: {
  frame: BlueprintFrame;
  /** v2 pixel store entry for `frame.sourceAssetId` (live crop or saved
   *  thumbnail). Inline v1 frame fields remain the fallback. */
  sourceAsset?: BlueprintSourceAsset;
  visualMode?: BlueprintVisualMode;
  /** Show mask-source/anchor debug text on the ghost (dev only). Default off —
   *  the holographic ghost stays clean. */
  showBlueprintDebugLabels?: boolean;
}) {
  const debugLabels = shouldShowBlueprintDebugLabels(showBlueprintDebugLabels);
  // useId can contain ":" which breaks SVG url(#…) references — strip it.
  const uid = useId().replace(/:/g, "");
  const gridId = `bp-grid-${uid}`;
  const maskId = `bp-mask-${uid}`;

  const asset =
    frame.sourceAssetId && sourceAsset?.id === frame.sourceAssetId ? sourceAsset : undefined;
  const cropB64 = asset?.imageB64 ?? asset?.thumbnailB64 ?? frame.sourceImageB64;
  const maskB64 = asset?.maskB64 ?? frame.sourceMaskB64;
  const hasCrop = !!cropB64 && visualMode !== "wireframe";
  const hasMask = hasCrop && !!maskB64;
  const wireframe = visualMode !== "object-ghost"; // extrusion + glow layers

  // The mask contour (when segmentation produced one) is the PRIMARY object
  // outline; otherwise the frame outline; an inset bounding box is the final
  // fallback so the ghost always has a body.
  const contour = asset?.maskContour ?? frame.maskContour;
  const outlineSrc = contour && contour.length >= 3 ? contour : frame.outline;
  // Tiny debug label: the real segmentation source, or "mask fallback" when the
  // ghost is driven by bbox/wireframe only.
  const maskSrc = asset?.maskSource ?? frame.maskSource;
  const hasContour = !!(contour && contour.length >= 3);
  const maskLabel =
    maskSrc && maskSrc !== "none" ? maskSrc : hasMask || hasContour ? "segmented" : "mask fallback";
  const outline =
    outlineSrc.length >= 3
      ? outlineSrc
      : [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ];
  const front = outline.map((p) => ({ x: p.x * 100, y: p.y * 100 }));
  const back = front.map((p) => ({ x: p.x + DEPTH_X, y: p.y + DEPTH_Y }));
  const frontPts = front.map((p) => `${p.x},${p.y}`).join(" ");
  const backPts = back.map((p) => `${p.x},${p.y}`).join(" ");
  // Connect every other vertex so the extrusion reads without visual noise.
  const connectors = front.filter((_, i) => i % 2 === 0);

  const activeStep =
    frame.planSteps && frame.currentPlanStepIndex != null
      ? frame.planSteps[frame.currentPlanStepIndex]
      : frame.planSteps?.find((s) => s.status === "active");

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <pattern id={gridId} width="10" height="10" patternUnits="userSpaceOnUse">
          <path
            d="M 10 0 L 0 0 0 10"
            fill="none"
            stroke="rgba(56,189,248,0.12)"
            strokeWidth={0.3}
          />
        </pattern>
        {hasMask && (
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            {/* SAM2-style mask: white = object. Luminance-clips the crop+tint
                group into a floating cutout of the real object. */}
            <image
              href={`data:image/png;base64,${maskB64}`}
              x="0"
              y="0"
              width="100"
              height="100"
              preserveAspectRatio="none"
            />
          </mask>
        )}
      </defs>

      {/* 1–4: the ACTUAL object crop, mask-clipped, tinted, grid-washed —
          this is what makes the ghost look like the pinched object. */}
      {hasCrop ? (
        <g mask={hasMask ? `url(#${maskId})` : undefined} opacity={0.88}>
          <image
            href={`data:image/jpeg;base64,${cropB64}`}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="none"
            opacity={0.92}
          />
          <rect x="0" y="0" width="100" height="100" fill={TINT} />
          <rect x="0" y="0" width="100" height="100" fill={`url(#${gridId})`} />
        </g>
      ) : (
        <rect x="0" y="0" width="100" height="100" fill={`url(#${gridId})`} />
      )}

      {/* 5: outline — 2.5D wireframe (glow, back face, connector edges) in
          hybrid/wireframe modes; the primary segmentation/fallback outline
          always. With a crop underneath the front face stays unfilled. */}
      {wireframe && (
        <>
          <polygon
            points={frontPts}
            fill="none"
            stroke={OUTLINE_GLOW}
            strokeWidth={3.4}
            strokeLinejoin="round"
          />
          <polygon
            points={backPts}
            fill="none"
            stroke={OUTLINE_BACK}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
          {connectors.map((p, i) => (
            <line
              key={`edge-${i}`}
              x1={p.x}
              y1={p.y}
              x2={p.x + DEPTH_X}
              y2={p.y + DEPTH_Y}
              stroke={EDGE}
              strokeWidth={0.6}
            />
          ))}
        </>
      )}
      <polygon
        points={frontPts}
        fill={hasCrop ? "none" : FILL}
        stroke={OUTLINE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* identity label — the user must instantly see "a ghost copy was made" */}
      <text x={2.5} y={6} fontSize={4} fontWeight={700} letterSpacing={1.4} fill={OUTLINE}>
        {frame.workflowMode === "plan" ? "PLAN" : "BLUEPRINT"}
      </text>
      {/* Mask-source debug label — DEV + opt-in only. Never on the clean ghost. */}
      {hasCrop && debugLabels && (
        <text x={97.5} y={97.5} fontSize={2.6} textAnchor="end" fill={OUTLINE_BACK}>
          {maskLabel}
        </text>
      )}

      {/* 6: sparse points */}
      {frame.sparsePoints?.map((p, i) => (
        <circle
          key={`sp-${i}`}
          cx={p.x * 100}
          cy={p.y * 100}
          r={0.7}
          fill={OUTLINE}
          opacity={0.6}
        />
      ))}

      {/* anchors */}
      {frame.anchors.map((a) => (
        <g key={a.id}>
          <circle
            cx={a.x * 100}
            cy={a.y * 100}
            r={1.6}
            fill="none"
            stroke={ANCHOR}
            strokeWidth={0.5}
          />
          <circle cx={a.x * 100} cy={a.y * 100} r={0.6} fill={ANCHOR} />
          {/* Anchor names (A1/A2…) are debug-only — hidden on the clean ghost. */}
          {a.label && debugLabels && (
            <text x={a.x * 100 + 2.4} y={a.y * 100 + 1} fontSize={3} fill={ANCHOR}>
              {a.label}
            </text>
          )}
        </g>
      ))}

      {/* hand / tool path — recorded wrist points (1–2 per keyframe), shown as
          subtle pointer dots plus a dashed path when several exist */}
      {frame.handLandmarks && frame.handLandmarks.length > 1 && (
        <polyline
          points={frame.handLandmarks.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
          fill="none"
          stroke={HAND}
          strokeWidth={0.7}
          strokeDasharray="2 1.2"
          strokeLinecap="round"
        />
      )}
      {frame.handLandmarks?.map((p, i) => (
        <g key={`hl-${i}`}>
          <circle
            cx={p.x * 100}
            cy={p.y * 100}
            r={1.4}
            fill="none"
            stroke={HAND}
            strokeWidth={0.5}
          />
          <circle cx={p.x * 100} cy={p.y * 100} r={0.5} fill={HAND} />
          {/* pinch recorded on this keyframe → highlight ring on the points */}
          {frame.gesture?.active && (
            <circle
              cx={p.x * 100}
              cy={p.y * 100}
              r={2.4}
              fill="none"
              stroke={HAND}
              strokeWidth={0.35}
              strokeDasharray="1 0.8"
            />
          )}
        </g>
      ))}

      {/* 7: numbered step markers */}
      {frame.stepMarkers?.map((s) => (
        <g key={s.id}>
          <circle
            cx={s.x * 100}
            cy={s.y * 100}
            r={3.2}
            fill={STEP_BG}
            stroke={OUTLINE}
            strokeWidth={0.5}
          />
          <text
            x={s.x * 100}
            y={s.y * 100 + 1.4}
            fontSize={3.6}
            fontWeight={700}
            textAnchor="middle"
            fill="#e0f2fe"
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* AI-note MARKERS only — the readable text lives in external callout
          cards (BlueprintCalloutLayer) connected here by leader lines. */}
      {frame.aiNotes?.map((n) => (
        <g key={n.id}>
          <circle cx={n.x * 100} cy={n.y * 100} r={1.1} fill={NOTE_COLOR[n.type]} opacity={0.95} />
          <circle
            cx={n.x * 100}
            cy={n.y * 100}
            r={2}
            fill="none"
            stroke={NOTE_COLOR[n.type]}
            strokeWidth={0.35}
            opacity={0.7}
          />
        </g>
      ))}

      {/* Plan visual overlays — arrows (movement), targets / ghost positions
          (where a part should go), highlights (inspect), warning zones. */}
      {frame.planOverlays?.map((ov) => (
        <PlanOverlayShape key={ov.id} overlay={ov} />
      ))}

      {/* Jarvis-style virtual blueprint vector points (DeepSeek/rules). Points
          linked to the active step stay bright; others fade so the ghost never
          clutters. Labels are not drawn here — they live in the callout cards. */}
      {frame.virtualBlueprintPoints?.map((p) => (
        <VirtualPointShape
          key={p.id}
          point={p}
          active={!activeStep || !p.linkedStepId || p.linkedStepId === activeStep.id}
        />
      ))}

      {/* active Plan step marker — the amber "work here" bubble */}
      {activeStep && activeStep.x != null && activeStep.y != null && (
        <g>
          <circle
            cx={activeStep.x * 100}
            cy={activeStep.y * 100}
            r={3.6}
            fill="rgba(120,53,15,0.85)"
            stroke={NOTE_COLOR["next-step"]}
            strokeWidth={0.6}
          />
          <text
            x={activeStep.x * 100}
            y={activeStep.y * 100 + 1.4}
            fontSize={3.6}
            fontWeight={700}
            textAnchor="middle"
            fill="#fef3c7"
          >
            {(frame.currentPlanStepIndex ?? 0) + 1}
          </text>
        </g>
      )}
    </svg>
  );
}

/** One Plan visual-guidance shape (region-local 0..1 → 0..100 viewBox). */
function PlanOverlayShape({ overlay }: { overlay: BlueprintPlanOverlay }) {
  const WARN = "rgba(248,113,113,1)";
  const NEXT = "rgba(251,191,36,1)";
  const HILITE = "rgba(125,211,252,1)";

  if (overlay.type === "arrow" && overlay.from && overlay.to) {
    const fx = overlay.from.x * 100;
    const fy = overlay.from.y * 100;
    const tx = overlay.to.x * 100;
    const ty = overlay.to.y * 100;
    const ang = Math.atan2(ty - fy, tx - fx);
    const head = 3.2;
    const a1 = ang + Math.PI - 0.42;
    const a2 = ang + Math.PI + 0.42;
    return (
      <g opacity={0.95}>
        <line
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke={NEXT}
          strokeWidth={1.1}
          strokeLinecap="round"
        />
        <line
          x1={tx}
          y1={ty}
          x2={tx + Math.cos(a1) * head}
          y2={ty + Math.sin(a1) * head}
          stroke={NEXT}
          strokeWidth={1.1}
          strokeLinecap="round"
        />
        <line
          x1={tx}
          y1={ty}
          x2={tx + Math.cos(a2) * head}
          y2={ty + Math.sin(a2) * head}
          stroke={NEXT}
          strokeWidth={1.1}
          strokeLinecap="round"
        />
      </g>
    );
  }

  if (overlay.x == null || overlay.y == null) return null;
  const cx = overlay.x * 100;
  const cy = overlay.y * 100;

  if (overlay.type === "target") {
    return (
      <g opacity={0.95}>
        <circle cx={cx} cy={cy} r={5} fill="none" stroke={NEXT} strokeWidth={0.7} />
        <circle cx={cx} cy={cy} r={2.6} fill="none" stroke={NEXT} strokeWidth={0.7} />
        <line x1={cx - 6.5} y1={cy} x2={cx + 6.5} y2={cy} stroke={NEXT} strokeWidth={0.5} />
        <line x1={cx} y1={cy - 6.5} x2={cx} y2={cy + 6.5} stroke={NEXT} strokeWidth={0.5} />
      </g>
    );
  }

  if (overlay.type === "ghost-position") {
    return (
      <rect
        x={cx - 7}
        y={cy - 7}
        width={14}
        height={14}
        rx={1.5}
        fill="rgba(251,191,36,0.1)"
        stroke={NEXT}
        strokeWidth={0.7}
        strokeDasharray="2 1.4"
      />
    );
  }

  if (overlay.type === "highlight") {
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={7}
          fill="rgba(125,211,252,0.16)"
          stroke={HILITE}
          strokeWidth={0.6}
        />
        <circle cx={cx} cy={cy} r={1} fill={HILITE} />
      </g>
    );
  }

  if (overlay.type === "step-marker") {
    // Numbered marker on the blueprint (the readable card is external).
    const label = (overlay.label ?? "•").slice(0, 3);
    return (
      <g>
        <circle cx={cx} cy={cy} r={3.4} fill="rgba(8,47,73,0.92)" stroke={NEXT} strokeWidth={0.6} />
        <text
          x={cx}
          y={cy + 1.4}
          fontSize={3.8}
          fontWeight={700}
          textAnchor="middle"
          fill="#fde68a"
        >
          {label}
        </text>
      </g>
    );
  }

  if (overlay.type === "callout") {
    // The readable card lives OUTSIDE the crop (BlueprintCalloutLayer); on the
    // blueprint a callout is just its anchor marker.
    return (
      <g>
        <circle cx={cx} cy={cy} r={1.1} fill={HILITE} opacity={0.95} />
        <circle
          cx={cx}
          cy={cy}
          r={2}
          fill="none"
          stroke={HILITE}
          strokeWidth={0.35}
          opacity={0.7}
        />
      </g>
    );
  }

  if (overlay.type === "warning-zone") {
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={7}
          fill="rgba(248,113,113,0.14)"
          stroke={WARN}
          strokeWidth={0.7}
          strokeDasharray="2 1.2"
        />
        <text x={cx} y={cy + 1.4} fontSize={4} fontWeight={700} textAnchor="middle" fill={WARN}>
          ⚠
        </text>
      </g>
    );
  }

  // Unknown overlay type → ignore gracefully (forward-compatible with the worker).
  return null;
}

/** One virtual blueprint vector point, drawn by role. Unknown roles fall to a
 *  subtle dot (never crashes). Inactive points are faded to reduce clutter. */
function VirtualPointShape({ point, active }: { point: VirtualBlueprintPoint; active: boolean }) {
  const CYAN = "rgba(34,211,238,1)";
  const AMBER = "rgba(251,191,36,1)";
  const BLUE = "rgba(125,211,252,1)";
  const RED = "rgba(248,113,113,1)";
  const cx = point.x * 100;
  const cy = point.y * 100;
  const op = active ? 1 : 0.32;

  switch (point.role) {
    case "alignment-point":
      return (
        <g opacity={op}>
          <line x1={cx - 2.6} y1={cy} x2={cx + 2.6} y2={cy} stroke={CYAN} strokeWidth={0.5} />
          <line x1={cx} y1={cy - 2.6} x2={cx} y2={cy + 2.6} stroke={CYAN} strokeWidth={0.5} />
        </g>
      );
    case "target-position":
      return (
        <g opacity={op}>
          <circle cx={cx} cy={cy} r={3.4} fill="none" stroke={AMBER} strokeWidth={0.7} />
          <circle cx={cx} cy={cy} r={0.9} fill={AMBER} />
        </g>
      );
    case "connection-point":
      return (
        <g opacity={op}>
          <circle cx={cx} cy={cy} r={1} fill={CYAN} />
          <line
            x1={cx}
            y1={cy}
            x2={cx + 4}
            y2={cy - 4}
            stroke={CYAN}
            strokeWidth={0.4}
            strokeDasharray="1 0.8"
          />
        </g>
      );
    case "inspection-point":
      return (
        <g opacity={op}>
          <circle
            cx={cx}
            cy={cy}
            r={4.5}
            fill="rgba(125,211,252,0.16)"
            stroke={BLUE}
            strokeWidth={0.5}
          />
          <circle cx={cx} cy={cy} r={0.8} fill={BLUE} />
        </g>
      );
    case "warning-point":
      return (
        <g opacity={op}>
          <circle
            cx={cx}
            cy={cy}
            r={3.2}
            fill="none"
            stroke={RED}
            strokeWidth={0.7}
            strokeDasharray="1.6 1"
          />
          <circle cx={cx} cy={cy} r={0.9} fill={RED} />
        </g>
      );
    case "anchor":
    default:
      return <circle cx={cx} cy={cy} r={1} fill={CYAN} opacity={op * 0.8} />;
  }
}
