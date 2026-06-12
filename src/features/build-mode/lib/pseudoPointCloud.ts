import type { BlueprintFrame, VirtualBlueprintPoint } from "../types";

/**
 * Local 2.5D pseudo-point generation — a real-time virtual blueprint vector
 * layer derived from the geometry we ALREADY have (mask contour / outline /
 * bbox corners / centroid). Used as a LOCAL FALLBACK before worker depth or a
 * reasoner provides points. This is explicitly NOT real 3D: callers must mark
 * depthSource = "none".
 */

export interface PseudoPointCloud {
  /** Sampled contour ring points (role "anchor"). */
  contourPoints: VirtualBlueprintPoint[];
  /** Inset bbox-corner anchors. */
  anchors: VirtualBlueprintPoint[];
  /** Shape centroid (role "alignment-point"). */
  centroid: VirtualBlueprintPoint;
  /** Midpoint of the longest contour edge (role "alignment-point"). */
  edgePoints: VirtualBlueprintPoint[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Sample at most `max` evenly-spaced points from a polygon ring. */
function sampleRing(ring: Array<{ x: number; y: number }>, max: number) {
  if (ring.length <= max) return ring;
  const step = ring.length / max;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.floor(i * step)]);
  return out;
}

/**
 * Build pseudo points from a frame's geometry. Prefers the segmentation
 * contour; falls back to the frame outline; the bbox corners are always
 * available as the final fallback (the frame is region-local 0..1).
 */
export function buildPseudoPointCloud(input: {
  maskContour?: Array<{ x: number; y: number }>;
  outline?: Array<{ x: number; y: number }>;
  maxContourPoints?: number;
}): PseudoPointCloud {
  const ring =
    input.maskContour && input.maskContour.length >= 3
      ? input.maskContour
      : (input.outline ?? []).length >= 3
        ? input.outline!
        : [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.9, y: 0.9 },
            { x: 0.1, y: 0.9 },
          ];

  const contourPoints: VirtualBlueprintPoint[] = sampleRing(ring, input.maxContourPoints ?? 12).map(
    (p, i) => ({
      id: `pp-c${i}`,
      role: "anchor",
      x: clamp01(p.x),
      y: clamp01(p.y),
    }),
  );

  // Inset bounding-box corners of the ring.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const inset = 0.04;
  const anchors: VirtualBlueprintPoint[] = [
    { x: minX + inset, y: minY + inset },
    { x: maxX - inset, y: minY + inset },
    { x: maxX - inset, y: maxY - inset },
    { x: minX + inset, y: maxY - inset },
  ].map((p, i) => ({ id: `pp-a${i}`, role: "anchor", x: clamp01(p.x), y: clamp01(p.y) }));

  // Centroid of the ring → the primary alignment point.
  const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
  const centroid: VirtualBlueprintPoint = {
    id: "pp-centroid",
    role: "alignment-point",
    x: clamp01(cx),
    y: clamp01(cy),
  };

  // Longest contour edge → its midpoint is a likely connection/alignment side.
  let bestLen = -1;
  let bestMid = { x: cx, y: cy };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      bestMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  const edgePoints: VirtualBlueprintPoint[] = [
    {
      id: "pp-edge0",
      role: "alignment-point",
      x: clamp01(bestMid.x),
      y: clamp01(bestMid.y),
      label: "longest edge",
    },
  ];

  return { contourPoints, anchors, centroid, edgePoints };
}

/**
 * A compact set of pseudo points for a frame when the reasoner returned none:
 * centroid + longest edge + the four corner anchors (≤6 points — never noisy).
 */
export function pseudoPointsForFrame(frame: BlueprintFrame): VirtualBlueprintPoint[] {
  const cloud = buildPseudoPointCloud({
    maskContour: frame.maskContour,
    outline: frame.outline,
  });
  return [cloud.centroid, ...cloud.edgePoints, ...cloud.anchors].slice(0, 6);
}
