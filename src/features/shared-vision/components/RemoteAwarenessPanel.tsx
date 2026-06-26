import type { RemotePeerState } from "../types";

/** Always-safe awareness panel — no spatial claims. Renders outside the camera. */
export function RemoteAwarenessPanel({ peers }: { peers: RemotePeerState[] }) {
  if (peers.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {peers.map((peer) => {
        const label = peer.deviceLabel ?? peer.deviceId.slice(0, 8);
        const ago = Math.round((Date.now() - peer.lastSeenAt) / 1000);
        const entityLabels = [...new Set(peer.entities.map((e) => e.label))].slice(0, 5).join(", ");
        return (
          <div
            key={peer.deviceId}
            className="rounded-lg border border-purple-500/30 bg-purple-900/20 px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${peer.isStale ? "bg-gray-400" : "bg-green-400"}`}
              />
              <span className="font-semibold text-purple-200">{label}</span>
              {peer.isStale && (
                <span className="text-[10px] text-muted-foreground">last seen {ago}s ago</span>
              )}
            </div>
            {entityLabels && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Sees: {entityLabels}
                {peer.entities.length > 5 ? ` +${peer.entities.length - 5} more` : ""}
              </p>
            )}
            {peer.riskSummary?.highest_level && peer.riskSummary.highest_level !== "GREEN" && (
              <p className="mt-0.5 text-[11px] font-medium text-orange-300">
                {peer.riskSummary.alerting_count ?? peer.riskSummary.total ?? "?"}{" "}
                {peer.riskSummary.highest_level} risks
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
