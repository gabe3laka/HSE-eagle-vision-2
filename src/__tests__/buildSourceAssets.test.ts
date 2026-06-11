import { describe, it, expect } from "vitest";
import {
  assetForSave,
  buildSourceAsset,
  rehydrateSavedBlueprint,
  serializeBlueprintSave,
  stripHeavyFrameFields,
  toV2Frame,
} from "../features/build-mode/lib/sourceAssets";
import { mockBlueprintFrame } from "../features/build-mode/lib/blueprint";
import type { SavedBlueprint, SelectedRegion } from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };

const frameWithPixels = (i: number) => ({
  ...mockBlueprintFrame("s", i, i * 333, REGION, "plan"),
  sourceImageB64: `IMG${i}`,
  sourceMaskB64: `MASK${i}`,
  sourceImageSize: { w: 384, h: 288 },
});

describe("BlueprintFrame v2 — source assets", () => {
  it("buildSourceAsset holds the crop once and lifts backend mask fields", () => {
    const asset = buildSourceAsset({
      id: "a1",
      imageB64: "QUJD",
      size: { w: 384, h: 288 },
      backendFrame: { sourceMaskB64: "TUFTSw==", maskSource: "sam2" },
    });
    expect(asset).toEqual({
      id: "a1",
      imageB64: "QUJD",
      size: { w: 384, h: 288 },
      mode: "transient",
      maskB64: "TUFTSw==",
      maskContour: undefined,
      maskSource: "sam2",
    });
  });

  it("defaults maskSource to none when the backend sent nothing", () => {
    const asset = buildSourceAsset({ id: "a2", imageB64: "QUJD", size: { w: 10, h: 10 } });
    expect(asset.maskSource).toBe("none");
    expect(asset.maskB64).toBeUndefined();
  });

  it("toV2Frame strips inline base64 and stamps version + asset reference", () => {
    const v2 = toV2Frame(frameWithPixels(3), "a3");
    expect(v2.version).toBe(2);
    expect(v2.sourceAssetId).toBe("a3");
    expect(v2.sourceImageB64).toBeUndefined();
    expect(v2.sourceMaskB64).toBeUndefined();
    // small metadata + intelligence survive
    expect(v2.sourceImageSize).toEqual({ w: 384, h: 288 });
    expect(v2.aiNotes!.length).toBeGreaterThan(0);
    expect(v2.outline.length).toBeGreaterThanOrEqual(8);
  });

  it("stripHeavyFrameFields removes only the image payloads", () => {
    const stripped = stripHeavyFrameFields(frameWithPixels(1));
    expect(stripped.sourceImageB64).toBeUndefined();
    expect(stripped.sourceMaskB64).toBeUndefined();
    expect(stripped.planSteps!.length).toBeGreaterThan(0);
  });
});

describe("Saved blueprints — serialize + rehydrate", () => {
  const baseFrame = toV2Frame(frameWithPixels(0), "live-a0");
  const frames = [1, 2, 3].map((i) => toV2Frame(frameWithPixels(i), `live-a${i}`));
  const liveAsset = buildSourceAsset({
    id: "live-a0",
    imageB64: "QUJD",
    size: { w: 384, h: 288 },
  });

  it("saves geometry + notes + replay JSON with a saved-thumbnail asset only", () => {
    const row = serializeBlueprintSave({
      name: "Pump check",
      workflowMode: "plan",
      backendMode: "mock",
      region: REGION,
      placement: { transform: { x: 0.1, y: 0.1, scale: 1 }, pinnedAtMs: 1 },
      baseFrame,
      frames,
      sourceAsset: liveAsset,
      thumbnailB64: "VEhVTUI=",
    });
    expect(row.workflow_mode).toBe("plan");
    expect(row.region).toEqual(REGION);
    expect(row.frames).toHaveLength(3);
    for (const f of [row.base_frame, ...row.frames]) {
      expect(f.sourceImageB64).toBeUndefined();
      expect(f.sourceMaskB64).toBeUndefined();
      expect(f.aiNotes!.length).toBeGreaterThan(0); // notes are kept
    }
    expect(row.source_asset).toEqual({
      id: "live-a0",
      thumbnailB64: "VEhVTUI=",
      maskContour: undefined,
      size: { w: 384, h: 288 },
      mode: "saved-thumbnail",
      maskSource: "none",
    });
    // the full crop never reaches the saved row
    expect(JSON.stringify(row)).not.toContain("QUJD");
  });

  it("assetForSave returns null when there is nothing to keep", () => {
    expect(assetForSave(null, null)).toBeNull();
    expect(assetForSave(undefined, undefined)).toBeNull();
  });

  it("rehydration points every frame at the single saved thumbnail asset", () => {
    const saved: SavedBlueprint = {
      id: "b1",
      name: "Pump check",
      workflowMode: "plan",
      createdAt: "2026-06-11T00:00:00Z",
      region: REGION,
      placement: null,
      baseFrame: stripHeavyFrameFields(baseFrame),
      frames: frames.map(stripHeavyFrameFields),
      sourceAsset: assetForSave(liveAsset, "VEhVTUI="),
    };
    const { asset, baseFrame: rb, frames: rf } = rehydrateSavedBlueprint(saved);
    expect(asset!.mode).toBe("saved-thumbnail");
    expect(rb.sourceAssetId).toBe(asset!.id);
    expect(rb.version).toBe(2);
    for (const f of rf) expect(f.sourceAssetId).toBe(asset!.id);
  });

  it("rehydration without an asset leaves frames untouched", () => {
    const saved: SavedBlueprint = {
      id: "b2",
      name: "No-thumb",
      workflowMode: "build",
      createdAt: "2026-06-11T00:00:00Z",
      region: REGION,
      placement: null,
      baseFrame: stripHeavyFrameFields(baseFrame),
      frames: [],
      sourceAsset: null,
    };
    const { asset, baseFrame: rb } = rehydrateSavedBlueprint(saved);
    expect(asset).toBeNull();
    expect(rb.sourceAssetId).toBe("live-a0"); // untouched original reference
  });
});
