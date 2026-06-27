import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import type { CameraCalibrationRow } from "@/integrations/supabase/db";
import type { CalibrationStatus, ProjectionMethod, CaptureTransform } from "../types";

/**
 * Shape stored inside camera_calibrations.transform (jsonb) for Phase 2
 * ground-plane homography. Everything here is in the SINGLE homography "image"
 * domain = capture-normalized 0..1 (the same space as bboxRemote /
 * getEntityFootPoint). The map domain is site-map meters.
 */
export interface HomographyTransformBlob {
  /** capture-norm 0..1 image → site-map meters. */
  imageToMapH: number[];
  /** site-map meters → capture-norm 0..1 image. */
  mapToImageH: number[];
  /** The tapped correspondences used to solve, for re-solve / audit. */
  referencePoints: {
    image: Array<{ x: number; y: number }>;
    map: Array<{ x_m: number; y_m: number }>;
  };
  /** Capture pipeline at calibration time. A later mismatch invalidates the
   *  in-view homography (receiver pose-lock / capture drift gate). */
  captureTransform: CaptureTransform | null;
  /** RMS reprojection error in capture-normalized units. */
  reprojectionErrorNorm: number;
  /** Device compass heading (deg) when the local map→image was captured.
   *  Used by the receiver pose-lock gate. Null for mounted/no-compass. */
  calibrationHeadingDeg: number | null;
}

/** A camera_calibrations row with the transform jsonb parsed out. */
export interface ParsedCameraCalibration {
  id: string;
  orgId: string;
  deviceId: string;
  userId: string;
  status: CalibrationStatus;
  method: ProjectionMethod;
  transformId: string | null;
  confidence: number | null;
  expiresAt: string | null;
  siteMapId: string | null;
  surfaceType: string | null;
  imageToMapH: number[] | null;
  mapToImageH: number[] | null;
  referencePoints: HomographyTransformBlob["referencePoints"] | null;
  captureTransform: CaptureTransform | null;
  reprojectionErrorNorm: number | null;
  calibrationHeadingDeg: number | null;
}

function asNumberArray(v: unknown): number[] | null {
  if (Array.isArray(v) && v.every((n) => typeof n === "number")) return v as number[];
  return null;
}

function parseRow(row: CameraCalibrationRow): ParsedCameraCalibration {
  const t = (row.transform ?? {}) as Partial<HomographyTransformBlob>;
  return {
    id: row.id,
    orgId: row.org_id,
    deviceId: row.device_id,
    userId: row.user_id,
    status: row.calibration_status,
    method: row.method,
    transformId: row.transform_id,
    confidence: row.confidence,
    expiresAt: row.expires_at,
    siteMapId: row.site_map_id,
    surfaceType: row.surface_type,
    imageToMapH: asNumberArray(t.imageToMapH),
    mapToImageH: asNumberArray(t.mapToImageH),
    referencePoints: (t.referencePoints as HomographyTransformBlob["referencePoints"]) ?? null,
    captureTransform: (t.captureTransform as CaptureTransform | null) ?? null,
    reprojectionErrorNorm:
      typeof t.reprojectionErrorNorm === "number" ? t.reprojectionErrorNorm : null,
    calibrationHeadingDeg:
      typeof t.calibrationHeadingDeg === "number" ? t.calibrationHeadingDeg : null,
  };
}

/**
 * Read all camera calibrations for the org. RLS already allows org-member SELECT,
 * so a receiver can read its peers' calibrations and recompute world points from
 * the peer's imageToMapH. We NEVER trust a peer's broadcast world point — the
 * receiver always recomputes from the homography it reads here.
 */
export function useCameraCalibrations(orgId: string | null) {
  return useQuery<ParsedCameraCalibration[]>({
    queryKey: ["camera_calibrations", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await db.from("camera_calibrations").select("*").eq("org_id", orgId);
      if (error) throw error;
      return ((data ?? []) as CameraCalibrationRow[]).map(parseRow);
    },
    enabled: !!orgId,
    // Calibrations change rarely; refetch occasionally so a peer's new/expired
    // homography propagates without a manual reload.
    refetchInterval: 15_000,
  });
}

export interface UpsertCalibrationInput {
  orgId: string;
  userId: string;
  deviceId: string;
  siteMapId: string;
  surfaceType: "mounted" | "handheld";
  status: CalibrationStatus;
  method: ProjectionMethod;
  confidence: number;
  /** ms-from-now TTL; null = no expiry (mounted). */
  ttlMs: number | null;
  transform: HomographyTransformBlob;
}

/** Self-write upsert of this device's calibration. RLS restricts writes to the
 *  authenticated owner (auth.uid() = user_id). */
export function useUpsertCameraCalibration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertCalibrationInput) => {
      const expiresAt =
        input.ttlMs === null ? null : new Date(Date.now() + input.ttlMs).toISOString();
      const transformId = `${input.method}:${input.deviceId}:${Date.now()}`;
      const { error } = await db.from("camera_calibrations").upsert(
        {
          org_id: input.orgId,
          user_id: input.userId,
          device_id: input.deviceId,
          site_map_id: input.siteMapId,
          surface_type: input.surfaceType,
          calibration_status: input.status,
          method: input.method,
          transform_id: transformId,
          transform: input.transform,
          reprojection_error: input.transform.reprojectionErrorNorm,
          confidence: input.confidence,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,device_id" },
      );
      if (error) throw error;
      return { transformId };
    },
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ["camera_calibrations", v.orgId] });
    },
  });
}
