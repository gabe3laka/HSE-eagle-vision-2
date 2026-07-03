import { useCallback, useState } from "react";
import { db } from "@/integrations/supabase/db";
import { supabase } from "@/integrations/supabase/own-client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/features/organizations/context/OrgContext";
import type { AttachedMedia } from "./useMediaAttach";
import type { ReportDraftPayload } from "../types";

/**
 * Owns the "send → draft" step of the Home composer.
 *
 * 1. Persist the raw inputs into report_drafts (status "drafting").
 * 2. Ask the report-draft edge function for a structured suggestion (it always
 *    returns one — DeepSeek, else a deterministic rules draft).
 * 3. Save the suggestion onto the row (status "draft") and return the id so the
 *    caller can navigate to /report/:id for human review.
 *
 * Nothing files an incident here — that only happens on the review screen after
 * a human approves. On a hard failure the row is still created with a null draft
 * so the reviewer can fill it in manually (honest degradation, never a dead end).
 */
export function useReportDraft() {
  const { user } = useAuth();
  const { selectedOrgId } = useOrg();
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (input: { text: string; media: AttachedMedia[] }): Promise<string | null> => {
      if (!user) return null;
      setSubmitting(true);
      try {
        const { data: created, error: insErr } = await db
          .from("report_drafts")
          .insert({
            owner_id: user.id,
            org_id: selectedOrgId ?? null,
            status: "drafting",
            input_text: input.text,
            media: input.media,
          })
          .select("id")
          .single();
        if (insErr || !created?.id) throw insErr ?? new Error("draft_insert_failed");
        const id = created.id as string;

        let draft: ReportDraftPayload | null = null;
        try {
          const { data } = await supabase.functions.invoke("report-draft", {
            body: { text: input.text, media: input.media },
          });
          const d = (data as { draft?: ReportDraftPayload } | null)?.draft;
          if (d) draft = d;
        } catch {
          // Edge function unreachable — leave draft null; review screen lets the
          // human author it manually. Row already saved.
        }

        await db
          .from("report_drafts")
          .update({ draft, status: "draft", updated_at: new Date().toISOString() })
          .eq("id", id);

        return id;
      } finally {
        setSubmitting(false);
      }
    },
    [user, selectedOrgId],
  );

  return { submit, submitting };
}
