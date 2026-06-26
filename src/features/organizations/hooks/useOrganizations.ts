import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import type {
  OrganizationRow,
  OrganizationMemberRow,
  OrganizationJoinRequestRow,
} from "@/integrations/supabase/db";

export function useAllOrganizations() {
  return useQuery<OrganizationRow[]>({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await db.from("organizations").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyMemberships() {
  const { user } = useAuth();
  return useQuery<OrganizationMemberRow[]>({
    queryKey: ["org-memberships", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("organization_members")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyJoinRequests() {
  const { user } = useAuth();
  return useQuery<OrganizationJoinRequestRow[]>({
    queryKey: ["join-requests-mine", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("organization_join_requests")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOrgMembers(orgId: string | null) {
  return useQuery<OrganizationMemberRow[]>({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db
        .from("organization_members")
        .select("*")
        .eq("org_id", orgId!)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePendingJoinRequests(orgId: string | null) {
  return useQuery<OrganizationJoinRequestRow[]>({
    queryKey: ["pending-join-requests", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await db
        .from("organization_join_requests")
        .select("*")
        .eq("org_id", orgId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateOrg() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const { data, error } = await db
        .from("organizations")
        .insert({ name, slug, created_by: user!.id })
        .select("*")
        .single();
      if (error) throw error;
      // Auto-add creator as owner
      await db.from("organization_members").insert({
        org_id: data.id,
        user_id: user!.id,
        role: "owner",
        status: "active",
      });
      return data as OrganizationRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["org-memberships"] });
    },
  });
}

export function useRequestJoin() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ orgId, message }: { orgId: string; message?: string }) => {
      const { error } = await db.from("organization_join_requests").insert({
        org_id: orgId,
        user_id: user!.id,
        status: "pending",
        message: message ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["join-requests-mine"] }),
  });
}

export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await db
        .from("organization_join_requests")
        .update({ status: "cancelled" })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["join-requests-mine"] }),
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      requestId,
      orgId,
      targetUserId,
    }: {
      requestId: string;
      orgId: string;
      targetUserId: string;
    }) => {
      const { error: reqErr } = await db
        .from("organization_join_requests")
        .update({
          status: "approved",
          reviewed_by: user!.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (reqErr) throw reqErr;
      const { error: memErr } = await db
        .from("organization_members")
        .upsert(
          { org_id: orgId, user_id: targetUserId, role: "member", status: "active" },
          { onConflict: "org_id,user_id" },
        );
      if (memErr) throw memErr;
    },
    onSuccess: (_d, { orgId }) => {
      qc.invalidateQueries({ queryKey: ["pending-join-requests", orgId] });
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await db
        .from("organization_join_requests")
        .update({
          status: "rejected",
          reviewed_by: user!.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-join-requests"] }),
  });
}

export function useLeaveOrg() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await db
        .from("organization_members")
        .update({ status: "removed" })
        .eq("org_id", orgId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-memberships"] });
    },
  });
}
