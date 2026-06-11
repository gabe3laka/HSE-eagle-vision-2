import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import type { BlueprintSaveRow } from "../lib/sourceAssets";
import type {
  BlueprintFrame,
  BlueprintPlacement,
  BlueprintSourceAsset,
  SavedBlueprint,
  SelectedRegion,
} from "../types";

// `blueprints` isn't in the auto-generated Database types yet, so we go through
// the `db` shim (typed-loose `.from`) and shape the rows ourselves — the same
// convention as hazard_zones. RLS keeps rows owner-only.
interface BlueprintRow {
  id: string;
  name: string;
  workflow_mode: "build" | "plan";
  backend_mode: string | null;
  region: SelectedRegion;
  placement: BlueprintPlacement | null;
  base_frame: BlueprintFrame;
  frames: BlueprintFrame[] | null;
  source_asset: BlueprintSourceAsset | null;
  created_at: string;
}

const rowToSaved = (r: BlueprintRow): SavedBlueprint => ({
  id: r.id,
  name: r.name,
  workflowMode: r.workflow_mode,
  backendMode: r.backend_mode,
  createdAt: r.created_at,
  region: r.region,
  placement: r.placement,
  baseFrame: r.base_frame,
  frames: r.frames ?? [],
  sourceAsset: r.source_asset,
});

/** Recent saved blueprint procedures for the signed-in owner (RLS-scoped). */
export function useSavedBlueprints() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["blueprints", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<SavedBlueprint[]> => {
      const { data, error } = await db
        .from("blueprints")
        .select(
          "id, name, workflow_mode, backend_mode, region, placement, base_frame, frames, source_asset, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return ((data ?? []) as BlueprintRow[]).map(rowToSaved);
    },
  });
}

/** Save a serialized blueprint (geometry + notes + replay JSON, thumbnail at most). */
export function useSaveBlueprint() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: BlueprintSaveRow) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await db.from("blueprints").insert({
        owner_id: user.id,
        ...(row as unknown as Record<string, unknown>),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blueprints"] }),
  });
}

export function useDeleteBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("blueprints").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blueprints"] }),
  });
}
