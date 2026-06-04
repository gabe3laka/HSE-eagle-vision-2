import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/own-client";
import { useAuth } from "@/contexts/AuthContext";
import type { DetectionRow, IncidentRow, MonitoringSessionRow } from "@/integrations/supabase/db";

export type Incident = IncidentRow;
export type MonitoringSession = MonitoringSessionRow;

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

export type Detection = Pick<DetectionRow, "hazard_type" | "severity" | "bbox" | "detected_at">;

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
      return (data ?? []) as Detection[];
    },
  });
}
