import { useState } from "react";
import { Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RemotePeerState, DeviceHeading, PeerBearing } from "../types";

export function SharedVisionControls({
  peers,
  isConnected,
  sharedSessionId,
  heading,
  bearings,
  onStart,
  onLeave,
  onPair,
  onUnpair,
}: {
  peers: RemotePeerState[];
  isConnected: boolean;
  sharedSessionId: string | null;
  heading: DeviceHeading;
  bearings: Map<string, PeerBearing>;
  onStart: (label?: string) => Promise<void>;
  onLeave: () => Promise<void>;
  onPair: (deviceId: string) => void;
  onUnpair: (deviceId: string) => void;
}) {
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    try {
      await onStart();
    } finally {
      setStarting(false);
    }
  };

  const onlinePeers = peers.filter((p) => !p.isStale);

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-950/30 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-purple-200">
          <Radio className="h-3.5 w-3.5" />
          Hive Mode
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-400 animate-pulse" : "bg-gray-500"}`}
          />
          <span className="text-[11px] text-muted-foreground">
            {isConnected
              ? `${onlinePeers.length} peer${onlinePeers.length !== 1 ? "s" : ""}`
              : "Disconnected"}
          </span>
        </div>
      </div>

      {!sharedSessionId ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full border-purple-500/50 text-purple-300 hover:bg-purple-900/40"
          onClick={handleStart}
          disabled={starting}
        >
          {starting ? "Starting…" : "Start shared session"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 w-full text-muted-foreground hover:text-destructive"
          onClick={onLeave}
        >
          Leave session
        </Button>
      )}

      {/* Compass heading and pairing */}
      {sharedSessionId && (
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
              className="w-full border-yellow-500/50 text-yellow-300 text-[11px]"
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
