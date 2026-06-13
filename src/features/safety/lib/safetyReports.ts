import { HAZARDS } from "@/lib/detection/hazardCatalog";
import type { Incident } from "@/hooks/useIncidents";
import { CONTROL_TYPE_META } from "./controlLibrary";
import { initialOf, residualOf, type RiskActionRow, type RiskRow } from "./safetyTypes";

/**
 * Report / export builders — pure string assembly so the CSV logic is
 * unit-testable. `downloadCsv` is the only browser-touching helper.
 */

type Cell = string | number | null | undefined;

/** RFC-4180-ish CSV: quote cells containing comma/quote/newline. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export function riskRegisterCsv(risks: RiskRow[]): string {
  return toCsv(
    [
      "Title",
      "Hazard",
      "Zone",
      "Source",
      "Likelihood",
      "Severity",
      "Initial score",
      "Residual score",
      "Status",
      "Owner",
      "Due date",
      "Review date",
    ],
    risks.map((r) => [
      r.title,
      r.hazard_type ? (HAZARDS[r.hazard_type]?.label ?? r.hazard_type) : "—",
      r.zone_label ?? "",
      r.source,
      r.likelihood,
      r.severity,
      initialOf(r).score,
      residualOf(r)?.score ?? "",
      r.status,
      r.owner_name ?? "",
      r.due_date ?? "",
      r.review_date ?? "",
    ]),
  );
}

export function actionsCsv(actions: RiskActionRow[], riskTitle: (id: string) => string): string {
  return toCsv(
    [
      "Action",
      "Risk",
      "Control type",
      "Assignee",
      "Due date",
      "Status",
      "Verification result",
      "Verified at",
    ],
    actions.map((a) => [
      a.title,
      riskTitle(a.risk_id),
      CONTROL_TYPE_META[a.control_type]?.label ?? a.control_type,
      a.assignee ?? "",
      a.due_date ?? "",
      a.status,
      a.verification_result ?? "",
      a.verified_at ?? "",
    ]),
  );
}

export function incidentsCsv(incidents: Incident[]): string {
  return toCsv(
    ["Occurred at", "Hazard", "Severity", "Confidence", "Zone", "Resolved", "Message"],
    incidents.map((i) => [
      i.occurred_at,
      HAZARDS[i.hazard_type]?.label ?? i.hazard_type,
      i.severity,
      Math.round(Number(i.confidence) * 100) + "%",
      i.zone_label ?? "",
      i.resolved ? "yes" : "no",
      i.message ?? "",
    ]),
  );
}

/** Trigger a client-side CSV download (browser only). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
