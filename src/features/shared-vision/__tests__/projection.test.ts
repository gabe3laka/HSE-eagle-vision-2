import { describe, it, expect } from "vitest";
import {
  getEntityFootPoint,
  isProjectionFresh,
  isProjectionConfidenceHighEnough,
  isInsideViewport,
  canRenderProjectedRemoteEntity,
  buildProjectedRemoteEntity,
  buildProjectedRemoteEntities,
  computeProjectionDetail,
  computeProjectedPeers,
} from "../lib/projection";
import { solveHomography, type Pt } from "../lib/homography";
import type { RemoteHiveEntity, RemotePeerState, LocalPeerCalibration } from "../types";

function makeEntity(overrides: Partial<RemoteHiveEntity> = {}): RemoteHiveEntity {
  return {
    label: "person",
    confidence: 0.9,
    bboxRemote: { x: 0.3, y: 0.2, w: 0.15, h: 0.4 },
    ...overrides,
  };
}

function makePeer(overrides: Partial<RemotePeerState> = {}): RemotePeerState {
  return {
    deviceId: "device-b",
    userId: "user-b",
    deviceLabel: "Camera B",
    lastSeenAt: Date.now(),
    isStale: false,
    calibration: {
      status: "uncalibrated",
      method: "none",
      confidence: null,
      transformId: null,
      expiresAt: null,
    },
    projection: { localizable: false, coordinateSpace: "remote_image", confidence: null },
    capture: { w: 1920, h: 1080, mirrored: false, facing: "environment" },
    entities: [],
    poses: [],
    sceneRisks: [],
    riskSummary: null,
    projectedEntities: [],
    ...overrides,
  };
}

function makeCal(overrides: Partial<LocalPeerCalibration> = {}): LocalPeerCalibration {
  return {
    peerDeviceId: "device-b",
    status: "homography",
    method: "homography_4pt",
    confidence: 0.85,
    transformId: "xform-1",
    expiresAt: Date.now() + 30_000,
    // Identity homography: projects foot to same coords
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...overrides,
  };
}

describe("getEntityFootPoint", () => {
  it("returns bbox bottom-center when no groundPointRemote", () => {
    const e = makeEntity();
    const fp = getEntityFootPoint(e);
    expect(fp.method).toBe("bbox_bottom_center");
    expect(fp.x).toBeCloseTo(0.3 + 0.15 / 2, 5);
    expect(fp.y).toBeCloseTo(0.2 + 0.4, 5);
  });

  it("uses groundPointRemote when present", () => {
    const e = makeEntity({
      groundPointRemote: { x: 0.5, y: 0.8, confidence: 0.9, method: "worker_pose_ankles" },
    });
    const fp = getEntityFootPoint(e);
    expect(fp.x).toBe(0.5);
    expect(fp.y).toBe(0.8);
  });
});

describe("isProjectionFresh", () => {
  it("null expiresAt is always fresh", () => expect(isProjectionFresh(null)).toBe(true));
  it("future expiry is fresh", () => expect(isProjectionFresh(Date.now() + 5000)).toBe(true));
  it("past expiry is stale", () => expect(isProjectionFresh(Date.now() - 1)).toBe(false));
});

describe("isProjectionConfidenceHighEnough", () => {
  it("accepts 0.65+", () => expect(isProjectionConfidenceHighEnough(0.65)).toBe(true));
  it("rejects below 0.65", () => expect(isProjectionConfidenceHighEnough(0.64)).toBe(false));
});

describe("isInsideViewport", () => {
  const makeBox = (x: number, y: number, w: number, h: number) => ({
    bbox: { x, y, w, h },
    footPoint: { x: 0.5, y: 0.9 },
    confidence: 0.8,
    method: "homography_4pt" as const,
  });
  it("visible box passes", () => expect(isInsideViewport(makeBox(0.2, 0.2, 0.3, 0.3))).toBe(true));
  it("fully out of viewport fails", () =>
    expect(isInsideViewport(makeBox(1.5, 0.2, 0.3, 0.3))).toBe(false));
  it("partial overlap passes", () =>
    expect(isInsideViewport(makeBox(-0.1, 0.2, 0.2, 0.3))).toBe(true));
});

describe("canRenderProjectedRemoteEntity", () => {
  it("returns false when hseActive=false", () => {
    expect(canRenderProjectedRemoteEntity(makeEntity(), makePeer(), makeCal(), false)).toBe(false);
  });

  it("returns false when peer is stale", () => {
    expect(
      canRenderProjectedRemoteEntity(makeEntity(), makePeer({ isStale: true }), makeCal(), true),
    ).toBe(false);
  });

  it("returns false when cal is null (Phase 1 default)", () => {
    expect(canRenderProjectedRemoteEntity(makeEntity(), makePeer(), null, true)).toBe(false);
  });

  it("returns false when calibration confidence is too low", () => {
    expect(
      canRenderProjectedRemoteEntity(makeEntity(), makePeer(), makeCal({ confidence: 0.5 }), true),
    ).toBe(false);
  });

  it("returns false when transform is expired", () => {
    expect(
      canRenderProjectedRemoteEntity(
        makeEntity(),
        makePeer(),
        makeCal({ expiresAt: Date.now() - 1 }),
        true,
      ),
    ).toBe(false);
  });

  it("returns false when calibration status is uncalibrated", () => {
    expect(
      canRenderProjectedRemoteEntity(
        makeEntity(),
        makePeer(),
        makeCal({ status: "uncalibrated" }),
        true,
      ),
    ).toBe(false);
  });

  it("returns true with valid identity homography projecting into viewport", () => {
    const entity = makeEntity({
      bboxRemote: { x: 0.3, y: 0.2, w: 0.15, h: 0.4 },
    });
    expect(canRenderProjectedRemoteEntity(entity, makePeer(), makeCal(), true)).toBe(true);
  });
});

/** Valid manual-map calibration: local camera 5m south of the peer, both facing
 *  north, 65° FOV. A centred peer detection lands inside Camera A's view. */
function makeManualMapCal(overrides: Partial<LocalPeerCalibration> = {}): LocalPeerCalibration {
  return {
    peerDeviceId: "device-b",
    status: "manual_map",
    method: "manual_map",
    confidence: 0.72,
    transformId: "manual-1",
    expiresAt: null,
    homography: null,
    mapTransform: {
      localCamera: { x_m: 0, y_m: -5, heading_deg: 0, fov_deg: 65 },
      peerCamera: { x_m: 0, y_m: 0, heading_deg: 0, fov_deg: 65 },
      assumedDistanceM: 5,
    },
    ...overrides,
  };
}

describe("buildProjectedRemoteEntities", () => {
  it("returns empty array when calibration is null (Phase 1 default)", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    expect(buildProjectedRemoteEntities({ peer, calibration: null, hseActive: true })).toEqual([]);
  });

  it("returns projected entities when manual-map calibration is valid", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal(),
      hseActive: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].projectionReason).toBe("manual_map");
    expect(out[0].projectedLocal.method).toBe("manual_map");
    expect(out[0].sourceDeviceId).toBe("device-b");
  });

  it("does not mutate the original RemotePeerState", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const originalProjected = peer.projectedEntities;
    const originalEntityCount = peer.entities.length;
    buildProjectedRemoteEntities({ peer, calibration: makeManualMapCal(), hseActive: true });
    expect(peer.projectedEntities).toBe(originalProjected);
    expect(peer.projectedEntities).toHaveLength(0);
    expect(peer.entities).toHaveLength(originalEntityCount);
  });

  it("uses bbox bottom-center when the entity has no pose / groundPointRemote", () => {
    // Entity intentionally has no groundPointRemote — projection must still work.
    const entity = makeEntity();
    expect(entity.groundPointRemote).toBeUndefined();
    const peer = makePeer({ entities: [entity] });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal(),
      hseActive: true,
    });
    expect(out).toHaveLength(1);
  });

  it("does not require poses (empty poses still projects)", () => {
    const peer = makePeer({ entities: [makeEntity()], poses: [] });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal(),
      hseActive: true,
    });
    expect(out).toHaveLength(1);
  });

  it("blocks projection below calibration confidence threshold", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal({ confidence: 0.5 }),
      hseActive: true,
    });
    expect(out).toEqual([]);
  });

  it("blocks projection when the peer is stale", () => {
    const peer = makePeer({ entities: [makeEntity()], isStale: true });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal(),
      hseActive: true,
    });
    expect(out).toEqual([]);
  });

  it("blocks projection when the calibration is expired", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal({ expiresAt: Date.now() - 1 }),
      hseActive: true,
    });
    expect(out).toEqual([]);
  });

  it("blocks projection when HSE is inactive", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const out = buildProjectedRemoteEntities({
      peer,
      calibration: makeManualMapCal(),
      hseActive: false,
    });
    expect(out).toEqual([]);
  });
});

describe("computeProjectedPeers", () => {
  it("returns an empty map when there are no remote peers (no-peer safety)", () => {
    const out = computeProjectedPeers({
      remotePeers: new Map(),
      localCalibration: new Map(),
      hseActive: true,
    });
    expect(out.size).toBe(0);
  });

  it("projects entities for a peer with a valid manual-map calibration", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map([[peer.deviceId, makeManualMapCal()]]),
      hseActive: true,
    });
    expect(out.get(peer.deviceId)?.projectedEntities).toHaveLength(1);
  });

  it("suppresses projection for a blocked (stale/failed) peer even when a valid calibration exists", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      // Valid calibration is present — but the peer is blocked, so projection
      // must NOT be recomputed back into ghost boxes.
      localCalibration: new Map([[peer.deviceId, makeManualMapCal()]]),
      hseActive: true,
      blockedPeerIds: new Set([peer.deviceId]),
    });
    expect(out.get(peer.deviceId)?.projectedEntities).toEqual([]);
  });

  it("keeps raw entities/risks available for a blocked peer (awareness/feed still work)", () => {
    const entity = makeEntity();
    const peer = makePeer({ entities: [entity] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map([[peer.deviceId, makeManualMapCal()]]),
      hseActive: true,
      blockedPeerIds: new Set([peer.deviceId]),
    });
    const result = out.get(peer.deviceId);
    expect(result?.projectedEntities).toEqual([]);
    expect(result?.entities).toHaveLength(1);
    expect(result?.entities[0]).toBe(entity);
  });

  it("does not mutate the source peer map or peer objects", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const source = new Map([[peer.deviceId, peer]]);
    computeProjectedPeers({
      remotePeers: source,
      localCalibration: new Map([[peer.deviceId, makeManualMapCal()]]),
      hseActive: true,
    });
    expect(source.get(peer.deviceId)).toBe(peer);
    expect(peer.projectedEntities).toHaveLength(0);
  });

  it("projects unblocked peers while suppressing blocked peers in the same pass", () => {
    const peerA = makePeer({ deviceId: "device-a", entities: [makeEntity()] });
    const peerB = makePeer({ deviceId: "device-b", entities: [makeEntity()] });
    const out = computeProjectedPeers({
      remotePeers: new Map([
        [peerA.deviceId, peerA],
        [peerB.deviceId, peerB],
      ]),
      localCalibration: new Map([
        [peerA.deviceId, makeManualMapCal({ peerDeviceId: "device-a" })],
        [peerB.deviceId, makeManualMapCal({ peerDeviceId: "device-b" })],
      ]),
      hseActive: true,
      blockedPeerIds: new Set(["device-b"]),
    });
    expect(out.get("device-a")?.projectedEntities).toHaveLength(1);
    expect(out.get("device-b")?.projectedEntities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — ground-plane homography projection + graceful degradation
// ---------------------------------------------------------------------------

// A floor quad mapping: peer image (capture-norm 0..1) corners → site-map meters.
const IMG_CORNERS: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const MAP_CORNERS: Pt[] = [
  { x: 2, y: 10 },
  { x: 8, y: 10 },
  { x: 10, y: 0 },
  { x: 0, y: 0 },
];
const PEER_IMAGE_TO_MAP_H = solveHomography(IMG_CORNERS, MAP_CORNERS)!;
const LOCAL_MAP_TO_IMAGE_H = solveHomography(MAP_CORNERS, IMG_CORNERS)!;

/** Calibration where the peer has a real ground-plane homography. The receiver
 *  half (localMapToImageH / mapTransform / pose gate) is overridable per test. */
function makeHomographyCal(overrides: Partial<LocalPeerCalibration> = {}): LocalPeerCalibration {
  return {
    peerDeviceId: "device-b",
    status: "homography",
    method: "homography_4pt",
    confidence: 0.88,
    transformId: "hg-1",
    expiresAt: Date.now() + 30_000,
    peerImageToMapH: PEER_IMAGE_TO_MAP_H,
    localMapToImageH: LOCAL_MAP_TO_IMAGE_H,
    receiverHomographyUsable: true,
    peerCameraWorld: { x_m: 5, y_m: -2 },
    localCameraWorld: { x_m: 5, y_m: -3 },
    mapTransform: {
      localCamera: { x_m: 5, y_m: -3, heading_deg: 0, fov_deg: 65 },
      peerCamera: { x_m: 5, y_m: -2, heading_deg: 0, fov_deg: 65 },
      assumedDistanceM: 5,
    },
    ...overrides,
  };
}

describe("computeProjectionDetail — peer homography", () => {
  it("recovers a real world point and real distances", () => {
    const detail = computeProjectionDetail(makeEntity(), makeHomographyCal())!;
    expect(detail).not.toBeNull();
    expect(detail.worldPoint).not.toBeNull();
    expect(Number.isFinite(detail.worldPoint!.x_m)).toBe(true);
    expect(Number.isFinite(detail.worldPoint!.y_m)).toBe(true);
    expect(detail.distanceFromPeerM).toBeGreaterThan(0);
    expect(detail.distanceFromLocalM).toBeGreaterThan(0);
  });

  it("uses the exact homography path when the receiver pose is usable", () => {
    const detail = computeProjectionDetail(makeEntity(), makeHomographyCal())!;
    expect(detail.reason).toBe("homography_4pt");
    expect(detail.box.method).toBe("homography_4pt");
  });

  it("ACCEPTANCE #20: stale receiver homography still yields world point + distance, downgrades to anchored (never homography_4pt)", () => {
    const detail = computeProjectionDetail(
      makeEntity(),
      makeHomographyCal({ receiverHomographyUsable: false }),
    )!;
    expect(detail.worldPoint).not.toBeNull();
    expect(detail.distanceFromPeerM).toBeGreaterThan(0);
    expect(detail.reason).toBe("manual_map_anchored");
    expect(detail.reason).not.toBe("homography_4pt");
  });

  it("ACCEPTANCE #18: mounted peer + handheld receiver (no local homography) still produces a real distance + anchored ghost", () => {
    const detail = computeProjectionDetail(
      makeEntity(),
      makeHomographyCal({ localMapToImageH: null, receiverHomographyUsable: false }),
    )!;
    expect(detail.reason).toBe("manual_map_anchored");
    expect(detail.distanceFromPeerM).toBeGreaterThan(0);
    expect(detail.worldPoint).not.toBeNull();
  });

  it("anchored confidence is capped below the solid threshold (never reads as accurate)", () => {
    const detail = computeProjectionDetail(
      makeEntity(),
      makeHomographyCal({ receiverHomographyUsable: false, confidence: 0.95 }),
    )!;
    expect(detail.box.confidence).toBeLessThan(0.85);
  });

  it("attaches a metric distance label to the projected box", () => {
    const detail = computeProjectionDetail(makeEntity(), makeHomographyCal())!;
    expect(detail.box.distanceLabel).toMatch(/^\d/);
    expect(detail.box.distanceLabel).toMatch(/m$/);
  });
});

describe("buildProjectedRemoteEntity — homography", () => {
  it("populates worldPoint, distances, and honest projectionReason", () => {
    const out = buildProjectedRemoteEntity(makeEntity(), makeHomographyCal(), "device-b")!;
    expect(out).not.toBeNull();
    expect(out.projectionReason).toBe("homography_4pt");
    expect(out.worldPoint).not.toBeNull();
    expect(out.worldPoint!.method).toBe("homography_4pt");
    expect(out.distanceFromPeerM).toBeGreaterThan(0);
    expect(out.sourceDeviceId).toBe("device-b");
  });

  it("downgrades projectionReason to manual_map_anchored when receiver pose drifts", () => {
    const out = buildProjectedRemoteEntity(
      makeEntity(),
      makeHomographyCal({ receiverHomographyUsable: false }),
      "device-b",
    )!;
    expect(out.projectionReason).toBe("manual_map_anchored");
    expect(out.worldPoint!.method).toBe("manual_map");
  });
});

describe("manual-map fallback is unchanged when no homography is present", () => {
  it("pure Tier-1 manual map still projects with reason manual_map and no world point", () => {
    const detail = computeProjectionDetail(makeEntity(), makeManualMapCal())!;
    expect(detail.reason).toBe("manual_map");
    expect(detail.worldPoint).toBeNull();
    expect(detail.distanceFromPeerM).toBeNull();
  });
});
