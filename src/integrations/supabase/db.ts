// Typed accessor that works even before the auto-generated Database types
// have caught up to a fresh migration. Use `db` for `.from(...)` calls in
// place of `supabase` when you need typed-table inference.
import { supabase } from "@/integrations/supabase/own-client";

export type HazardType =
  | "unsafe_lift"
  | "ppe_missing"
  | "person_proximity"
  | "restricted_zone"
  | "blocked_exit"
  | "forklift_proximity"
  | "fall_risk";
export type Severity = "low" | "medium" | "high" | "critical";
export type SessionStatus = "active" | "ended";

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

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface OrganizationMemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  status: "active" | "removed";
  joined_at: string;
}
export interface OrganizationJoinRequestRow {
  id: string;
  org_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  message: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
export interface SharedVisionSessionRow {
  id: string;
  org_id: string;
  owner_id: string;
  monitoring_session_id: string | null;
  label: string | null;
  status: "active" | "ended";
  started_at: string;
  ended_at: string | null;
}
export interface SharedVisionPeerRow {
  id: string;
  shared_session_id: string;
  org_id: string;
  user_id: string;
  device_id: string;
  peer_label: string | null;
  camera_id: string | null;
  device_label: string | null;
  role: "host" | "peer";
  last_seen_at: string;
  status: "online" | "offline";
}
export interface OrgCameraDeviceRow {
  id: string;
  org_id: string;
  user_id: string;
  device_id: string;
  camera_label: string;
  device_label: string | null;
  status: string;
  site_map_id: string | null;
  map_x_m: number | null;
  map_y_m: number | null;
  heading_deg: number | null;
  fov_deg: number | null;
  placement_accuracy: string;
  created_at: string;
  updated_at: string;
}
