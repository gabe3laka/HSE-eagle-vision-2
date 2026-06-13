import type { HazardType } from "@/lib/detection/types";
import type { ControlType } from "./controlLibrary";
import type { ComplianceStatus } from "./iso45001";
import { riskLevel, riskScore, type RiskLevel } from "./riskModel";

/**
 * Row shapes for the persisted Safety Management tables (risk_register,
 * risk_actions, compliance_items) + small pure helpers (overdue, initial /
 * residual scoring). Kept framework-free so the helpers are unit-testable.
 */

export type RiskStatus = "open" | "assessing" | "controlling" | "monitoring" | "closed";
export type ActionStatus = "open" | "in_progress" | "pending_verification" | "closed";

export interface RiskRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  hazard_type: HazardType | null;
  zone_label: string | null;
  source: "camera" | "manual";
  people_exposed: string | null;
  existing_controls: string | null;
  likelihood: number;
  severity: number;
  residual_likelihood: number | null;
  residual_severity: number | null;
  status: RiskStatus;
  owner_name: string | null;
  due_date: string | null;
  review_date: string | null;
  evidence: unknown;
  created_at: string;
  updated_at: string;
}

export interface RiskActionRow {
  id: string;
  owner_id: string;
  risk_id: string;
  title: string;
  description: string | null;
  control_type: ControlType;
  assignee: string | null;
  due_date: string | null;
  status: ActionStatus;
  evidence: unknown;
  verification_result: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceRow {
  id: string;
  owner_id: string;
  clause: string;
  title: string;
  status: ComplianceStatus;
  notes: string | null;
  evidence: unknown;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const RISK_STATUS_META: Record<RiskStatus, { label: string; text: string; bg: string }> = {
  open: { label: "Open", text: "text-cyan-300", bg: "bg-cyan-500/15" },
  assessing: { label: "Assessing", text: "text-sky-300", bg: "bg-sky-500/15" },
  controlling: { label: "Controlling", text: "text-amber-300", bg: "bg-amber-500/15" },
  monitoring: { label: "Monitoring", text: "text-violet-300", bg: "bg-violet-500/15" },
  closed: { label: "Closed", text: "text-emerald-300", bg: "bg-emerald-500/15" },
};

export const RISK_STATUS_ORDER: RiskStatus[] = [
  "open",
  "assessing",
  "controlling",
  "monitoring",
  "closed",
];

/** A corrective action is overdue when it has a past due date and isn't closed. */
export function isOverdue(
  a: { due_date: string | null; status: ActionStatus },
  now: number = Date.now(),
): boolean {
  if (!a.due_date || a.status === "closed") return false;
  return new Date(a.due_date).getTime() < now;
}

export function initialOf(r: { likelihood: number; severity: number }): {
  score: number;
  level: RiskLevel;
} {
  const score = riskScore(r.likelihood, r.severity);
  return { score, level: riskLevel(score) };
}

export function residualOf(r: {
  residual_likelihood: number | null;
  residual_severity: number | null;
}): { score: number; level: RiskLevel } | null {
  if (r.residual_likelihood == null || r.residual_severity == null) return null;
  const score = riskScore(r.residual_likelihood, r.residual_severity);
  return { score, level: riskLevel(score) };
}
