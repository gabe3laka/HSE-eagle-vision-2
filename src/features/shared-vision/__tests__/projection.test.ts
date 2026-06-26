import { describe, it, expect } from "vitest";
import {
  getEntityFootPoint,
  isProjectionFresh,
  isProjectionConfidenceHighEnough,
  isInsideViewport,
  canRenderProjectedRemoteEntity,
} from "../lib/projection";
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
      groundPointRemote: { x: 0.5, y: 0.8, confidence: 0.9, method: "pose_ankles" },
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
      projectedLocal: {
        bbox: { x: 0.3, y: 0.2, w: 0.15, h: 0.4 },
        footPoint: { x: 0.375, y: 0.6 },
        confidence: 0.8,
        method: "homography_4pt",
      },
    });
    expect(canRenderProjectedRemoteEntity(entity, makePeer(), makeCal(), true)).toBe(true);
  });
});
