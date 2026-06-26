CREATE TABLE shared_vision_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monitoring_session_id uuid,
  label text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);

-- Guarded FK: add only when monitoring_sessions exists (it lives on remote, not in
-- repo migrations). Safe no-op when the table is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='monitoring_sessions') THEN
    ALTER TABLE shared_vision_sessions
      ADD CONSTRAINT shared_vision_sessions_monitoring_session_id_fkey
      FOREIGN KEY (monitoring_session_id)
      REFERENCES public.monitoring_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE shared_vision_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sv_sessions_select" ON shared_vision_sessions FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "sv_sessions_insert" ON shared_vision_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = owner_id);
CREATE POLICY "sv_sessions_update" ON shared_vision_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE shared_vision_peers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_session_id uuid NOT NULL REFERENCES shared_vision_sessions(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  peer_label text,
  camera_id text,
  device_label text,
  role text NOT NULL DEFAULT 'peer' CHECK (role IN ('host','peer')),
  last_seen_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline')),
  UNIQUE (shared_session_id, device_id)
);
ALTER TABLE shared_vision_peers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sv_peers_select" ON shared_vision_peers FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "sv_peers_self" ON shared_vision_peers FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Device registry for labeling and Phase 1B+ map placement.
-- user_id NOT NULL + CASCADE ensures no orphan rows on user delete.
-- site_map_id binds a placement to one site map so the projection engine can
-- reject cross-map pairs. Nullable; the FK to site_maps is added in migration
-- 20260625000004 once that table exists (guarded DO block there).
CREATE TABLE org_camera_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  camera_label text NOT NULL,
  device_label text,
  status text NOT NULL DEFAULT 'active',
  site_map_id uuid,
  map_x_m numeric,
  map_y_m numeric,
  heading_deg numeric,
  fov_deg numeric,
  placement_accuracy text NOT NULL DEFAULT 'uncalibrated',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id, device_id)
);
ALTER TABLE org_camera_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cam_select" ON org_camera_devices FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "cam_self" ON org_camera_devices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cam_admin" ON org_camera_devices FOR ALL TO authenticated
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
