import { useCallback, useState } from "react";
import { db } from "@/integrations/supabase/db";
import { supabase } from "@/integrations/supabase/own-client";
import { useOrg } from "@/features/organizations/context/OrgContext";
import { composerRespond } from "../lib/reasoningClient";
import type { LensContext } from "../lib/reasoningClient";
import type { AttachedMedia } from "./useMediaAttach";

/** What a composer send produced. `report` carries the report_drafts row id for
 *  /report/:id; `answer` carries the direct reply (NO row was created);
 *  `limit` = anonymous guest out of free credits; `failed` = nothing could be
 *  persisted at all. */
export type ComposerResult =
  | { type: "report"; id: string }
  | { type: "answer"; answer: string }
  | { type: "limit" }
  | { type: "failed" };

/**
 * Owns the "send" step of the Home composer.
 *
 * 1. Ask the reasoning seam (lib/reasoningClient — today the report-draft edge
 *    function; later the worker's agentic endpoint) to CLASSIFY the note and
 *    either draft a report or answer a question.
 * 2. Question → return the answer; no report_drafts row is ever created.
 * 3. Report → persist ONE row with the draft and return its id for /report/:id
 *    human review.
 * 4. Seam failure → honest degradation, same guarantee as always: persist the
 *    raw note with a null draft so the reviewer can author manually. The note
 *    is never lost to a backend hiccup.
 *
 * Nothing files an incident here — that only happens on the review screen
 * after a human approves.
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
      /** Optional Live X-Ray lens context, forwarded to the reasoning seam. */
      lensContext?: LensContext | null;
    }): Promise<ComposerResult> => {
      // Resolve the owner from the LIVE session (not React state) so a send
      // immediately after an on-demand anonymous sign-in isn't dropped by a
      // stale `user` closure. Works for signed-in and guest sessions alike.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return { type: "failed" };
      setSubmitting(true);
      try {
        // Classify FIRST — a question must never leave a junk draft behind.
        const res = await composerRespond({
          text: input.text,
          media: input.media,
          lensContext: input.lensContext ?? null,
        });

        if (res.kind === "answer") return { type: "answer", answer: res.answer };
        if (res.kind === "limit") return { type: "limit" };

        // Report (or seam error → manual review): persist the note. This is
        // the one step that must succeed — without a row there is nothing to
        // review.
        const { data: created, error: insErr } = await db
          .from("report_drafts")
          .insert({
            owner_id: uid,
            org_id: selectedOrgId ?? null,
            status: res.kind === "report" ? "draft" : "drafting",
            input_text: input.text,
            media: input.media,
            conversation_id: input.conversationId ?? null,
            draft: res.kind === "report" ? res.draft : null,
          })
          .select("id")
          .single();
        if (insErr || !created?.id) return { type: "failed" };
        return { type: "report", id: created.id as string };
      } finally {
        setSubmitting(false);
      }
    },
    [selectedOrgId],
  );

  return { submit, submitting };
}
