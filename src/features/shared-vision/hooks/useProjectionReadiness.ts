import { useMemo } from "react";
import type { LocalPeerCalibration, RemotePeerState } from "../types";
import type { HiveDiagnostics } from "./useSharedVision";
import type { CameraPlacement } from "./useSiteMaps";
import { getEntityFootPoint } from "../lib/projection";
import { entityWorldBearingDeg, isHiveMindEligible } from "../lib/objectBearing";
import { normalize180 } from "../lib/bearing";

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
  // Feature flag / mode
  hiveEnabled: boolean;
  appMode: string;
  hseActive: boolean;
  // Identity / org
  authUserId: string | null;
  orgId: string | null;
  /** Membership role for the selected org, or null when not a member. */
  membershipStatus: string | null;
  deviceId: string | null;
  // Connection / send / receive observability (from useSharedVision).
  diagnostics: HiveDiagnostics;
  // Receiver state
  receiverStable: boolean;
  /** True when the local detector exposed a CaptureTransform this frame. */
  captureTransformPresent: boolean;
  // Compass hive-mind (receiver's live heading + FOV).
  localHeadingDeg: number | null;
  localHeadingSource: "absolute" | "webkit" | "relative" | null;
  localFovDeg: number;
  // Local placement row (org_camera_devices for THIS device), if any.
  localDevice: CameraPlacement | null;
  // Peers (receiver-projected peer states) + supporting data.
  peers: RemotePeerState[];
  remoteRiskCount: number;
  localCalibration: Map<string, LocalPeerCalibration>;
  /** org_camera_devices rows keyed by device_id, for peer placement/map checks. */
  peerDevices: Map<string, CameraPlacement>;
}

function bool(v: boolean): string {
  return v ? "yes" : "no";
}

function ago(ts: number | null): string {
  if (!ts) return "—";
  const dt = Date.now() - ts;
  if (dt < 0) return "now";
  if (dt < 1000) return `${dt}ms ago`;
  return `${(dt / 1000).toFixed(1)}s ago`;
}

/** A placement is "complete" only with a map + full pose (x/y/heading/FOV). */
function placementComplete(d: CameraPlacement | null | undefined): boolean {
  return (
    !!d &&
    d.site_map_id != null &&
    d.map_x_m != null &&
    d.map_y_m != null &&
    d.heading_deg != null &&
    d.fov_deg != null
  );
}

/**
 * PURE: build the full Hive "why is there (no) connection / ghost?" diagnostic
 * readout (gated behind VITE_HIVE_DEBUG at the call site). It is the single panel
 * that lets a tester distinguish, with zero guessing, between: feature flag /
 * auth / org selection / Realtime RLS / broadcast send / remote receive / device
 * self-filter / missing placement / different site map / stale peer / hseActive /
 * calibration missing / receiver moving / capture-space mismatch / confidence gate.
 *
 * It never changes projection behaviour — it only reports the gate inputs the
 * connection + projection pipelines already consume.
 */
export function buildProjectionReadiness(input: ProjectionReadinessInput): ProjectionReadiness {
  const {
    hiveEnabled,
    appMode,
    hseActive,
    authUserId,
    orgId,
    membershipStatus,
    deviceId,
    diagnostics,
    receiverStable,
    captureTransformPresent,
    localDevice,
    peers,
    remoteRiskCount,
    localCalibration,
    peerDevices,
    localHeadingDeg,
    localHeadingSource,
    localFovDeg,
  } = input;

  const localHeadingAbsolute = localHeadingSource === "absolute" || localHeadingSource === "webkit";

  const localMapId = localDevice?.site_map_id ?? null;
  const localComplete = placementComplete(localDevice);
  const localMapToImagePresent = [...localCalibration.values()].some((c) => !!c.localMapToImageH);

  const global: ReadinessRow[] = [
    // --- Feature flag / mode ---
    { label: "feature flag enabled", value: bool(hiveEnabled), ok: hiveEnabled },
    { label: "appMode", value: appMode, ok: appMode === "hse" },
    { label: "hseActive", value: bool(hseActive), ok: null },
    // --- Identity / org ---
    { label: "auth user id", value: authUserId ? authUserId.slice(0, 8) : "—", ok: !!authUserId },
    { label: "selected org id", value: orgId ? orgId.slice(0, 8) : "—", ok: !!orgId },
    {
      label: "org membership",
      value: membershipStatus ?? "none",
      ok: membershipStatus ? membershipStatus !== "none" : false,
    },
    { label: "local device id", value: deviceId ? deviceId.slice(0, 8) : "—", ok: !!deviceId },
    // --- Connection / presence / send / receive ---
    { label: "topic string", value: diagnostics.topic ?? "—", ok: !!diagnostics.topic },
    {
      label: "connection status",
      value: diagnostics.connectionStatus,
      ok: diagnostics.connectionStatus === "SUBSCRIBED",
    },
    {
      label: "presence status",
      value: diagnostics.presenceStatus,
      ok:
        diagnostics.presenceStatus === "tracked"
          ? true
          : diagnostics.presenceStatus === "error"
            ? false
            : null,
    },
    {
      label: "last ch.track result",
      value: diagnostics.lastTrackResult ?? "—",
      ok: diagnostics.lastTrackResult ? diagnostics.lastTrackResult === "ok" : null,
    },
    {
      label: "last ch.send result",
      value: diagnostics.lastSendResult ?? "—",
      ok: diagnostics.lastSendResult ? diagnostics.lastSendResult === "ok" : null,
    },
    { label: "last sent frame", value: ago(diagnostics.lastSentAt), ok: null },
    {
      label: "last received frame",
      value: ago(diagnostics.lastReceivedAt),
      ok: diagnostics.lastReceivedAt ? true : null,
    },
    // --- Remote summary ---
    { label: "remote peer count", value: String(peers.length), ok: peers.length > 0 },
    { label: "remote risk count", value: String(remoteRiskCount), ok: null },
    // --- Local placement / calibration ---
    { label: "local site_map_id", value: localMapId ? localMapId.slice(0, 8) : "—", ok: null },
    { label: "local placement complete", value: bool(localComplete), ok: localComplete },
    { label: "local mapToImageH exists", value: bool(localMapToImagePresent), ok: null },
    { label: "receiver stable", value: bool(receiverStable), ok: receiverStable },
    { label: "capture transform present", value: bool(captureTransformPresent), ok: null },
    // --- Compass hive-mind (local) ---
    {
      label: "local heading",
      value: localHeadingDeg != null ? `${Math.round(localHeadingDeg)}°` : "—",
      ok: localHeadingDeg != null ? true : null,
    },
    {
      label: "local heading source",
      value: localHeadingSource ?? "none",
      ok: localHeadingAbsolute ? true : false,
    },
  ];

  const peerRows: PeerReadiness[] = peers.map((peer) => {
    const cal = localCalibration.get(peer.deviceId) ?? null;
    const peerDevice = peerDevices.get(peer.deviceId) ?? null;
    const peerMapId = peerDevice?.site_map_id ?? null;
    const peerComplete = placementComplete(peerDevice);
    const sameMap = !!localMapId && !!peerMapId && localMapId === peerMapId;
    const projectedCount = peer.projectedEntities.length;
    const topReason = peer.projectedEntities[0]?.projectionReason ?? null;
    // Peer broadcast its own capture transform when present on the frame.
    const peerCaptureTransform = !!peer.capture?.transform;
    // Approximate mismatch signal: the peer has a homography path but the
    // receiver pose-lock disabled it (drift / unsteady / capture-transform
    // mismatch all collapse receiverHomographyUsable to false).
    const captureMismatch = !!cal?.peerImageToMapH && cal?.receiverHomographyUsable === false;

    // --- Compass hive-mind diagnostics ---
    const peerHeadingDeg = peer.capture?.headingDeg ?? null;
    const peerHeadingSource = peer.capture?.headingSource ?? null;
    const peerHfovDeg = peer.capture?.hfovDeg ?? null;
    const peerHeadingAbsolute = peerHeadingSource === "absolute" || peerHeadingSource === "webkit";
    const hiveMindEligible = isHiveMindEligible({
      peerCapture: peer.capture,
      localHeadingDeg,
      localHeadingSource,
    });
    // World bearing + on-screen state for the top entity (explains the box).
    const topEntity = peer.entities[0] ?? null;
    const objectWorldBearing =
      topEntity && peerHeadingDeg != null
        ? entityWorldBearingDeg(
            getEntityFootPoint(topEntity).x,
            peerHeadingDeg,
            peerHfovDeg ?? localFovDeg,
          )
        : null;
    const topOnScreen =
      objectWorldBearing != null && localHeadingDeg != null
        ? Math.abs(normalize180(objectWorldBearing - localHeadingDeg)) <= localFovDeg / 2
        : null;
    const hasPlacementData = localComplete || peerComplete || !!localMapId || !!peerMapId;

    // Single honest block-reason ladder. When projection is happening (any tier,
    // including compass) it's "none". Otherwise diagnose: calibrated/manual-map
    // path when placement data exists, else the compass hive-mind path.
    let blockReason = "none (projecting)";
    if (projectedCount > 0) blockReason = "none (projecting)";
    else if (peer.isStale) blockReason = "peer_stale";
    else if (peer.entities.length === 0) blockReason = "no_remote_entities";
    else if (hasPlacementData) {
      if (!localComplete) blockReason = "missing_local_placement";
      else if (!peerComplete) blockReason = "missing_peer_placement";
      else if (!sameMap) blockReason = "different_site_map";
      else if (cal && (cal.status === "stale" || cal.status === "failed"))
        blockReason = `calibration_${cal.status}`;
      else if (cal && !receiverStable) blockReason = "receiver_moving";
      else if (cal && cal.confidence < 0.65) blockReason = "low_confidence";
      else blockReason = "projection_failed";
    } else if (!localHeadingAbsolute) blockReason = "local_heading_not_absolute";
    else if (peerHeadingDeg == null) blockReason = "peer_heading_missing";
    else if (!peerHeadingAbsolute) blockReason = "peer_heading_not_absolute";
    else blockReason = "compass_off_screen";

    const rows: ReadinessRow[] = [
      { label: "peer device id", value: peer.deviceId.slice(0, 8), ok: null },
      { label: "peer stale", value: bool(peer.isStale), ok: !peer.isStale },
      {
        label: "remote entities",
        value: String(peer.entities.length),
        ok: peer.entities.length > 0,
      },
      { label: "peer site_map_id", value: peerMapId ? peerMapId.slice(0, 8) : "—", ok: null },
      { label: "same map", value: bool(sameMap), ok: sameMap ? true : null },
      {
        label: "peer placement complete",
        value: bool(peerComplete),
        ok: peerComplete ? true : null,
      },
      { label: "calibration", value: cal ? cal.method : "none", ok: cal ? true : null },
      {
        label: "peer imageToMapH",
        value: bool(!!cal?.peerImageToMapH),
        ok: cal?.peerImageToMapH ? true : null,
      },
      {
        label: "local mapToImageH",
        value: bool(!!cal?.localMapToImageH),
        ok: cal?.localMapToImageH ? true : null,
      },
      {
        label: "receiver homography usable",
        value: bool(!!cal?.receiverHomographyUsable),
        ok: cal?.receiverHomographyUsable ? true : null,
      },
      { label: "peer capture transform", value: bool(peerCaptureTransform), ok: null },
      { label: "capture transform mismatch", value: bool(captureMismatch), ok: !captureMismatch },
      {
        label: "projection confidence",
        value: cal ? `${Math.round(cal.confidence * 100)}%` : "—",
        ok: cal ? cal.confidence >= 0.65 : null,
      },
      // --- Compass hive-mind ---
      {
        label: "peer headingDeg",
        value: peerHeadingDeg != null ? `${Math.round(peerHeadingDeg)}°` : "—",
        ok: peerHeadingDeg != null ? true : null,
      },
      {
        label: "peer heading source",
        value: peerHeadingSource ?? "none",
        ok: peerHeadingAbsolute ? true : false,
      },
      {
        label: "peer hfovDeg",
        value: peerHfovDeg != null ? `${Math.round(peerHfovDeg)}°` : "—",
        ok: null,
      },
      { label: "hive-mind eligible", value: bool(hiveMindEligible), ok: hiveMindEligible },
      {
        label: "object world bearing",
        value: objectWorldBearing != null ? `${Math.round(objectWorldBearing)}°` : "—",
        ok: null,
      },
      {
        label: "top entity on-screen",
        value: topOnScreen == null ? "—" : bool(topOnScreen),
        ok: topOnScreen,
      },
      { label: "projected entities", value: String(projectedCount), ok: projectedCount > 0 },
      {
        label: "projection method",
        value: topReason ?? (cal ? cal.method : "none"),
        ok: null,
      },
      { label: "last block reason", value: blockReason, ok: blockReason.startsWith("none") },
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
      input.appMode,
      input.hseActive,
      input.authUserId,
      input.orgId,
      input.membershipStatus,
      input.deviceId,
      input.diagnostics,
      input.receiverStable,
      input.captureTransformPresent,
      input.localDevice,
      input.peers,
      input.remoteRiskCount,
      input.localCalibration,
      input.peerDevices,
      input.localHeadingDeg,
      input.localHeadingSource,
      input.localFovDeg,
    ],
  );
}
