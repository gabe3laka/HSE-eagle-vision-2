import { describe, expect, it } from "vitest";
import {
  MIN_VPS_CONFIDENCE,
  VPS_POSE_MAX_AGE_MS,
  buildVpsProjectedEntity,
  canUseVpsTier,
  groundToPixel,
  pixelToGround,
  type VpsPoseSnapshot,
} from "../lib/vpsProjection";
import { computeProjectedPeers } from "../lib/projection";
import {
  decayedConfidence,
  deadReckonRotation,
  readVpsRequeryMs,
  VPS_DECAY_MULTIPLE,
} from "../vps/useVpsLocalization";
import {
  DEVICE_INTRINSICS_TABLE,
  deviceSignature,
  estimateIntrinsics,
  resolveIntrinsics,
} from "../vps/frameCapture";
import type { RemoteHiveEntity, RemotePeerState, SvVpsPose } from "../types";

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const NOW = 1_000_000;

const localSnap = (over: Partial<VpsPoseSnapshot> = {}): VpsPoseSnapshot => ({
  position: { x: 0, y: 1.5, z: 0 },
  rotation: IDENTITY,
  confidence: 0.9,
  mapCode: "MAP_A",
  ageRefMs: NOW,
  ...over,
});

const peerPose = (over: Partial<SvVpsPose & { receivedAt: number }> = {}) => ({
  position: { x: 0, y: 1.5, z: 0 },
  rotation: IDENTITY,
  confidence: 0.9,
  mapCode: "MAP_A",
  timestampMs: NOW,
  receivedAt: NOW,
  ...over,
});

function makeEntity(over: Partial<RemoteHiveEntity> = {}): RemoteHiveEntity {
  return {
    label: "person",
    confidence: 0.9,
    bboxRemote: { x: 0.45, y: 0.45, w: 0.1, h: 0.3 },
    risk_level: "RED",
    ...over,
  };
}

function makePeer(over: Partial<RemotePeerState> = {}): RemotePeerState {
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
    // hfov 90° + 4:3 keeps the golden numbers hand-checkable (tanH = 1).
    capture: { w: 1000, h: 750, mirrored: false, facing: "environment", hfovDeg: 90 },
    entities: [],
    poses: [],
    sceneRisks: [],
    riskSummary: null,
    projectedEntities: [],
    ...over,
  };
}

describe("vps_map tier gate — every combination", () => {
  it("passes only when maps match, both poses are fresh, both confident", () => {
    expect(canUseVpsTier(localSnap(), peerPose(), NOW)).toBe(true);
  });

  it("fails on a map-code mismatch (either direction) or a missing pose", () => {
    expect(canUseVpsTier(localSnap({ mapCode: "MAP_B" }), peerPose(), NOW)).toBe(false);
    expect(canUseVpsTier(localSnap(), peerPose({ mapCode: "MAP_B" }), NOW)).toBe(false);
    expect(canUseVpsTier(null, peerPose(), NOW)).toBe(false);
    expect(canUseVpsTier(localSnap(), null, NOW)).toBe(false);
    expect(canUseVpsTier(localSnap({ mapCode: "" }), peerPose({ mapCode: "" }), NOW)).toBe(false);
  });

  it("fails when either pose is older than VPS_POSE_MAX_AGE_MS", () => {
    const late = NOW + VPS_POSE_MAX_AGE_MS + 1;
    expect(canUseVpsTier(localSnap(), peerPose(), late)).toBe(false);
    expect(canUseVpsTier(localSnap({ ageRefMs: late }), peerPose({ receivedAt: late }), late)).toBe(
      true,
    );
    expect(canUseVpsTier(localSnap({ ageRefMs: late }), peerPose(), late)).toBe(false);
  });

  it("fails when either confidence is below MIN_VPS_CONFIDENCE", () => {
    const low = MIN_VPS_CONFIDENCE - 0.01;
    expect(canUseVpsTier(localSnap({ confidence: low }), peerPose(), NOW)).toBe(false);
    expect(canUseVpsTier(localSnap(), peerPose({ confidence: low }), NOW)).toBe(false);
  });
});

describe("vps_map golden values (hfov 90°, aspect 0.75, cameras 1.5 m up)", () => {
  const pose = { position: { x: 0, y: 1.5, z: 0 }, rotation: IDENTITY };

  it("pixel→ground: the frame's lower-centre foot lands 4 m ahead", () => {
    // dirCam = (0, −0.375, −1); t = 1.5/0.375 = 4 → ground (0, −4).
    const g = pixelToGround({ x: 0.5, y: 0.75 }, pose, 90, 0.75);
    expect(g).not.toBeNull();
    expect(g!.x).toBeCloseTo(0, 6);
    expect(g!.z).toBeCloseTo(-4, 6);
  });

  it("ground→pixel round-trips through the same camera", () => {
    const px = groundToPixel({ x: 0, z: -4 }, pose, 90, 0.75);
    expect(px!.x).toBeCloseTo(0.5, 6);
    expect(px!.y).toBeCloseTo(0.75, 6);
  });

  it("a laterally offset camera sees the point at the hand-computed pixel", () => {
    // Local at (2, 1.5, 0): rel = (−2, −1.5, −4) → u = 0.5 − 0.25, v = 0.75.
    const px = groundToPixel(
      { x: 0, z: -4 },
      { ...pose, position: { x: 2, y: 1.5, z: 0 } },
      90,
      0.75,
    );
    expect(px!.x).toBeCloseTo(0.25, 6);
    expect(px!.y).toBeCloseTo(0.75, 6);
  });

  it("rejects rays that never hit the ground and points behind the camera", () => {
    expect(pixelToGround({ x: 0.5, y: 0.25 }, pose, 90, 0.75)).toBeNull(); // upward
    expect(groundToPixel({ x: 0, z: 4 }, pose, 90, 0.75)).toBeNull(); // behind
  });

  it("buildVpsProjectedEntity: known pose pair → known projection + distances", () => {
    const entity = makeEntity({ bboxRemote: { x: 0.45, y: 0.45, w: 0.1, h: 0.3 } }); // foot (0.5, 0.75)
    const peer = makePeer({ vpsPose: peerPose() });
    const out = buildVpsProjectedEntity(
      entity,
      peer,
      peer.vpsPose!,
      {
        local: localSnap({ position: { x: 2, y: 1.5, z: 0 } }),
        localHfovDeg: 90,
        localAspect: 0.75,
      },
      NOW,
    );
    expect(out).not.toBeNull();
    expect(out!.projectionReason).toBe("vps_map");
    expect(out!.projectedLocal.footPoint.x).toBeCloseTo(0.25, 6);
    expect(out!.projectedLocal.footPoint.y).toBeCloseTo(0.75, 6);
    expect(out!.distanceFromPeerM).toBeCloseTo(Math.hypot(0, 1.5, 4), 5);
    expect(out!.distanceFromLocalM).toBeCloseTo(Math.hypot(2, 1.5, 4), 5);
    expect(out!.worldPoint).toMatchObject({ x_m: 0, z_m: 0 });
    expect(out!.worldPoint!.y_m).toBeCloseTo(-4, 6);
    expect(out!.projectedLocal.confidence).toBeLessThanOrEqual(0.92);
  });
});

describe("tier ordering + the no-vpsPose regression", () => {
  const vps = { local: localSnap(), localHfovDeg: 90, localAspect: 0.75 };

  it("a peer WITH a fresh shared pose projects via vps_map above everything", () => {
    const peer = makePeer({
      entities: [makeEntity()],
      vpsPose: peerPose({ receivedAt: Date.now() }),
    });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      vps: { ...vps, local: localSnap({ position: { x: 2, y: 1.5, z: 0 }, ageRefMs: Date.now() }) },
    });
    const projected = out.get(peer.deviceId)!.projectedEntities;
    expect(projected).toHaveLength(1);
    expect(projected[0].projectionReason).toBe("vps_map");
  });

  it("a peer with NO vpsPose projects exactly as today (vps param inert)", () => {
    const peer = makePeer({ entities: [makeEntity()] });
    const args = {
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
    };
    const without = computeProjectedPeers(args);
    const withVps = computeProjectedPeers({
      ...args,
      vps: { ...vps, local: localSnap({ ageRefMs: Date.now() }) },
    });
    expect(withVps.get(peer.deviceId)!.projectedEntities).toEqual(
      without.get(peer.deviceId)!.projectedEntities,
    );
  });

  it("a stale or mismatched pose falls back to the lower tiers, never vps_map", () => {
    const peer = makePeer({
      entities: [makeEntity()],
      vpsPose: peerPose({ mapCode: "MAP_OTHER", receivedAt: Date.now() }),
    });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      vps: { ...vps, local: localSnap({ ageRefMs: Date.now() }) },
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toEqual([]);
  });
});

describe("useVpsLocalization pure parts", () => {
  it("confidence decays linearly to zero at 3× the requery interval", () => {
    expect(VPS_DECAY_MULTIPLE).toBe(3);
    expect(decayedConfidence(0.9, 0, 45_000)).toBeCloseTo(0.9, 6);
    expect(decayedConfidence(0.9, 45_000 * 1.5, 45_000)).toBeCloseTo(0.45, 6);
    expect(decayedConfidence(0.9, 45_000 * 3, 45_000)).toBe(0);
    expect(decayedConfidence(0.9, 45_000 * 9, 45_000)).toBe(0);
  });

  it("dead reckoning: zero delta is identity, two 90° yaws make 180°", () => {
    const q0 = deadReckonRotation(IDENTITY, 0);
    expect(q0).toEqual(IDENTITY);
    const q180a = deadReckonRotation(deadReckonRotation(IDENTITY, 90), 90);
    const q180b = deadReckonRotation(IDENTITY, 180);
    expect(q180a.y).toBeCloseTo(q180b.y, 6);
    expect(q180a.w).toBeCloseTo(q180b.w, 6);
  });

  it("requery interval: env override with a sane floor, default 45 s", () => {
    expect(readVpsRequeryMs({})).toBe(45_000);
    expect(readVpsRequeryMs({ VITE_VPS_REQUERY_MS: "60000" })).toBe(60_000);
    expect(readVpsRequeryMs({ VITE_VPS_REQUERY_MS: "10" })).toBe(45_000); // below floor
    expect(readVpsRequeryMs({ VITE_VPS_REQUERY_MS: "nope" })).toBe(45_000);
  });
});

describe("intrinsics resolution (2a)", () => {
  it("unknown device falls back to the FOV estimate and says so", () => {
    const i = resolveIntrinsics(1280, 720, {
      userAgent: "SomeBrowser/1.0",
      trackSettings: { width: 1280, height: 720 },
    });
    expect(i.estimated).toBe(true);
    expect(i.source).toBe("fov_estimate");
    expect(i.fx).toBeCloseTo(estimateIntrinsics(1280, 720, 65).fx, 6);
  });

  it("a known device signature uses the calibrated table", () => {
    const i = resolveIntrinsics(1280, 720, {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      trackSettings: { width: 1920, height: 1080 },
    });
    expect(i.estimated).toBe(false);
    expect(i.source).toBe("device_table");
    expect(i.hfovDeg).toBe(DEVICE_INTRINSICS_TABLE["iphone:1920x1080"].hfovDeg);
  });

  it("signature hashes portrait and landscape identically; no resolution → null", () => {
    expect(deviceSignature("iPhone", { width: 1080, height: 1920 })).toBe("iphone:1920x1080");
    expect(deviceSignature("iPhone", { width: 1920, height: 1080 })).toBe("iphone:1920x1080");
    expect(deviceSignature("iPhone", null)).toBeNull();
    expect(deviceSignature("UnknownPhone", { width: 1920, height: 1080 })).toBeNull();
  });
});
