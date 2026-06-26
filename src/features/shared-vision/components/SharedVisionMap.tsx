import type { SiteMap, CameraPlacement } from "../hooks/useSiteMaps";

interface Props {
  map: SiteMap;
  devices: CameraPlacement[];
  highlightDeviceId?: string;
}

/**
 * Phase 1B: SVG mini-map showing camera placements on a site map.
 *
 * Cameras are drawn as directional cones indicating heading and FOV.
 * The highlighted device (this camera) is shown in magenta; peers in blue.
 * This is a read-only spatial reference — it does not do live projection.
 */
export function SharedVisionMap({ map, devices, highlightDeviceId }: Props) {
  const mapW = map.width_m ?? 20;
  const mapH = map.height_m ?? 15;

  const VIEW_W = 300;
  const VIEW_H = Math.round(VIEW_W * (mapH / mapW));

  function toSvg(xM: number, yM: number) {
    return {
      x: (xM / mapW) * VIEW_W,
      y: (yM / mapH) * VIEW_H,
    };
  }

  const placedDevices = devices.filter(
    (d) => d.map_x_m !== null && d.map_y_m !== null && d.heading_deg !== null,
  );

  return (
    <div className="rounded border border-border bg-muted/30 overflow-hidden">
      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
        {map.name} — {mapW}×{mapH} m
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={VIEW_W}
        height={VIEW_H}
        className="block w-full"
        aria-label={`Site map: ${map.name}`}
      >
        {/* Map boundary */}
        <rect
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          fill="rgba(0,0,0,0.05)"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={1}
        />

        {/* Camera placements */}
        {placedDevices.map((d) => {
          const isSelf = d.device_id === highlightDeviceId;
          const pos = toSvg(d.map_x_m!, d.map_y_m!);
          const headingRad = ((d.heading_deg! - 90) * Math.PI) / 180;
          const fovRad = (((d.fov_deg ?? 65) / 2) * Math.PI) / 180;
          const coneLen = 30;

          const lx = pos.x + coneLen * Math.cos(headingRad - fovRad);
          const ly = pos.y + coneLen * Math.sin(headingRad - fovRad);
          const rx = pos.x + coneLen * Math.cos(headingRad + fovRad);
          const ry = pos.y + coneLen * Math.sin(headingRad + fovRad);

          const color = isSelf ? "rgba(217,50,230,0.9)" : "rgba(96,165,250,0.9)";

          return (
            <g key={d.device_id}>
              <path
                d={`M ${pos.x} ${pos.y} L ${lx} ${ly} L ${rx} ${ry} Z`}
                fill={isSelf ? "rgba(217,50,230,0.15)" : "rgba(96,165,250,0.1)"}
                stroke={color}
                strokeWidth={0.5}
              />
              <circle cx={pos.x} cy={pos.y} r={4} fill={color} />
              <text x={pos.x + 6} y={pos.y - 6} fontSize={8} fill={color} fontFamily="sans-serif">
                {d.camera_label}
              </text>
            </g>
          );
        })}

        {placedDevices.length === 0 && (
          <text
            x={VIEW_W / 2}
            y={VIEW_H / 2}
            textAnchor="middle"
            fontSize={10}
            fill="rgba(255,255,255,0.3)"
            fontFamily="sans-serif"
          >
            No cameras placed
          </text>
        )}
      </svg>
    </div>
  );
}
