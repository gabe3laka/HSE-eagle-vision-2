import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";

// --- Types ---

export interface SiteMap {
  id: string;
  org_id: string;
  name: string;
  scale_m_per_px: number | null;
  image_url: string | null;
  width_m: number | null;
  height_m: number | null;
  created_at: string;
  updated_at: string;
}

export interface SiteZone {
  id: string;
  site_map_id: string;
  org_id: string;
  name: string;
  zone_type: string;
  polygon_pts: Array<{ x: number; y: number }> | null;
  created_at: string;
}

export interface CameraPlacement {
  id: string;
  org_id: string;
  user_id: string;
  device_id: string;
  camera_label: string;
  device_label: string | null;
  map_x_m: number | null;
  map_y_m: number | null;
  heading_deg: number | null;
  fov_deg: number | null;
  placement_accuracy: string;
  updated_at?: string;
}

// --- Hooks ---

export function useSiteMaps(orgId: string | null) {
  return useQuery<SiteMap[]>({
    queryKey: ["site_maps", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await db
        .from("site_maps")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SiteMap[];
    },
    enabled: !!orgId,
  });
}

export function useOrgCameraDevices(orgId: string | null) {
  return useQuery<CameraPlacement[]>({
    queryKey: ["org_camera_devices", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await db.from("org_camera_devices").select("*").eq("org_id", orgId);
      if (error) throw error;
      return (data ?? []) as unknown as CameraPlacement[];
    },
    enabled: !!orgId,
  });
}

export function useUpdateCameraPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      orgId: string;
      userId: string;
      deviceId: string;
      cameraLabel: string;
      mapXM: number;
      mapYM: number;
      headingDeg: number;
      fovDeg: number;
    }) => {
      const { error } = await db.from("org_camera_devices").upsert(
        {
          org_id: patch.orgId,
          user_id: patch.userId,
          device_id: patch.deviceId,
          camera_label: patch.cameraLabel,
          map_x_m: patch.mapXM,
          map_y_m: patch.mapYM,
          heading_deg: patch.headingDeg,
          fov_deg: patch.fovDeg,
          placement_accuracy: "manual_map",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,device_id" },
      );
      if (error) throw error;
    },
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ["org_camera_devices", v.orgId] });
    },
  });
}

export function useCreateSiteMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (map: {
      orgId: string;
      name: string;
      widthM?: number;
      heightM?: number;
      scaleMPerPx?: number;
      imageUrl?: string;
    }) => {
      const { data, error } = await db
        .from("site_maps")
        .insert({
          org_id: map.orgId,
          name: map.name,
          width_m: map.widthM ?? null,
          height_m: map.heightM ?? null,
          scale_m_per_px: map.scaleMPerPx ?? null,
          image_url: map.imageUrl ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ["site_maps", v.orgId] });
    },
  });
}
