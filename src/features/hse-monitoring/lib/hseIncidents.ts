import type { HazardType, Severity } from "@/integrations/supabase/db";
import type { HSEActiveAlert } from "@/lib/detection/hseTypes";

/**
 * Phase 11 — map an HSE alert to an `incidents` row (best-effort). The incidents
 * table predates HSE categories, so we map to the closest HazardType and pack
 * the structured detail (category / action / source / track ids) into the
 * message + zone_label columns. Persistence is gated by the caller (medium+,
 * stable, non-duplicate) so Supabase is never spammed per-frame.
 */

const CATEGORY_TO_HAZARD: Record<string, HazardType> = {
  zone: "restricted_zone",
  ppe: "ppe_missing",
  ergonomics: "unsafe_lift",
  "trip-slip": "fall_risk",
  "blocked-access": "blocked_exit",
  "fire-safety": "blocked_exit",
  proximity: "person_proximity",
};

const HSE_SEVERITIES = new Set<Severity>(["low", "medium", "high", "critical"]);

export interface HseIncidentRow {
  owner_id: string;
  session_id: string | null;
  hazard_type: HazardType;
  severity: Severity;
  confidence: number;
  message: string;
  zone_label: string | null;
}

/** Build a best-effort incidents row from an HSE alert. */
export function mapHseAlertToIncidentRow(
  alert: HSEActiveAlert,
  ownerId: string,
  sessionId: string | null,
): HseIncidentRow {
  const isForklift = /forklift/i.test(alert.title) || /forklift/i.test(alert.shortMessage);
  const hazard =
    alert.category === "proximity" && isForklift
      ? "forklift_proximity"
      : (CATEGORY_TO_HAZARD[alert.category] ?? "person_proximity");
  const severity: Severity = HSE_SEVERITIES.has(alert.severity as Severity)
    ? (alert.severity as Severity)
    : "low";
  return {
    owner_id: ownerId,
    session_id: sessionId,
    hazard_type: hazard,
    severity,
    confidence: Math.round(alert.confidence * 1000) / 1000,
    // Pack the wearable-friendly detail + provenance into the message.
    message: `${alert.shortMessage} — ${alert.recommendedAction} [${alert.category} · ${alert.reasoningSource} · ${alert.relatedTrackIds.join(",")}]`,
    zone_label: alert.category === "zone" ? alert.title : null,
  };
}

/** Should this fired alert be persisted? (medium+ and meaningfully persistent) */
export function shouldPersistHseAlert(alert: HSEActiveAlert): boolean {
  const rank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[alert.severity];
  return rank >= 2; // medium and above
}
