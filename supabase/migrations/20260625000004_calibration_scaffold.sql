-- Calibration scaffold — unused by Phase-1 code but applied now so Phases 2-3
-- need no migration churn. Tables: site_maps, site_zones, site_anchors,
-- camera_calibrations.

CREATE TABLE site_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  map_image_url text,
  width_m numeric,
  height_m numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE site_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_maps_select" ON site_maps FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "site_maps_write" ON site_maps FOR ALL TO authenticated
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

CREATE TABLE site_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_map_id uuid NOT NULL REFERENCES site_maps(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  zone_type text NOT NULL DEFAULT 'general',
  polygon_m jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE site_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_zones_select" ON site_zones FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "site_zones_write" ON site_zones FOR ALL TO authenticated
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

CREATE TABLE site_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_map_id uuid NOT NULL REFERENCES site_maps(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  anchor_type text NOT NULL CHECK (anchor_type IN ('aruco','apriltag','charuco','manual_point')),
  marker_id integer,
  label text,
  x_m numeric NOT NULL,
  y_m numeric NOT NULL,
  z_m numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE site_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_anchors_select" ON site_anchors FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "site_anchors_write" ON site_anchors FOR ALL TO authenticated
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

CREATE TABLE camera_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calibration_status text NOT NULL DEFAULT 'uncalibrated'
    CHECK (calibration_status IN ('uncalibrated','manual_map','homography','calibrated','stale','failed')),
  method text NOT NULL DEFAULT 'none'
    CHECK (method IN ('none','manual_map','homography_4pt','marker')),
  transform_id text,
  transform jsonb,
  camera_matrix jsonb,
  distortion_coefficients jsonb,
  camera_pose_world jsonb,
  reprojection_error numeric,
  confidence numeric,
  visible_anchor_ids jsonb,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE camera_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cal_select" ON camera_calibrations FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "cal_self" ON camera_calibrations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- org_camera_devices.site_map_id was created (nullable) in 20260625000002.
-- Now that site_maps exists, add the FK safely. Guarded so it never fails on a
-- re-run or where the column/constraint already exists (e.g. remote already
-- has it applied). Same guarded style as the monitoring_sessions FK.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_maps'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name = 'org_camera_devices'
        AND constraint_name = 'org_camera_devices_site_map_id_fkey'
    ) THEN
      ALTER TABLE public.org_camera_devices
        ADD CONSTRAINT org_camera_devices_site_map_id_fkey
        FOREIGN KEY (site_map_id)
        REFERENCES public.site_maps(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
