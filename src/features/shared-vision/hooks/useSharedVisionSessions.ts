import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import type { SharedVisionSessionRow, SharedVisionPeerRow } from "@/integrations/supabase/db";

export interface ActiveSharedSession {
  id: string;
  org_id: string;
  owner_id: string;
  label: string | null;
  started_at: string;
  /** Display name of the session host (shared_vision_peers.peer_label for the
   *  role='host' online peer). Lets a member see WHO is live, not just an id. */
  hostLabel: string | null;
  /** Number of online peers currently in the session. */
  onlineCount: number;
}

/**
 * Fetches active shared-vision sessions for the org, enriched with who is
 * hosting and how many peers are online. Refreshes every 5s so the "Live now"
 * list stays current without realtime subscription overhead.
 *
 * Host identity comes from shared_vision_peers.peer_label (RLS sv_peers_select
 * lets org members read every peer row in their org) — public.profiles is
 * never touched, so no privacy/RLS change is needed.
 *
 * Only returns sessions with status='active' for this org. The join flow lets a
 * member find an existing session to join without the host sharing a link.
 */
export function useActiveSharedVisionSessions(orgId: string | null) {
  return useQuery<ActiveSharedSession[]>({
    queryKey: ["shared_vision_sessions", "active", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data: sessions, error } = await db
        .from("shared_vision_sessions")
        .select("id, org_id, owner_id, label, started_at")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      const rows = (sessions ?? []) as SharedVisionSessionRow[];
      if (rows.length === 0) return [];

      // One extra query for the org's online peers; map host label + counts.
      const { data: peers } = await db
        .from("shared_vision_peers")
        .select("shared_session_id, role, peer_label, status")
        .eq("org_id", orgId)
        .eq("status", "online");
      const peerRows = (peers ?? []) as Pick<
        SharedVisionPeerRow,
        "shared_session_id" | "role" | "peer_label" | "status"
      >[];

      return rows.map((row) => {
        const sessionPeers = peerRows.filter((p) => p.shared_session_id === row.id);
        const host = sessionPeers.find((p) => p.role === "host");
        const hostLabel =
          host?.peer_label ?? sessionPeers.find((p) => p.peer_label)?.peer_label ?? null;
        return {
          id: row.id,
          org_id: row.org_id,
          owner_id: row.owner_id,
          label: row.label,
          started_at: row.started_at,
          hostLabel,
          onlineCount: sessionPeers.length,
        };
      });
    },
    enabled: !!orgId,
    refetchInterval: 5_000,
  });
}
