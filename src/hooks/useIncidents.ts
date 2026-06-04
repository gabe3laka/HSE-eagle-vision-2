import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

export type Incident = Database["public"]["Tables"]["incidents"]["Row"];
export type MonitoringSession = Database["public"]["Tables"]["monitoring_sessions"]["Row"];

export function useIncidents(limit = 200) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["incidents", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Incident[];
    },
  });
}

export function useSessions(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["sessions", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitoring_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as MonitoringSession[];
    },
  });
}

export type Detection = Database["public"]["Tables"]["detections"]["Row"];

/** Recent detections (including low-tier silent records) for the risk heatmap. */
export function useDetections(limit = 1000) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["detections", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("detections")
        .select("hazard_type, severity, bbox, detected_at")
        .order("detected_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a short-lived signed URL for a private incident snapshot. */
export async function getSnapshotUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("incident-snapshots")
    .createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
