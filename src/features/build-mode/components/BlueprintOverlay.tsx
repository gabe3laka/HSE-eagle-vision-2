import type { BlueprintFrame } from "../types";

const OUTLINE = "rgba(56,189,248,0.95)"; // bright sky — technical blueprint line
const OUTLINE_BACK = "rgba(56,189,248,0.45)"; // dimmer rear face of the extrusion
const EDGE = "rgba(56,189,248,0.35)"; // front↔back connector edges
const FILL = "rgba(56,189,248,0.10)"; // faint transparent body
const ANCHOR = "rgba(186,230,253,0.95)";
const STEP_BG = "rgba(8,47,73,0.92)";
const HAND = "rgba(252,211,77,0.9)";

// Fake 3D extrusion offset (viewBox units): the back face sits up-left so the
// ghost reads as a shallow wireframe slab, not a flat sticker.
const DEPTH_X = -2.4;
const DEPTH_Y = -3;

/**
 * Pure SVG renderer of one blueprint frame as a 2.5D wireframe ghost: faint
 * fill, bright front outline, an offset back outline with connected edges
 * (fake extrusion), sparse anchors, numbered step markers, optional hand path
 * + instruction label. Geometry is region-local 0..1 drawn in a 0..100
 * viewBox — a technical blueprint illusion, never a real 3D reconstruction.
 * If the outline is degenerate it falls back to a 3D-looking bounding-box
 * wireframe so the ghost always has a body.
 */
export function BlueprintOverlay({ frame }: { frame: BlueprintFrame }) {
  // Fall back to an inset bounding box when the outline can't form a polygon.
  const outline =
    frame.outline.length >= 3
      ? frame.outline
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

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* blueprint grid wash */}
      <defs>
        <pattern id="bp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path
            d="M 10 0 L 0 0 0 10"
            fill="none"
            stroke="rgba(56,189,248,0.12)"
            strokeWidth={0.3}
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#bp-grid)" />

      {/* 2.5D wireframe: back face first, then connector edges, then front */}
      <polygon
        points={backPts}
        fill="none"
        stroke={OUTLINE_BACK}
        strokeWidth={0.55}
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
          strokeWidth={0.45}
        />
      ))}
      <polygon
        points={frontPts}
        fill={FILL}
        stroke={OUTLINE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />

      {/* sparse points */}
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
          {a.label && (
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

      {/* numbered step markers */}
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

      {/* instruction label */}
      {frame.instruction && (
        <text x={2.5} y={96.5} fontSize={3.4} fill={ANCHOR} opacity={0.9}>
          {frame.instruction}
        </text>
      )}
    </svg>
  );
}
