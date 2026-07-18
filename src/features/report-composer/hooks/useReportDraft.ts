import { useCallback, useState } from "react";
import { db } from "@/integrations/supabase/db";
import { supabase } from "@/integrations/supabase/own-client";
import { useOrg } from "@/features/organizations/context/OrgContext";
import { draftReport } from "../lib/reasoningClient";
import type { AttachedMedia } from "./useMediaAttach";

/**
 * Owns the "send → draft" step of the Home composer.
 *
 * 1. Persist the raw inputs into report_drafts (status "drafting").
 * 2. Ask the reasoning seam (lib/reasoningClient — today the report-draft edge
 *    function; later the worker's agentic endpoint) for a structured suggestion.
 * 3. Save the suggestion onto the row (status "draft") and return the id so the
 *    caller can navigate to /report/:id for human review.
 *
 * Nothing files an incident here — that only happens on the review screen after
 * a human approves. On a hard failure the row is still created with a null draft
 * so the reviewer can fill it in manually (honest degradation, never a dead end).
 */
export function useReportDraft() {
  const { selectedOrgId } = useOrg();
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (input: {
      text: string;
      media: AttachedMedia[];
      /** Optional thread link — the draft belongs to this conversation. */
      conversationId?: string | null;
    }): Promise<string | null> => {
      // Resolve the owner from the LIVE session (not React state) so a draft sent
      // immediately after an on-demand anonymous sign-in isn't dropped by a stale
      // `user` closure. Works identically for signed-in and guest sessions.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return null;
      setSubmitting(true);
      try {
        const { data: created, error: insErr } = await db
          .from("report_drafts")
          .insert({
            owner_id: uid,
            org_id: selectedOrgId ?? null,
            status: "drafting",
            input_text: input.text,
            media: input.media,
            conversation_id: input.conversationId ?? null,
          })
          .select("id")
          .single();
        // Persisting the raw input is the one step that must succeed — without a
        // row there is nothing to review. Signal failure with null (the composer
        // toasts) instead of throwing into the click handler.
        if (insErr || !created?.id) return null;
        const id = created.id as string;

        // The reasoning seam returns null on any failure — the review screen
        // then lets the human author the report manually. Row already saved.
        const draft = await draftReport({ text: input.text, media: input.media });

        try {
          await db
            .from("report_drafts")
            .update({ draft, status: "draft", updated_at: new Date().toISOString() })
            .eq("id", id);
        } catch {
          // Row exists with status "drafting"; the review screen polls and the
          // human can still author manually. Don't lose the id over this.
        }

        return id;
      } finally {
        setSubmitting(false);
      }
    },
    [selectedOrgId],
  );

  return { submit, submitting };
}
