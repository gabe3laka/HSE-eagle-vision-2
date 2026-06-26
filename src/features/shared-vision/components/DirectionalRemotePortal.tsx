import type { RemotePeerState, PeerBearing, PortalPlacement } from "../types";
import { computePlacement } from "../lib/bearing";
import type { BackendEntity } from "@/lib/detection/types";
import { BackendEntityOverlay } from "@/components/live/BackendEntityOverlay";
import { BackendPoseOverlay } from "@/components/live/BackendPoseOverlay";

const MAGENTA_BG = "rgba(120,10,150,0.85)";
const MAGENTA_BORDER = "rgba(217,50,230,0.9)";
const PORTAL_HALF_FOV = 33;

/**
 * Fallback/inspection portal — used when no projection is available.
 * Shows Camera B's detections in a floating framed window, direction-anchored
 * via compass bearing. NEVER draws onto the local scene plane.
 */
export function DirectionalRemotePortal({
  peers,
  bearings,
  headingDeg,
}: {
  peers: RemotePeerState[];
  bearings: Map<string, PeerBearing>;
  headingDeg: number | null;
}) {
  if (peers.length === 0) return null;

  const placements: Array<{ peer: RemotePeerState; placement: PortalPlacement }> = [];

  for (const peer of peers) {
    const bearing = bearings.get(peer.deviceId);
    if (!bearing || headingDeg === null) continue;
    const placement = computePlacement(bearing.bearingDeg, headingDeg, PORTAL_HALF_FOV);
    placements.push({ peer, placement: { ...placement, peerDeviceId: peer.deviceId } });
  }

  if (placements.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[17]">
      {placements.map(({ peer, placement }) => {
        const stale = peer.isStale;
        const label = peer.deviceLabel ?? peer.deviceId.slice(0, 6);

        if (!placement.onScreen) {
          // Edge arrow
          const side = placement.edge === "left" ? "left-2" : "right-2";
          return (
            <div
              key={peer.deviceId}
              className={`absolute top-1/2 -translate-y-1/2 ${side} flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold text-white`}
              style={{ backgroundColor: MAGENTA_BG, opacity: stale ? 0.45 : 0.9 }}
            >
              {placement.edge === "left" ? "←" : "→"} {label}
              {stale && " (lost)"}
            </div>
          );
        }

        // On-screen portal window
        const leftPct = Math.round(placement.screenX * 100);
        return (
          <div
            key={peer.deviceId}
            className="absolute top-12 w-40 -translate-x-1/2 rounded-lg border overflow-hidden"
            style={{
              left: `${leftPct}%`,
              borderColor: MAGENTA_BORDER,
              backgroundColor: "rgba(0,0,0,0.75)",
              opacity: stale ? 0.5 : 1,
            }}
          >
            <div
              className="px-2 py-1 text-[10px] font-semibold text-white"
              style={{ backgroundColor: MAGENTA_BG }}
            >
              {label} · live {stale && "· signal lost"}
            </div>
            <div className="relative aspect-video w-full bg-black/60">
              {peer.entities.length > 0 && (
                <BackendEntityOverlay
                  entities={peer.entities as unknown as BackendEntity[]}
                  poses={peer.poses}
                  overlayMode="hse-status"
                  riskAware
                  mirrored={peer.capture.mirrored}
                />
              )}
              {peer.poses.length > 0 && (
                <BackendPoseOverlay poses={peer.poses} mirrored={peer.capture.mirrored} />
              )}
              {peer.entities.length === 0 && peer.poses.length === 0 && (
                <div className="flex h-full items-center justify-center text-[9px] text-white/50">
                  No detections
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
