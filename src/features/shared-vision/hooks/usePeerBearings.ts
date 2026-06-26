import { useCallback, useEffect, useState } from "react";
import type { PeerBearing } from "../types";

const STORAGE_KEY = "hse_peer_bearings";

function loadBearings(): Map<string, PeerBearing> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr: PeerBearing[] = JSON.parse(raw);
    return new Map(arr.map((b) => [b.peerDeviceId, b]));
  } catch {
    return new Map();
  }
}

function saveBearings(m: Map<string, PeerBearing>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...m.values()]));
  } catch (_e) {
    /* ignore storage errors */
  }
}

export function usePeerBearings(): {
  bearings: Map<string, PeerBearing>;
  pairPeer: (deviceId: string, currentHeadingDeg: number | null) => void;
  clearPeer: (deviceId: string) => void;
} {
  const [bearings, setBearings] = useState<Map<string, PeerBearing>>(() => loadBearings());

  const pairPeer = useCallback((deviceId: string, currentHeadingDeg: number | null) => {
    if (currentHeadingDeg === null) return;
    setBearings((prev) => {
      const next = new Map(prev);
      next.set(deviceId, {
        peerDeviceId: deviceId,
        bearingDeg: currentHeadingDeg,
        pairedAt: Date.now(),
      });
      saveBearings(next);
      return next;
    });
  }, []);

  const clearPeer = useCallback((deviceId: string) => {
    setBearings((prev) => {
      const next = new Map(prev);
      next.delete(deviceId);
      saveBearings(next);
      return next;
    });
  }, []);

  return { bearings, pairPeer, clearPeer };
}
