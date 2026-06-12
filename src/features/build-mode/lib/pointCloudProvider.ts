/**
 * FUTURE-ONLY interface for an offline 3D preview provider (e.g. Point-E).
 *
 * Deliberately NOT used in the live Build/Plan loop: generated 3D assets are
 * slow, approximate, and not camera-anchored — live guidance uses the
 * real-time 2.5D virtual blueprint vectors instead (see pseudoPointCloud /
 * virtualBlueprintPoints). Nothing in the app imports this for live rendering;
 * it exists so a "Generate rough 3D preview of selected part" feature can plug
 * in later without touching the Plan pipeline.
 */

export interface PointCloudPreview {
  /** Normalized points of the generated preview (NOT camera-anchored). */
  points: Array<{ x: number; y: number; z: number }>;
  source: string;
}

export interface PointCloudProvider {
  generatePreview(input: {
    label: string;
    imageB64?: string;
    prompt?: string;
  }): Promise<PointCloudPreview>;
}

/** Stub provider — counts calls (so tests can assert the live loop never uses
 *  it) and resolves an empty preview. Replace with a real adapter later. */
export class UnavailablePointCloudProvider implements PointCloudProvider {
  callCount = 0;
  async generatePreview(): Promise<PointCloudPreview> {
    this.callCount += 1;
    return { points: [], source: "unavailable" };
  }
}

/** Shared stub instance for future wiring + the never-called-live test. */
export const pointCloudProvider = new UnavailablePointCloudProvider();
