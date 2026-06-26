import type { RemotePeerState } from "../types";
import { riskLevelColor, normalizeRiskLevel } from "@/lib/detection/riskTypes";
import { mirrorBox } from "@/lib/detection/mirror";

const MAGENTA_BORDER = "rgba(217,50,230,0.9)";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Headline Hive overlay — purely presentational.
 *
 * Renders Camera B's detections into Camera A's live view as magenta ghost
 * boxes. Projection is NOT computed here: it is precomputed receiver-side by
 * useProjectedRemotePeers (which calls buildProjectedRemoteEntities) and
 * arrives on `peer.projectedEntities`. This component only reads
 * projectedEntities and draws — it never calls projectRemoteEntityToLocal.
 *
 * Projection ownership: projectedLocal is always receiver-computed and never
 * read from the broadcast wire.
 *
 * Mirror: projected boxes are run through mirrorBox with the LOCAL camera's
 * facing so front-camera receivers don't left/right-flip remote ghosts.
 *
 * Detection boxes only — no remote skeletons are drawn in the local scene
 * (poses stay inside the fallback portal). When no peer has drawable
 * projectedEntities, renders the `fallback` prop. The local HSE overlay (a
 * later sibling in CameraView) always draws on top.
 */
export function ProjectedRemoteOverlay({
  peers,
  localFacing = "environment",
  fallback,
}: {
  peers: RemotePeerState[];
  localFacing?: "user" | "environment";
  fallback?: React.ReactNode;
}) {
  const localMirrored = localFacing === "user";
  const projected: React.ReactNode[] = [];

  for (const peer of peers) {
    for (const entity of peer.projectedEntities) {
      const projectedLocal = entity.projectedLocal;

      // Mirror with the local camera's facing so front-camera receivers align.
      const box = mirrorBox(projectedLocal.bbox, localMirrored);

      const riskLevel = normalizeRiskLevel(entity.risk_level ?? null, null);
      const color = riskLevel && riskLevel !== "GREEN" ? riskLevelColor(riskLevel) : MAGENTA_BORDER;
      const deviceLabel = peer.deviceLabel ?? peer.deviceId.slice(0, 6);
      const label = `Remote · ${deviceLabel} · ${entity.label}`;
      const key = `${peer.deviceId}-${entity.id ?? entity.label}-${entity.bboxRemote.x}`;

      // Confidence-driven border: solid ≥0.85, dashed 0.65–0.85.
      const borderStyle = projectedLocal.confidence >= 0.85 ? "solid" : "dashed";

      // Method label per projection tier. manual_map is explicitly approximate
      // so the label communicates position accuracy to the operator.
      const methodLabel =
        projectedLocal.method === "manual_map"
          ? "manual map (approximate)"
          : projectedLocal.method === "homography_4pt"
            ? "homography"
            : projectedLocal.method === "marker"
              ? "calibrated"
              : projectedLocal.method;

      projected.push(
        <div
          key={key}
          className="absolute rounded-md border-2"
          style={{
            left: `${clamp01(box.x) * 100}%`,
            top: `${clamp01(box.y) * 100}%`,
            width: `${clamp01(box.w) * 100}%`,
            height: `${clamp01(box.h) * 100}%`,
            borderStyle,
            borderColor: color,
            opacity: 0.72,
            boxShadow: `0 0 0 1px rgba(0,0,0,0.3), 0 0 10px ${color}`,
          }}
        >
          <span
            className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-black"
            style={{ backgroundColor: color }}
          >
            {label}
          </span>
          <span
            className="absolute -bottom-5 left-0 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-medium text-white/80"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          >
            {methodLabel} · {Math.round(projectedLocal.confidence * 100)}%
          </span>
        </div>,
      );
    }
  }

  if (projected.length === 0) {
    return <>{fallback}</>;
  }

  return <div className="pointer-events-none absolute inset-0 z-[18]">{projected}</div>;
}
