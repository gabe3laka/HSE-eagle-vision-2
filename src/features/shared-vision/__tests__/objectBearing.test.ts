import { describe, it, expect } from "vitest";
import { entityWorldBearingDeg, projectByBearing, isHiveMindEligible } from "../lib/objectBearing";
import { computeProjectedPeers } from "../lib/projection";
import type { RemoteHiveEntity, RemotePeerState, SvFrameMessage } from "../types";

function makeEntity(footX: number, overrides: Partial<RemoteHiveEntity> = {}): RemoteHiveEntity {
  return {
    label: "person",
    confidence: 0.9,
    bboxRemote: { x: footX - 0.075, y: 0.4, w: 0.15, h: 0.4 },
    // Pin the ground contact so foot.x is exactly footX regardless of bbox math.
    groundPointRemote: { x: footX, y: 0.8, confidence: 0.7, method: "bbox_bottom_center" },
    ...overrides,
  };
}

function makeCapture(
  overrides: Partial<SvFrameMessage["capture"]> = {},
): SvFrameMessage["capture"] {
  return {
    w: 1920,
    h: 1080,
    mirrored: false,
    facing: "environment",
    headingDeg: 90,
    headingSource: "absolute",
    headingAccuracyDeg: null,
    hfovDeg: 65,
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
    capture: makeCapture(),
    entities: [],
    poses: [],
    sceneRisks: [],
    riskSummary: null,
    projectedEntities: [],
    ...overrides,
  };
}

describe("entityWorldBearingDeg", () => {
  it("returns the sender heading for an object at frame center", () => {
    expect(entityWorldBearingDeg(0.5, 90, 65)).toBeCloseTo(90, 5);
  });
  it("returns heading − hfov/2 at the left edge", () => {
    expect(entityWorldBearingDeg(0.0, 90, 65)).toBeCloseTo(90 - 32.5, 5);
  });
  it("returns heading + hfov/2 at the right edge", () => {
    expect(entityWorldBearingDeg(1.0, 90, 65)).toBeCloseTo(90 + 32.5, 5);
  });
});

describe("projectByBearing", () => {
  it("places a dead-ahead object near x = 0.5", () => {
    // Object whose world bearing equals the local heading → centered.
    const entity = makeEntity(0.5);
    const box = projectByBearing(entity, 90, 65, 90, 65);
    expect(box).not.toBeNull();
    expect(box!.footPoint.x).toBeCloseTo(0.5, 5);
  });

  it("places an off-center object on the correct side", () => {
    // B heading 90, foot.x 0.25 → world bearing ≈ 73.75°. A heading 90 →
    // rel ≈ −16.25° → x ≈ 0.25 (left of center).
    const entity = makeEntity(0.25);
    const box = projectByBearing(entity, 90, 65, 90, 65);
    expect(box).not.toBeNull();
    expect(box!.footPoint.x).toBeCloseTo(0.25, 2);
    expect(box!.method).toBe("manual_map");
    expect(box!.confidence).toBeLessThan(0.85); // dashed/approximate
  });

  it("returns null when the object is beyond the local FOV", () => {
    // World bearing ≈ 73.75°; A facing 0° → rel ≈ 73.75° ≫ 32.5° → off-screen.
    const entity = makeEntity(0.25);
    expect(projectByBearing(entity, 90, 65, 0, 65)).toBeNull();
  });

  it("un-flips foot.x for a front-camera (mirrored) sender", () => {
    // foot.x 0.25 on a mirrored frame → real footX 0.75 → bearing ≈ 106.25°.
    // A heading 90 → rel ≈ +16.25° → right of center (opposite the un-mirrored case).
    const entity = makeEntity(0.25);
    const box = projectByBearing(entity, 90, 65, 90, 65, true);
    expect(box).not.toBeNull();
    expect(box!.footPoint.x).toBeCloseTo(0.75, 2);
    const unmirrored = projectByBearing(entity, 90, 65, 90, 65, false);
    expect(unmirrored!.footPoint.x).toBeCloseTo(0.25, 2);
  });
});

describe("continuity — sweeping the receiver heading moves the box across and out of view", () => {
  const entity = makeEntity(0.25); // fixed-world object at bearing ≈ 73.75°
  it("is centered when A faces the object's bearing", () => {
    const box = projectByBearing(entity, 90, 65, 73.75, 65);
    expect(box).not.toBeNull();
    expect(box!.footPoint.x).toBeCloseTo(0.5, 2);
  });
  it("is on the right half when A rotates left of the object", () => {
    const box = projectByBearing(entity, 90, 65, 55, 65);
    expect(box).not.toBeNull();
    expect(box!.footPoint.x).toBeGreaterThan(0.5);
  });
  it("leaves the screen once A turns far enough away", () => {
    expect(projectByBearing(entity, 90, 65, 30, 65)).toBeNull();
  });
});

describe("isHiveMindEligible", () => {
  it("is eligible when both headings are absolute", () => {
    expect(
      isHiveMindEligible({
        peerCapture: makeCapture(),
        localHeadingDeg: 90,
        localHeadingSource: "absolute",
      }),
    ).toBe(true);
  });
  it("accepts webkit compass on both ends", () => {
    expect(
      isHiveMindEligible({
        peerCapture: makeCapture({ headingSource: "webkit" }),
        localHeadingDeg: 90,
        localHeadingSource: "webkit",
      }),
    ).toBe(true);
  });
  it("is ineligible when the local heading is relative", () => {
    expect(
      isHiveMindEligible({
        peerCapture: makeCapture(),
        localHeadingDeg: 90,
        localHeadingSource: "relative",
      }),
    ).toBe(false);
  });
  it("is ineligible when the peer heading is missing (old sender / back-compat)", () => {
    expect(
      isHiveMindEligible({
        peerCapture: makeCapture({ headingDeg: null, headingSource: null, hfovDeg: null }),
        localHeadingDeg: 90,
        localHeadingSource: "absolute",
      }),
    ).toBe(false);
  });
  it("is ineligible when the local heading is null", () => {
    expect(
      isHiveMindEligible({
        peerCapture: makeCapture(),
        localHeadingDeg: null,
        localHeadingSource: "absolute",
      }),
    ).toBe(false);
  });
});

describe("computeProjectedPeers — compass hive-mind fallback tier", () => {
  const hiveMind = {
    localHeadingDeg: 90,
    localHeadingSource: "absolute" as const,
    localFovDeg: 65,
  };

  it("projects peer detections by bearing when eligible and no calibration exists", () => {
    const peer = makePeer({ entities: [makeEntity(0.25)] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      hiveMind,
    });
    const projected = out.get(peer.deviceId)!.projectedEntities;
    expect(projected).toHaveLength(1);
    expect(projected[0].projectionReason).toBe("compass_bearing");
    expect(projected[0].distanceFromPeerM).toBeNull();
    expect(projected[0].projectedLocal.distanceLabel ?? null).toBeNull();
  });

  it("omits entities that fall outside the receiver FOV", () => {
    const peer = makePeer({ entities: [makeEntity(0.25)] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      hiveMind: { ...hiveMind, localHeadingDeg: 0 }, // facing away
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });

  it("is inert when the receiver heading is relative (→ portal fallback)", () => {
    const peer = makePeer({ entities: [makeEntity(0.25)] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      hiveMind: { ...hiveMind, localHeadingSource: "relative" },
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });

  it("is back-compatible: a peer frame without heading/FOV projects nothing", () => {
    const peer = makePeer({
      entities: [makeEntity(0.25)],
      capture: makeCapture({ headingDeg: null, headingSource: null, hfovDeg: null }),
    });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      hiveMind,
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });

  it("is inert for a peer whose frames went stale (lastSeenAt past the TTL)", () => {
    // isStale flag still false (between TTL ticks) but lastSeenAt is 30s old — the
    // explicit TTL guard must prevent drawing a box off a dead peer's last heading.
    const peer = makePeer({ entities: [makeEntity(0.25)], lastSeenAt: Date.now() - 30_000 });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      hiveMind,
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });

  it("is inert for a peer marked stale", () => {
    const peer = makePeer({ entities: [makeEntity(0.25)], isStale: true });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
      hiveMind,
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });

  it("does not run when the receiver is not actively monitoring (hseActive false)", () => {
    const peer = makePeer({ entities: [makeEntity(0.25)] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: false,
      hiveMind,
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });

  it("calibrated tiers take precedence over hive-mind", () => {
    // Legacy identity homography → a calibrated projection exists, so the compass
    // tier must NOT override it.
    const peer = makePeer({ entities: [makeEntity(0.5)] });
    const localCalibration = new Map([
      [
        peer.deviceId,
        {
          peerDeviceId: peer.deviceId,
          status: "homography" as const,
          method: "homography_4pt" as const,
          confidence: 0.9,
          transformId: "t1",
          expiresAt: null,
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      ],
    ]);
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration,
      hseActive: true,
      hiveMind,
    });
    const projected = out.get(peer.deviceId)!.projectedEntities;
    expect(projected).toHaveLength(1);
    expect(projected[0].projectionReason).toBe("homography_4pt");
  });

  it("leaves projection empty when hiveMind inputs are omitted (existing behavior)", () => {
    const peer = makePeer({ entities: [makeEntity(0.25)] });
    const out = computeProjectedPeers({
      remotePeers: new Map([[peer.deviceId, peer]]),
      localCalibration: new Map(),
      hseActive: true,
    });
    expect(out.get(peer.deviceId)!.projectedEntities).toHaveLength(0);
  });
});
