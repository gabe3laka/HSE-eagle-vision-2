import { supabase } from "@/integrations/supabase/own-client";
import { HAZARDS } from "@/lib/detection/hazardCatalog";
import type { IncidentRow } from "@/integrations/supabase/db";
import type { RiskRow } from "@/features/safety/lib/safetyTypes";
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
