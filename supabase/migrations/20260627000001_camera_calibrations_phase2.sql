-- Phase 2 (ground-plane homography) persistence.
-- The calibration scaffold table camera_calibrations already exists
-- (20260625000004) with: org_id, device_id, user_id, calibration_status,
-- method, transform_id, transform jsonb, camera_matrix, distortion_coefficients,
-- camera_pose_world, reprojection_error, confidence, visible_anchor_ids,
-- expires_at, created_at, updated_at, plus org-member SELECT + self-write RLS.
--
-- Phase 2 stores everything it needs INSIDE the existing transform jsonb
-- (imageToMapH, mapToImageH, referencePoints, captureTransform,
-- reprojectionErrorNorm, calibrationHeadingDeg). Only two real columns are
-- added so receivers can filter peers to the same site map and tell mounted
-- cameras from handheld ones. Additive and idempotent — safe on a fresh local
-- reset and against the already-deployed remote.

ALTER TABLE public.camera_calibrations
  ADD COLUMN IF NOT EXISTS site_map_id uuid;

ALTER TABLE public.camera_calibrations
  ADD COLUMN IF NOT EXISTS surface_type text;

-- Guarded FK: add only when site_maps exists and the constraint is not present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_maps'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name = 'camera_calibrations'
        AND constraint_name = 'camera_calibrations_site_map_id_fkey'
    ) THEN
      ALTER TABLE public.camera_calibrations
        ADD CONSTRAINT camera_calibrations_site_map_id_fkey
        FOREIGN KEY (site_map_id)
        REFERENCES public.site_maps(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
