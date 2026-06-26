import { useMemo } from "react";
import type { LocalPeerCalibration, RemotePeerState } from "../types";

export interface ReadinessRow {
  label: string;
  value: string;
  /** true = good, false = blocking, null = neutral/info. */
  ok: boolean | null;
}

export interface PeerReadiness {
  deviceId: string;
  deviceLabel: string | null;
  rows: ReadinessRow[];
}

export interface ProjectionReadiness {
  global: ReadinessRow[];
  peers: PeerReadiness[];
}

export interface ProjectionReadinessInput {
  hiveEnabled: boolean;
  orgId: string | null;
  sharedSessionId: string | null;
  deviceId: string | null;
  receiverStable: boolean;
  peers: RemotePeerState[];
  localCalibration: Map<string, LocalPeerCalibration>;
}

function bool(v: boolean): string {
  return v ? "yes" : "no";
}

/**
 * PURE: build the "why is there (no) ghost?" diagnostic readout. This is the
 * explainer panel's data source — it never changes projection behaviour. Lists
 * the exact gate inputs the projection pipeline consumes so an operator/dev can
 * see which condition is blocking an in-scene overlay.
 */
export function buildProjectionReadiness(input: ProjectionReadinessInput): ProjectionReadiness {
  const { hiveEnabled, orgId, sharedSessionId, deviceId, receiverStable, peers, localCalibration } =
    input;

  const global: ReadinessRow[] = [
    { label: "hive enabled", value: bool(hiveEnabled), ok: hiveEnabled },
    { label: "org id", value: orgId ?? "—", ok: orgId ? true : false },
    { label: "session id", value: sharedSessionId ? sharedSessionId.slice(0, 8) : "—", ok: null },
    {
      label: "device id",
      value: deviceId ? deviceId.slice(0, 8) : "—",
      ok: deviceId ? true : false,
    },
    { label: "peer count", value: String(peers.length), ok: peers.length > 0 },
    { label: "receiver stable", value: bool(receiverStable), ok: receiverStable },
  ];

  const peerRows: PeerReadiness[] = peers.map((peer) => {
    const cal = localCalibration.get(peer.deviceId) ?? null;
    const projectedCount = peer.projectedEntities.length;
    const topReason = peer.projectedEntities[0]?.projectionReason ?? null;

    const rows: ReadinessRow[] = [
      { label: "peer stale", value: bool(peer.isStale), ok: !peer.isStale },
      {
        label: "remote entities",
        value: String(peer.entities.length),
        ok: peer.entities.length > 0,
      },
      { label: "calibration", value: cal ? cal.method : "none", ok: cal ? true : false },
      {
        label: "peer imageToMap",
        value: bool(!!cal?.peerImageToMapH),
        ok: cal?.peerImageToMapH ? true : null,
      },
      {
        label: "local mapToImage",
        value: bool(!!cal?.localMapToImageH),
        ok: cal?.localMapToImageH ? true : null,
      },
      {
        label: "receiver homography usable",
        value: bool(!!cal?.receiverHomographyUsable),
        ok: cal?.receiverHomographyUsable ? true : null,
      },
      {
        label: "confidence",
        value: cal ? `${Math.round(cal.confidence * 100)}%` : "—",
        ok: cal ? cal.confidence >= 0.65 : null,
      },
      { label: "projected entities", value: String(projectedCount), ok: projectedCount > 0 },
      {
        label: "method (rendered)",
        value: topReason ?? (projectedCount === 0 ? "fallback" : "—"),
        ok: null,
      },
    ];
    return { deviceId: peer.deviceId, deviceLabel: peer.deviceLabel, rows };
  });

  return { global, peers: peerRows };
}

/** Thin hook wrapper around the pure builder. */
export function useProjectionReadiness(input: ProjectionReadinessInput): ProjectionReadiness {
  return useMemo(
    () => buildProjectionReadiness(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      input.hiveEnabled,
      input.orgId,
      input.sharedSessionId,
      input.deviceId,
      input.receiverStable,
      input.peers,
      input.localCalibration,
    ],
  );
}
