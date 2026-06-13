import type { HazardType, Severity } from "@/lib/detection/types";
import { HAZARDS } from "@/lib/detection/hazardCatalog";

/**
 * SafeLens risk model — pure, deterministic, unit-testable. Implements the
 * HSE "how likely × how seriously" risk-assessment workflow and the ISO 31000
 * analyze→evaluate loop on top of the data the app ALREADY collects (incidents
 * grouped by the existing `hazard_type` / `severity` enums). No DB, no network.
 *
 *   Likelihood 1..5  (derived from incident frequency in a rolling window)
 *   Severity   1..5  (mapped from the DB severity enum, with a floor for
 *                     immediate-critical hazards such as forklift / fall)
 *   Score      = Likelihood × Severity   (1..25)
 *   Level      = Low / Medium / High / Critical
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Minimal incident shape the model needs (a subset of IncidentRow). */
export interface RiskIncidentInput {
  hazard_type: HazardType;
  severity: Severity;
  zone_label?: string | null;
  resolved?: boolean;
  occurred_at: string;
}

export interface DerivedRisk {
  id: HazardType;
  hazardType: HazardType;
  label: string;
  /** Incidents within the rolling window (drives likelihood). */
  count: number;
  /** All-time incidents for this hazard. */
  totalCount: number;
  unresolved: number;
  lastSeen: string | null;
  zones: string[];
  likelihood: number;
  severity: number;
  score: number;
  level: RiskLevel;
}

export const DEFAULT_WINDOW_DAYS = 90;

const SEVERITY_SCORE: Record<Severity, number> = {
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

const SEV_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function clampScale(v: number): number {
  return Math.max(1, Math.min(5, Math.round(v)));
}

/** DB severity enum → 1..5 matrix severity. Immediate-critical hazards
 *  (collision / fall paths) are floored at 4 — they can never score "minor". */
export function severityScore(hazardType: HazardType, severity: Severity): number {
  const base = SEVERITY_SCORE[severity] ?? 1;
  const floor = HAZARDS[hazardType]?.immediateCritical ? 4 : 1;
  return clampScale(Math.max(base, floor));
}

/** Incident frequency in the window → 1..5 likelihood band. */
export function likelihoodFromCount(count: number): number {
  if (count <= 0) return 1;
  if (count <= 2) return 2;
  if (count <= 5) return 3;
  if (count <= 10) return 4;
  return 5;
}

export function riskScore(likelihood: number, severity: number): number {
  return clampScale(likelihood) * clampScale(severity);
}

/** 5×5 banding — 1–4 Low, 5–9 Medium, 10–15 High, 16–25 Critical. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export const LIKELIHOOD_LABELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
export const SEVERITY_LABELS = [
  "Near miss",
  "Minor injury",
  "Medical treatment",
  "Major injury",
  "Fatality",
];

export const RISK_LEVEL_META: Record<
  RiskLevel,
  { label: string; text: string; bg: string; dot: string; cell: string }
> = {
  low: {
    label: "Low",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    dot: "bg-emerald-400",
    cell: "bg-emerald-500/20 text-emerald-200",
  },
  medium: {
    label: "Medium",
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    dot: "bg-amber-400",
    cell: "bg-amber-500/25 text-amber-100",
  },
  high: {
    label: "High",
    text: "text-orange-300",
    bg: "bg-orange-500/15",
    dot: "bg-orange-400",
    cell: "bg-orange-500/30 text-orange-100",
  },
  critical: {
    label: "Critical",
    text: "text-red-300",
    bg: "bg-red-500/20",
    dot: "bg-red-500",
    cell: "bg-red-500/35 text-red-50",
  },
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEV_RANK[b] > SEV_RANK[a] ? b : a;
}

/**
 * Derive one risk record per hazard_type from incident history. Likelihood
 * comes from frequency inside `windowDays`; severity from the worst severity
 * ever observed for that hazard (with the immediate-critical floor). Sorted by
 * score, highest first. Pure given `now`.
 */
export function deriveRisksFromIncidents(
  incidents: RiskIncidentInput[],
  now: number = Date.now(),
  windowDays: number = DEFAULT_WINDOW_DAYS,
): DerivedRisk[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const groups = new Map<HazardType, RiskIncidentInput[]>();
  for (const inc of incidents) {
    const arr = groups.get(inc.hazard_type) ?? [];
    arr.push(inc);
    groups.set(inc.hazard_type, arr);
  }

  const risks: DerivedRisk[] = [];
  for (const [hazardType, list] of groups) {
    const count = list.filter((i) => now - new Date(i.occurred_at).getTime() <= windowMs).length;
    const worst = list.reduce<Severity>((acc, i) => maxSeverity(acc, i.severity), "low");
    const severity = severityScore(hazardType, worst);
    const likelihood = likelihoodFromCount(count);
    const score = riskScore(likelihood, severity);
    const zones = Array.from(
      new Set(list.map((i) => i.zone_label).filter((z): z is string => !!z)),
    );
    const lastSeen = list.reduce<string | null>(
      (acc, i) => (!acc || i.occurred_at > acc ? i.occurred_at : acc),
      null,
    );
    risks.push({
      id: hazardType,
      hazardType,
      label: HAZARDS[hazardType]?.label ?? hazardType,
      count,
      totalCount: list.length,
      unresolved: list.filter((i) => i.resolved === false).length,
      lastSeen,
      zones,
      likelihood,
      severity,
      score,
      level: riskLevel(score),
    });
  }
  return risks.sort((a, b) => b.score - a.score);
}
