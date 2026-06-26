-- Phase 1B: bind each camera placement to a specific site map so the
-- projection engine can reject cross-map pairs (cameras on different maps
-- cannot share a coordinate origin and must not project against each other).

ALTER TABLE org_camera_devices ADD COLUMN IF NOT EXISTS site_map_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'org_camera_devices'
      AND kcu.column_name = 'site_map_id'
  ) THEN
    ALTER TABLE org_camera_devices
      ADD CONSTRAINT org_camera_devices_site_map_id_fkey
        FOREIGN KEY (site_map_id) REFERENCES site_maps(id) ON DELETE SET NULL;
  END IF;
END;
$$;
