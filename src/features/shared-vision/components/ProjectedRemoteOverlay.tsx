import type { RemotePeerState, LocalPeerCalibration } from "../types";
import { canRenderProjectedRemoteEntity, projectRemoteEntityToLocal } from "../lib/projection";
import { riskLevelColor, normalizeRiskLevel } from "@/lib/detection/riskTypes";

const MAGENTA_BORDER = "rgba(217,50,230,0.9)";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Headline Hive overlay: draws Camera B's detections into Camera A's live view
 * as magenta ghost boxes when a valid projection exists.
 * When projection gates fail, renders the `fallback` prop instead.
 */
export function ProjectedRemoteOverlay({
  peers,
  localCalibration,
  hseActive = true,
  fallback,
}: {
  peers: RemotePeerState[];
  localCalibration: Map<string, LocalPeerCalibration>;
  hseActive?: boolean;
  fallback?: React.ReactNode;
}) {
  let anyProjected = false;
  const projected: React.ReactNode[] = [];

  for (const peer of peers) {
    const cal = localCalibration.get(peer.deviceId) ?? null;
    for (const entity of peer.entities) {
      if (!canRenderProjectedRemoteEntity(entity, peer, cal, hseActive)) continue;
      anyProjected = true;
      const box = entity.projectedLocal ?? (cal ? projectRemoteEntityToLocal(entity, cal) : null);
      if (!box) continue;

      const riskLevel = normalizeRiskLevel(entity.risk_level ?? null, null);
      const color = riskLevel && riskLevel !== "GREEN" ? riskLevelColor(riskLevel) : MAGENTA_BORDER;
      const label = `Remote · ${peer.deviceLabel ?? peer.deviceId.slice(0, 6)} · ${entity.label}`;
      const key = `${peer.deviceId}-${entity.id ?? entity.label}-${entity.bboxRemote.x}`;

      projected.push(
        <div
          key={key}
          className="absolute rounded-md border-2 border-dashed"
          style={{
            left: `${clamp01(box.bbox.x) * 100}%`,
            top: `${clamp01(box.bbox.y) * 100}%`,
            width: `${clamp01(box.bbox.w) * 100}%`,
            height: `${clamp01(box.bbox.h) * 100}%`,
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
            {box.method} · {Math.round(box.confidence * 100)}%
          </span>
        </div>,
      );
    }
  }

  if (!anyProjected) {
    return <>{fallback}</>;
  }

  return <div className="pointer-events-none absolute inset-0 z-[18]">{projected}</div>;
}
