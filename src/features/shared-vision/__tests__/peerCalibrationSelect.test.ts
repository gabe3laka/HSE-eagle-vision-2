import { describe, it, expect } from "vitest";
import { selectPeerCalibration, receiverHomographyUsable } from "../lib/peerCalibrationSelect";
import type { ParsedCameraCalibration } from "../hooks/useCameraCalibrations";

const IDENTITY_H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const localCamera = { x_m: 5, y_m: -3, heading_deg: 0, fov_deg: 65 };
const peerCamera = { x_m: 5, y_m: -2, heading_deg: 0, fov_deg: 65 };

function peerHomographyCal(o: Partial<ParsedCameraCalibration> = {}): ParsedCameraCalibration {
  return {
    id: "c-peer",
    orgId: "org",
    deviceId: "device-b",
    userId: "u-b",
    status: "homography",
    method: "homography_4pt",
    transformId: "hg-peer",
    confidence: 0.9,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    siteMapId: "map-1",
    surfaceType: "mounted",
    imageToMapH: IDENTITY_H,
    mapToImageH: IDENTITY_H,
    referencePoints: null,
    captureTransform: null,
    reprojectionErrorNorm: 0.005,
    calibrationHeadingDeg: null,
    ...o,
  };
}

function localMountedCal(o: Partial<ParsedCameraCalibration> = {}): ParsedCameraCalibration {
  return peerHomographyCal({
    id: "c-local",
    deviceId: "device-a",
    userId: "u-a",
    surfaceType: "mounted",
    calibrationHeadingDeg: 0,
    ...o,
  });
}

const base = {
  peerDeviceId: "device-b",
  localSiteMapId: "map-1",
  localCamera,
  peerCamera,
  receiverUnstable: false,
} as const;

describe("selectPeerCalibration", () => {
  it("emits homography_4pt when the peer has a same-map homography", () => {
    const cal = selectPeerCalibration({
      ...base,
      myCal: undefined,
      peerCal: peerHomographyCal(),
      currentHeadingDeg: 0,
    })!;
    expect(cal.method).toBe("homography_4pt");
    expect(cal.peerImageToMapH).toEqual(IDENTITY_H);
    expect(cal.peerCameraWorld).toEqual({ x_m: 5, y_m: -2 });
  });

  it("marks receiverHomographyUsable=true only with a mounted, pose-locked local calibration", () => {
    const cal = selectPeerCalibration({
      ...base,
      myCal: localMountedCal({ calibrationHeadingDeg: 0 }),
      peerCal: peerHomographyCal(),
      currentHeadingDeg: 2, // within 8° threshold
    })!;
    expect(cal.receiverHomographyUsable).toBe(true);
    expect(cal.localMapToImageH).toEqual(IDENTITY_H);
  });

  it("downgrades (usable=false) when the receiver heading drifts past threshold", () => {
    const cal = selectPeerCalibration({
      ...base,
      myCal: localMountedCal({ calibrationHeadingDeg: 0 }),
      peerCal: peerHomographyCal(),
      currentHeadingDeg: 45, // far past 8°
    })!;
    expect(cal.receiverHomographyUsable).toBe(false);
    expect(cal.localMapToImageH).toBeNull();
    // World point still available via peer homography.
    expect(cal.peerImageToMapH).toEqual(IDENTITY_H);
  });

  it("downgrades when the local camera is handheld (not mounted)", () => {
    const cal = selectPeerCalibration({
      ...base,
      myCal: localMountedCal({ surfaceType: "handheld" }),
      peerCal: peerHomographyCal(),
      currentHeadingDeg: 0,
    })!;
    expect(cal.receiverHomographyUsable).toBe(false);
  });

  it("still emits homography (anchored) for a mounted peer + handheld unstable receiver (#18)", () => {
    const cal = selectPeerCalibration({
      ...base,
      receiverUnstable: true,
      myCal: undefined,
      peerCal: peerHomographyCal(),
    })!;
    expect(cal.method).toBe("homography_4pt");
    expect(cal.receiverHomographyUsable).toBe(false);
  });

  it("ignores a peer homography on a DIFFERENT site map", () => {
    const cal = selectPeerCalibration({
      ...base,
      myCal: undefined,
      peerCal: peerHomographyCal({ siteMapId: "map-2" }),
    })!;
    // Falls through to manual map (steady receiver).
    expect(cal.method).toBe("manual_map");
  });

  it("ignores an expired peer homography", () => {
    const cal = selectPeerCalibration({
      ...base,
      myCal: undefined,
      peerCal: peerHomographyCal({ expiresAt: new Date(Date.now() - 1).toISOString() }),
    })!;
    expect(cal.method).toBe("manual_map");
  });

  it("emits manual_map when no homography exists and receiver is steady", () => {
    const cal = selectPeerCalibration({ ...base, myCal: undefined, peerCal: undefined })!;
    expect(cal.method).toBe("manual_map");
    expect(cal.confidence).toBeCloseTo(0.72, 5);
  });

  it("emits nothing (null) for pure manual map when the receiver is unstable", () => {
    const cal = selectPeerCalibration({
      ...base,
      receiverUnstable: true,
      myCal: undefined,
      peerCal: undefined,
    });
    expect(cal).toBeNull();
  });
});

describe("receiverHomographyUsable", () => {
  it("false without a local mapToImageH", () => {
    expect(receiverHomographyUsable(undefined, false, 0)).toBe(false);
  });
  it("false when expired", () => {
    expect(
      receiverHomographyUsable(
        localMountedCal({ expiresAt: new Date(Date.now() - 1).toISOString() }),
        false,
        0,
      ),
    ).toBe(false);
  });
  it("true for a mounted no-compass calibration (trust the mount)", () => {
    expect(
      receiverHomographyUsable(localMountedCal({ calibrationHeadingDeg: null }), false, null),
    ).toBe(true);
  });
  it("false when unstable even if mounted & pose-locked", () => {
    expect(receiverHomographyUsable(localMountedCal({ calibrationHeadingDeg: 0 }), true, 0)).toBe(
      false,
    );
  });
});
