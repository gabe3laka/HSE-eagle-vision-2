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
  /** Free guest AI credits (default 8); decremented server-side per draft. */
  ai_credits: number;
}

export type MessageRole = "user" | "assistant" | "system";

/** A conversation thread (ChatGPT-like). Owner-scoped; guests own theirs via an
 *  anonymous session. Heavy structured drafts live in report_drafts, linked from
 *  the assistant message — see MessageRow.report_draft_id. */
export interface ConversationRow {
  id: string;
  owner_id: string;
  title: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string | null;
  media: unknown;
  report_draft_id: string | null;
  created_at: string;
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
/** Human approval gate: auto-detected items land 'pending'; only a human makes
 *  them 'approved' (the incident log + Safety aggregation) or 'dismissed'
 *  (kept as a false-positive record, never filed). */
export type IncidentReviewStatus = "pending" | "approved" | "dismissed";

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
  review_status: IncidentReviewStatus;
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
export interface SiteMapRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  map_image_url: string | null;
  width_m: number | null;
  height_m: number | null;
  scale_m_per_px: number | null;
  created_at: string;
  updated_at: string;
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

export interface CameraCalibrationRow {
  id: string;
  org_id: string;
  device_id: string;
  user_id: string;
  calibration_status:
    | "uncalibrated"
    | "manual_map"
    | "homography"
    | "calibrated"
    | "stale"
    | "failed";
  method: "none" | "manual_map" | "homography_4pt" | "marker";
  transform_id: string | null;
  /** Phase 2 ground-plane data lives here: imageToMapH, mapToImageH,
   *  referencePoints, captureTransform, reprojectionErrorNorm,
   *  calibrationHeadingDeg. See useCameraCalibrations. */
  transform: Record<string, unknown> | null;
  camera_matrix: Record<string, unknown> | null;
  distortion_coefficients: Record<string, unknown> | null;
  camera_pose_world: Record<string, unknown> | null;
  reprojection_error: number | null;
  confidence: number | null;
  visible_anchor_ids: unknown | null;
  expires_at: string | null;
  /** Phase 2 columns (20260627000001). */
  site_map_id: string | null;
  surface_type: string | null;
  created_at: string;
  updated_at: string;
}
