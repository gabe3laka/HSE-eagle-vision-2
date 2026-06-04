// Typed accessor that works even before the auto-generated Database types
// have caught up to a fresh migration. Use `db` for `.from(...)` calls in
// place of `supabase` when you need typed-table inference.
import { supabase } from "@/integrations/supabase/client";

type HazardType =
  | "unsafe_lift"
  | "ppe_missing"
  | "person_proximity"
  | "restricted_zone"
  | "blocked_exit"
  | "forklift_proximity"
  | "fall_risk";
type Severity = "low" | "medium" | "high" | "critical";
type SessionStatus = "active" | "ended";

export interface ProfileRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  preferred_language: string;
}
export interface AlertSettingsRow {
  id: string;
  owner_id: string;
  config: Record<string, unknown>;
  preferred_language: string;
  voice_enabled: boolean;
}
export interface MonitoringSessionRow {
  id: string;
  owner_id: string;
  label: string | null;
  status: SessionStatus;
  device_label: string | null;
  frames_processed: number;
  started_at: string;
  ended_at: string | null;
}
export interface DetectionRow {
  id: string;
  owner_id: string;
  session_id: string;
  hazard_type: HazardType;
  severity: Severity;
  confidence: number;
  message: string | null;
  bbox: unknown;
  acknowledged: boolean;
  detected_at: string;
}
export interface IncidentRow {
  id: string;
  owner_id: string;
  session_id: string | null;
  detection_id: string | null;
  hazard_type: HazardType;
  severity: Severity;
  confidence: number;
  message: string | null;
  zone_label: string | null;
  snapshot_path: string | null;
  resolved: boolean;
  resolution_notes: string | null;
  occurred_at: string;
  created_at: string;
}

// Cast to any so .from("table_name") accepts our string tables, even when
// the auto-generated Database type is still the empty placeholder.
export const db = supabase as unknown as {
  from: (table: string) => any;
  storage: typeof supabase.storage;
  auth: typeof supabase.auth;
  channel: typeof supabase.channel;
};
