import type { BlueprintFrame } from "../types";

const OUTLINE = "rgba(56,189,248,0.95)"; // bright sky — technical blueprint line
const FILL = "rgba(56,189,248,0.10)"; // faint transparent body
const ANCHOR = "rgba(186,230,253,0.95)";
const STEP_BG = "rgba(8,47,73,0.92)";
const HAND = "rgba(252,211,77,0.9)";

/**
 * Pure SVG renderer of one blueprint frame: faint fill, bright outline, sparse
 * anchors, numbered step markers, optional hand/tool path + instruction label.
 * Geometry is region-local 0..1 drawn in a 0..100 viewBox — deliberately a
 * technical ghost, never a photorealistic replica.
 */
export function BlueprintOverlay({ frame }: { frame: BlueprintFrame }) {
  const pts = frame.outline.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
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

      {/* ghost body + outline */}
      {frame.outline.length >= 3 && (
        <polygon
          points={pts}
          fill={FILL}
          stroke={OUTLINE}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
      )}

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
