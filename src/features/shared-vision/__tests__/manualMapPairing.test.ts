import { describe, it, expect } from "vitest";
import { evaluateManualMapPairing, type CameraPlacementLike } from "../lib/manualMapPairing";

function placed(overrides: Partial<CameraPlacementLike> = {}): CameraPlacementLike {
  return {
    site_map_id: "map-1",
    map_x_m: 0,
    map_y_m: 0,
    heading_deg: 0,
    placement_accuracy: "manual_map",
    ...overrides,
  };
}

describe("evaluateManualMapPairing", () => {
  it("allows pairing when both cameras are fully placed on the same map and receiver is steady", () => {
    const res = evaluateManualMapPairing(placed(), placed({ map_x_m: 5 }), false);
    expect(res.ok).toBe(true);
  });

  it("blocks when receiver is unstable (highest priority)", () => {
    const res = evaluateManualMapPairing(placed(), placed(), true);
    expect(res).toEqual({ ok: false, reason: "unstable_receiver" });
  });

  it("blocks when the local camera has no site_map_id", () => {
    const res = evaluateManualMapPairing(placed({ site_map_id: null }), placed(), false);
    expect(res).toEqual({ ok: false, reason: "missing_local_site_map" });
  });

  it("blocks when the peer camera has no site_map_id", () => {
    const res = evaluateManualMapPairing(placed(), placed({ site_map_id: null }), false);
    expect(res).toEqual({ ok: false, reason: "missing_peer_site_map" });
  });

  it("blocks when the cameras are on different maps", () => {
    const res = evaluateManualMapPairing(
      placed({ site_map_id: "map-1" }),
      placed({ site_map_id: "map-2" }),
      false,
    );
    expect(res).toEqual({ ok: false, reason: "different_site_map" });
  });

  it("blocks when the local placement is uncalibrated", () => {
    const res = evaluateManualMapPairing(
      placed({ placement_accuracy: "uncalibrated" }),
      placed(),
      false,
    );
    expect(res).toEqual({ ok: false, reason: "uncalibrated_placement" });
  });

  it("blocks when the peer placement is uncalibrated", () => {
    const res = evaluateManualMapPairing(
      placed(),
      placed({ placement_accuracy: "uncalibrated" }),
      false,
    );
    expect(res).toEqual({ ok: false, reason: "uncalibrated_placement" });
  });

  it("blocks when the local placement is missing coordinates", () => {
    const res = evaluateManualMapPairing(placed({ map_x_m: null }), placed(), false);
    expect(res).toEqual({ ok: false, reason: "missing_local_placement" });
  });

  it("blocks when the peer placement is missing heading", () => {
    const res = evaluateManualMapPairing(placed(), placed({ heading_deg: null }), false);
    expect(res).toEqual({ ok: false, reason: "missing_peer_placement" });
  });

  it("treats heading 0 / position 0 as valid (not falsy-null)", () => {
    const res = evaluateManualMapPairing(
      placed({ map_x_m: 0, map_y_m: 0, heading_deg: 0 }),
      placed({ map_x_m: 0, map_y_m: 0, heading_deg: 0 }),
      false,
    );
    expect(res.ok).toBe(true);
  });
});
