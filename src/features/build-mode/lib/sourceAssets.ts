import type {
  BlueprintFrame,
  BlueprintPlacement,
  BlueprintSourceAsset,
  BlueprintWorkflowMode,
  SavedBlueprint,
  SelectedRegion,
} from "../types";

/**
 * BlueprintFrame v2 source-asset helpers — pure, node-testable.
 *
 * The rule: big pixels live ONCE in a BlueprintSourceAsset; frames reference
 * them via `sourceAssetId` and never carry repeated base64 themselves. Live
 * sessions keep the asset transient in memory; saving keeps only geometry +
 * notes + replay JSON plus an optional compressed thumbnail / mask contour.
 */

/**
 * Build the transient source asset for one captured keyframe: the local crop
 * we already have, merged with whatever mask info the backend frame carried
 * inline (its v1 transport shape).
 */
export function buildSourceAsset(opts: {
  id: string;
  imageB64: string;
  size: { w: number; h: number };
  /** Backend-returned frame — inline mask/contour fields are lifted off it. */
  backendFrame?: Pick<BlueprintFrame, "sourceMaskB64" | "maskSource"> & {
    maskContour?: Array<{ x: number; y: number }>;
  };
}): BlueprintSourceAsset {
  return {
    id: opts.id,
    imageB64: opts.imageB64,
    size: opts.size,
    mode: "transient",
    maskB64: opts.backendFrame?.sourceMaskB64,
    maskContour: opts.backendFrame?.maskContour,
    maskSource: opts.backendFrame?.maskSource ?? "none",
  };
}

/**
 * Convert a (possibly v1-transport) frame into a stored v2 frame: stamp the
 * version + asset reference and strip the inline base64 fields the asset now
 * owns. Small metadata (sizes, maskSource) stays for display without lookups.
 */
export function toV2Frame(frame: BlueprintFrame, sourceAssetId: string): BlueprintFrame {
  const { sourceImageB64: _img, sourceMaskB64: _mask, ...rest } = frame;
  return { ...rest, version: 2, sourceAssetId };
}

/** Strip anything heavy (inline images/masks) off a frame before persisting. */
export function stripHeavyFrameFields(frame: BlueprintFrame): BlueprintFrame {
  const { sourceImageB64: _img, sourceMaskB64: _mask, ...rest } = frame;
  return rest;
}

/** The saved form of a source asset: compressed thumbnail + contour only. */
export function assetForSave(
  asset: BlueprintSourceAsset | null | undefined,
  thumbnailB64: string | null | undefined,
): BlueprintSourceAsset | null {
  if (!asset && !thumbnailB64) return null;
  return {
    id: asset?.id ?? "saved-asset",
    thumbnailB64: thumbnailB64 ?? asset?.thumbnailB64,
    maskContour: asset?.maskContour,
    size: asset?.size,
    mode: "saved-thumbnail",
    maskSource: asset?.maskSource ?? "none",
  };
}

/** Row payload (snake_case, without owner_id) for the `blueprints` table. */
export interface BlueprintSaveRow {
  name: string;
  workflow_mode: BlueprintWorkflowMode;
  backend_mode: string | null;
  region: SelectedRegion;
  placement: BlueprintPlacement | null;
  base_frame: BlueprintFrame;
  frames: BlueprintFrame[];
  source_asset: BlueprintSourceAsset | null;
}

/**
 * Serialize a finished session for saving: every frame stripped of inline
 * images (notes/geometry/replay kept), the asset reduced to its
 * saved-thumbnail form. Never full video, never full camera frames.
 */
export function serializeBlueprintSave(opts: {
  name: string;
  workflowMode: BlueprintWorkflowMode;
  backendMode?: string | null;
  region: SelectedRegion;
  placement: BlueprintPlacement | null;
  baseFrame: BlueprintFrame;
  frames: BlueprintFrame[];
  sourceAsset?: BlueprintSourceAsset | null;
  thumbnailB64?: string | null;
}): BlueprintSaveRow {
  return {
    name: opts.name,
    workflow_mode: opts.workflowMode,
    backend_mode: opts.backendMode ?? null,
    region: opts.region,
    placement: opts.placement,
    base_frame: stripHeavyFrameFields(opts.baseFrame),
    frames: opts.frames.map(stripHeavyFrameFields),
    source_asset: assetForSave(opts.sourceAsset, opts.thumbnailB64),
  };
}

/**
 * Rehydrate a saved blueprint into live-session state: the single saved
 * thumbnail asset becomes every frame's source asset (slightly stale per
 * keyframe is fine — "saved-thumbnail" mode), so the loaded ghost still looks
 * like the object.
 */
export function rehydrateSavedBlueprint(saved: SavedBlueprint): {
  asset: BlueprintSourceAsset | null;
  baseFrame: BlueprintFrame;
  frames: BlueprintFrame[];
} {
  const asset = saved.sourceAsset ?? null;
  const remap = (f: BlueprintFrame): BlueprintFrame =>
    asset ? { ...f, version: 2, sourceAssetId: asset.id } : f;
  return {
    asset,
    baseFrame: remap(saved.baseFrame),
    frames: saved.frames.map(remap),
  };
}
