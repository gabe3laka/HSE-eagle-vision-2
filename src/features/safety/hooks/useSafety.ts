import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import type { ComplianceRow, RiskActionRow, RiskRow } from "../lib/safetyTypes";

/**
 * Persistence for Safety Management — risk register, corrective actions (CAPA)
 * and ISO 45001 compliance items. Owner-scoped via RLS; the browser only ever
 * touches these tables through the authenticated Supabase client. Mirrors the
 * existing useSavedBlueprints hook style.
 */

export function useRisks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["risks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("risk_register")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RiskRow[];
    },
  });
}

export function useRiskActions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["risk_actions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("risk_actions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RiskActionRow[];
    },
  });
}

export function useComplianceItems() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["compliance_items", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db.from("compliance_items").select("*");
      if (error) throw error;
      return (data ?? []) as ComplianceRow[];
    },
  });
}

const stamp = () => new Date().toISOString();

export function useCreateRisk() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (risk: Partial<RiskRow>) => {
      const { data, error } = await db
        .from("risk_register")
        .insert({ ...risk, owner_id: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data as RiskRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risks"] }),
  });
}

export function useUpdateRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<RiskRow> }) => {
      const { error } = await db
        .from("risk_register")
        .update({ ...patch, updated_at: stamp() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risks"] }),
  });
}

export function useDeleteRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("risk_register").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risks"] });
      qc.invalidateQueries({ queryKey: ["risk_actions"] });
    },
  });
}

export function useCreateAction() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (action: Partial<RiskActionRow>) => {
      const { data, error } = await db
        .from("risk_actions")
        .insert({ ...action, owner_id: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data as RiskActionRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risk_actions"] }),
  });
}

export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<RiskActionRow> }) => {
      const { error } = await db
        .from("risk_actions")
        .update({ ...patch, updated_at: stamp() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risk_actions"] }),
  });
}

export function useDeleteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("risk_actions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risk_actions"] }),
  });
}

/** Upsert one ISO 45001 clause status (unique on owner_id+clause+title). */
export function useUpsertCompliance() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (row: Partial<ComplianceRow> & { clause: string; title: string }) => {
      const { error } = await db
        .from("compliance_items")
        .upsert(
          { ...row, owner_id: user?.id, updated_at: stamp() },
          { onConflict: "owner_id,clause,title" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance_items"] }),
  });
}
