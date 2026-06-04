import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import type { DetectionZone, ZonePoint } from "@/lib/detection/types";

// hazard_zones isn't in the auto-generated Database types yet, so we go through
// the `db` shim (typed-loose `.from`) and shape the rows ourselves.
interface ZoneRow {
  id: string;
  kind: "restricted" | "exit";
  label: string | null;
  points: ZonePoint[] | null;
}

/** Active hazard zones for the signed-in owner (RLS-scoped). */
export function useZones() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["hazard_zones", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<DetectionZone[]> => {
      const { data, error } = await db
        .from("hazard_zones")
        .select("id, kind, label, points, active")
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as ZoneRow[]).map((z) => ({
        id: z.id,
        kind: z.kind,
        label: z.label,
        points: z.points ?? [],
      }));
    },
  });
}

export function useCreateZone() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (zone: {
      kind: "restricted" | "exit";
      label: string;
      points: ZonePoint[];
    }) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await db.from("hazard_zones").insert({
        owner_id: user.id,
        kind: zone.kind,
        label: zone.label,
        points: zone.points as unknown,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hazard_zones"] }),
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("hazard_zones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hazard_zones"] }),
  });
}
