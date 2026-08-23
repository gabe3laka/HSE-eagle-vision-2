import { supabase } from "@/integrations/supabase/own-client";
import { HAZARDS } from "@/lib/detection/hazardCatalog";
import type { IncidentRow } from "@/integrations/supabase/db";
import type { RiskRow } from "@/features/safety/lib/safetyTypes";
import type { AttachedMedia } from "../hooks/useMediaAttach";
import type { ReportDraftPayload } from "../types";

/**
 * THE reasoning seam for the Home composer.
 *
 * Today this calls the app's own reasoning — the `report-draft` Supabase Edge
 * Function (DeepSeek with a deterministic fallback). When the worker repo's
 * agentic endpoint is ready, swap the implementation of this ONE function;
 * every call site stays unchanged.
 *
 * The backend classifies intent: a note that REPORTS something yields a
 * structured draft ("report"); a general question yields a direct HSE answer
 * ("answer") and must NOT become a report_drafts row. "limit" = an anonymous
 * guest is out of free credits. "error" = the seam itself failed — callers
 * preserve the honest degradation (persist the note, open manual review).
 *
 * Contract: NEVER throws. This lane is async and human-reviewed; it can never
 * block live monitoring.
 */
export type ComposerResponse =
  | { kind: "report"; draft: ReportDraftPayload }
  | { kind: "answer"; answer: string }
  | { kind: "limit" }
  | { kind: "error" };

/** What the X-Ray lens saw when the operator sent from the Live dock. Purely
 *  additive context appended to the prompt payload — the edge function may
 *  ignore it today. Display data only; scores are NEVER computed client-side. */
export interface LensContext {
  track_id?: string;
  label: string;
  category?: string;
  bbox: { x: number; y: number; w: number; h: number };
  risk_level?: string;
  severity?: number;
  likelihood?: number;
  risk_reason?: string;
  recommended_action?: string;
  produced_by?: string;
  frame_ts: number;
}

export async function composerRespond(input: {
  text: string;
  transcript?: string | null;
  media: AttachedMedia[];
  /** Optional Live-lens context (see LensContext). */
  lensContext?: LensContext | null;
}): Promise<ComposerResponse> {
  try {
    const { data } = await supabase.functions.invoke("report-draft", {
      body: {
        text: input.text,
        transcript: input.transcript ?? null,
        media: input.media,
        lensContext: input.lensContext ?? null,
      },
    });
    const d = data as {
      status?: string;
      kind?: string;
      answer?: string;
      draft?: ReportDraftPayload | null;
    } | null;
    if (d?.status === "limit") return { kind: "limit" };
    if (d?.kind === "answer" && typeof d.answer === "string" && d.answer.trim()) {
      return { kind: "answer", answer: d.answer };
    }
    if (d?.draft) return { kind: "report", draft: d.draft };
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/* ------------------------------------------------------------------------- */

/** Conservative 1–5 scoring from the incident's qualitative severity. */
const LIKELIHOOD_FROM_SEVERITY = { low: 2, medium: 3, high: 3, critical: 4 } as const;
const IMPACT_FROM_SEVERITY = { low: 2, medium: 3, high: 4, critical: 5 } as const;

/**
 * Part of the same reasoning seam as draftReport: pre-fill a risk-register
 * entry from an APPROVED incident for the human to confirm. Deterministic
 * today (instant, no failure modes before a demo); swap this body for a
 * DeepSeek / worker-agentic call later — call sites stay unchanged.
 */
export function draftRiskFromIncident(
  incident: Pick<
    IncidentRow,
    "id" | "hazard_type" | "severity" | "message" | "zone_label" | "detection_id" | "occurred_at"
  >,
): Partial<RiskRow> {
  const meta = HAZARDS[incident.hazard_type];
  const label = meta?.label ?? incident.hazard_type;
  const when = new Date(incident.occurred_at).toLocaleDateString();
  return {
    title: incident.zone_label ? `${label} — ${incident.zone_label}` : label,
    description:
      `${incident.message ?? meta?.message ?? label}\n\n` +
      `Source: approved incident (${when}, id ${incident.id.slice(0, 8)}).`,
    hazard_type: incident.hazard_type,
    zone_label: incident.zone_label,
    // Detection-initiated incidents carry camera provenance; composer reports
    // are manual observations.
    source: incident.detection_id ? "camera" : "manual",
    likelihood: LIKELIHOOD_FROM_SEVERITY[incident.severity],
    severity: IMPACT_FROM_SEVERITY[incident.severity],
    status: "open",
  };
}
