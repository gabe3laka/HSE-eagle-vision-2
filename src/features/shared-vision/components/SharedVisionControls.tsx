import { Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RemotePeerState, DeviceHeading, PeerBearing } from "../types";
import type { LivePeer } from "../hooks/useSharedVision";

/**
 * Hive Mode controls — org-wide room model.
 *
 * There is no "start" or "join session": being live in the org's HSE puts you in
 * the single org hive room automatically, where every live member's detections
 * merge (metadata only — never raw video). This panel just shows connection +
 * who's live, a Leave/Rejoin toggle, and the compass pairing for the fallback
 * directional portal.
 */
export function SharedVisionControls({
  peers,
  livePeers,
  isConnected,
  hivePaused,
  heading,
  bearings,
  onLeave,
  onRejoin,
  onPair,
  onUnpair,
}: {
  peers: RemotePeerState[];
  livePeers: LivePeer[];
  isConnected: boolean;
  hivePaused: boolean;
  heading: DeviceHeading;
  bearings: Map<string, PeerBearing>;
  onLeave: () => void;
  onRejoin: () => void;
  onPair: (deviceId: string) => void;
  onUnpair: (deviceId: string) => void;
}) {
  // Peers actively broadcasting detections (have a bearing slot for pairing).
  const onlinePeers = peers.filter((p) => !p.isStale);
  const liveCount = livePeers.length;

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-950/30 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-purple-200">
          <Radio className="h-3.5 w-3.5" />
          Hive Mode
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${isConnected ? "animate-pulse bg-green-400" : "bg-gray-500"}`}
          />
          <span className="text-[11px] text-muted-foreground">
            {hivePaused ? "Left hive" : isConnected ? `${liveCount} live` : "Connecting…"}
          </span>
        </div>
      </div>

      {hivePaused ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            You left your org's hive. Rejoin to see what teammates' cameras detect.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full border-purple-500/50 text-purple-300 hover:bg-purple-900/40"
            onClick={onRejoin}
          >
            Rejoin hive
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {liveCount > 0
              ? `You're in your org's hive — ${liveCount} teammate${liveCount === 1 ? "" : "s"} live. Their detections merge into your view automatically.`
              : "You're in your org's hive. When a teammate goes live, their detections appear here automatically — no join needed."}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-muted-foreground hover:text-destructive"
            onClick={onLeave}
          >
            Leave hive
          </Button>
        </div>
      )}

      {/* Compass heading + pairing for the directional fallback portal. */}
      {isConnected && !hivePaused && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Compass</span>
            <span className={heading.headingDeg === null ? "text-yellow-400" : "text-green-300"}>
              {heading.headingDeg !== null
                ? `${Math.round(heading.headingDeg)}° (${heading.source ?? "?"})`
                : "No heading"}
              {heading.source === "relative" && " ⚠ not absolute"}
            </span>
          </div>
          {heading.permission === "unknown" && (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-yellow-500/50 text-[11px] text-yellow-300"
              onClick={async () => {
                const { requestPermission } = heading as unknown as {
                  requestPermission?: () => Promise<void>;
                };
                if (requestPermission) await requestPermission();
              }}
            >
              Enable compass
            </Button>
          )}

          {onlinePeers.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <Users className="mr-1 inline h-3 w-3" />
                Peers
              </p>
              {onlinePeers.map((peer) => {
                const label = peer.deviceLabel ?? peer.deviceId.slice(0, 8);
                const bearing = bearings.get(peer.deviceId);
                return (
                  <div
                    key={peer.deviceId}
                    className="flex items-center justify-between gap-1 text-[11px]"
                  >
                    <span className="truncate text-purple-200">{label}</span>
                    {bearing ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-muted-foreground">
                          {Math.round(bearing.bearingDeg)}°
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[9px] text-muted-foreground"
                          onClick={() => onPair(peer.deviceId)}
                        >
                          Re-pair
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[9px] text-red-400"
                          onClick={() => onUnpair(peer.deviceId)}
                        >
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 shrink-0 border-purple-500/40 px-1.5 text-[9px] text-purple-300"
                        onClick={() => onPair(peer.deviceId)}
                        disabled={heading.headingDeg === null}
                      >
                        Point & pair
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
