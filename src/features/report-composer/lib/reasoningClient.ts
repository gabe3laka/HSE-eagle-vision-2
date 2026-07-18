import { supabase } from "@/integrations/supabase/own-client";
import type { AttachedMedia } from "../hooks/useMediaAttach";
import type { ReportDraftPayload } from "../types";

/**
 * THE reasoning seam for report drafting.
 *
 * Today this calls the app's own reasoning — the `report-draft` Supabase Edge
 * Function (DeepSeek with a deterministic rules fallback). When the worker
 * repo's agentic endpoint is ready, swap the implementation of this ONE
 * function; every call site stays unchanged.
 *
 * Contract: never throws with a useful failure — returns null on any error so
 * callers degrade gracefully (the review screen opens with a fillable draft).
 * This lane is async and human-reviewed; it can never block live monitoring.
 */
export async function draftReport(input: {
  text: string;
  transcript?: string | null;
  media: AttachedMedia[];
}): Promise<ReportDraftPayload | null> {
  try {
    const { data } = await supabase.functions.invoke("report-draft", {
      body: { text: input.text, transcript: input.transcript ?? null, media: input.media },
    });
    return (data as { draft?: ReportDraftPayload } | null)?.draft ?? null;
  } catch {
    return null;
  }
}
