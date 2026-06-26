import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import type { SharedVisionSessionRow } from "@/integrations/supabase/db";

export interface ActiveSharedSession {
  id: string;
  org_id: string;
  owner_id: string;
  label: string | null;
  started_at: string;
}

/**
 * Fetches active shared-vision sessions for the org. Refreshes every 5s so
 * the list stays current without realtime subscription overhead.
 *
 * Only returns sessions with status='active' that belong to this org.
 * The join flow lets a peer find an existing session to join without needing
 * the host to share a link.
 */
export function useActiveSharedVisionSessions(orgId: string | null) {
  return useQuery<ActiveSharedSession[]>({
    queryKey: ["shared_vision_sessions", "active", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await db
        .from("shared_vision_sessions")
        .select("id, org_id, owner_id, label, started_at")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((row: SharedVisionSessionRow) => ({
        id: row.id,
        org_id: row.org_id,
        owner_id: row.owner_id,
        label: row.label,
        started_at: row.started_at,
      }));
    },
    enabled: !!orgId,
    refetchInterval: 5_000,
  });
}
