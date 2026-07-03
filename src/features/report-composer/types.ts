import type { HazardType, Severity } from "@/integrations/supabase/db";
import type { AttachedMedia } from "./hooks/useMediaAttach";

export type ReportType = "near_miss" | "hazard" | "incident";

/** The agent's structured suggestion. Mirrors the report-draft edge function. */
export interface ReportDraftPayload {
  report_type: ReportType;
  hazard_type: HazardType;
  severity: Severity;
  title: string;
  summary: string;
  probable_cause: string;
  corrective_action: string;
  confidence: number;
  source: "deepseek" | "rules";
}

export interface ReportDraftRow {
  id: string;
  owner_id: string;
  org_id: string | null;
  status: "drafting" | "draft" | "approved" | "discarded";
  input_text: string;
  transcript: string | null;
  media: AttachedMedia[];
  draft: ReportDraftPayload | null;
  incident_id: string | null;
  created_at: string;
  updated_at: string;
}
