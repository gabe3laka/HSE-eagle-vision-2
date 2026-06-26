import { conePolygon, conesOverlap, type ConePlacement } from "../lib/fovCones";

export interface ConeCamera extends ConePlacement {
  deviceId: string;
  label: string;
  isLocal: boolean;
}

/**
 * Dev-only SVG overlay drawing each camera's FOV cone on the site map, with
 * overlapping pairs highlighted. Planar meters → SVG via the map dimensions.
 * Gated behind VITE_HIVE_DEBUG by the caller. Not on the accuracy path.
 */
export function MapFovConeOverlay({
  cameras,
  mapW,
  mapH,
  rangeM = 8,
}: {
  cameras: ConeCamera[];
  mapW: number;
  mapH: number;
  rangeM?: number;
}) {
  // Which cameras overlap at least one other (UX hint: projection meaningful).
  const overlapping = new Set<string>();
  for (let i = 0; i < cameras.length; i++) {
    for (let j = i + 1; j < cameras.length; j++) {
      if (conesOverlap(cameras[i], cameras[j], rangeM)) {
        overlapping.add(cameras[i].deviceId);
        overlapping.add(cameras[j].deviceId);
      }
    }
  }

  const toPath = (cam: ConeCamera) =>
    conePolygon(cam, rangeM, 10)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x_m / mapW) * 100} ${(p.y_m / mapH) * 100}`)
      .join(" ") + " Z";

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0"
    >
      {cameras.map((cam) => {
        const fill = cam.isLocal ? "rgba(56,189,248,0.18)" : "rgba(217,50,230,0.16)";
        const stroke = overlapping.has(cam.deviceId)
          ? "rgba(16,185,129,0.9)"
          : cam.isLocal
            ? "rgba(56,189,248,0.7)"
            : "rgba(217,50,230,0.6)";
        return (
          <g key={cam.deviceId}>
            <path d={toPath(cam)} fill={fill} stroke={stroke} strokeWidth={0.4} />
            <circle cx={(cam.x_m / mapW) * 100} cy={(cam.y_m / mapH) * 100} r={0.9} fill={stroke} />
          </g>
        );
      })}
    </svg>
  );
}
