import type { IncidentReviewStatus, Severity } from "@/integrations/supabase/db";
import { SEVERITY_RANK } from "@/components/ui/severity";

/**
 * PURE helpers for the human approval gate.
 *
 * The rule: NOTHING becomes an incident without a human. Auto-detected rows
 * land with the DB default review_status='pending' (writers never set the
 * column — enforced by reviewGate.test.ts); only a human moves them to
 * 'approved' (incident log + Safety aggregation) or 'dismissed' (kept as a
 * false-positive record, excluded everywhere).
 */

export interface ReviewableIncident {
  review_status: IncidentReviewStatus;
  severity: Severity;
  occurred_at: string;
}

/** Highest severity first, then most recent — critical always rises to the top. */
export function bySeverityThenRecency<T extends ReviewableIncident>(a: T, b: T): number {
  const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  return rank !== 0 ? rank : b.occurred_at > a.occurred_at ? 1 : -1;
}

/** Split a mixed list into the two visible lanes. Dismissed rows appear in
 *  NEITHER lane — they stay in the DB as a false-positive log only. */
export function splitByReviewStatus<T extends ReviewableIncident>(
  list: readonly T[],
): { pending: T[]; approved: T[] } {
  return {
    pending: list.filter((i) => i.review_status === "pending").sort(bySeverityThenRecency),
    approved: list.filter((i) => i.review_status === "approved").sort(bySeverityThenRecency),
  };
}
