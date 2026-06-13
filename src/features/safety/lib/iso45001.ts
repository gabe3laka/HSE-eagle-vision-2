/**
 * ISO 45001 compliance map — clauses 4–10 of the OH&S management-system
 * standard, grouped for readability. Each item notes how SafeLens already
 * contributes evidence. This organises readiness; it does NOT claim
 * certification (which ISO treats as optional). Static config.
 */

export type ComplianceStatus = "not_started" | "in_progress" | "met" | "not_applicable";

export interface ComplianceItem {
  clause: string;
  area: string;
  title: string;
  /** How SafeLens already contributes evidence (informational). */
  evidence: string;
  /** Whether the app produces supporting data today. */
  appSupported: boolean;
}

export const ISO45001_ITEMS: ComplianceItem[] = [
  {
    clause: "4",
    area: "Context",
    title: "Context of the organization & interested parties",
    evidence: "Manual",
    appSupported: false,
  },
  {
    clause: "5.1",
    area: "Leadership",
    title: "Leadership & commitment",
    evidence: "Manual",
    appSupported: false,
  },
  {
    clause: "5.4",
    area: "Leadership",
    title: "Worker participation & consultation",
    evidence: "Manual",
    appSupported: false,
  },
  {
    clause: "6.1.2",
    area: "Planning",
    title: "Hazard identification",
    evidence: "Live detections + hazard catalogue",
    appSupported: true,
  },
  {
    clause: "6.1.2",
    area: "Planning",
    title: "Assessment of OH&S risks",
    evidence: "Risk matrix + register",
    appSupported: true,
  },
  {
    clause: "6.1.3",
    area: "Planning",
    title: "Legal & other requirements",
    evidence: "Manual register",
    appSupported: false,
  },
  {
    clause: "6.2",
    area: "Planning",
    title: "OH&S objectives & action plans",
    evidence: "Actions / CAPA board",
    appSupported: true,
  },
  {
    clause: "7",
    area: "Support",
    title: "Competence, awareness & training",
    evidence: "Manual records",
    appSupported: false,
  },
  {
    clause: "8.1",
    area: "Operation",
    title: "Operational planning & controls",
    evidence: "Risk controls (hierarchy of controls)",
    appSupported: true,
  },
  {
    clause: "8.2",
    area: "Operation",
    title: "Emergency preparedness & response",
    evidence: "Exit zones + manual plan",
    appSupported: true,
  },
  {
    clause: "9.1",
    area: "Performance",
    title: "Monitoring, measurement & analysis",
    evidence: "Dashboard KPIs + monitoring sessions",
    appSupported: true,
  },
  {
    clause: "9.2",
    area: "Performance",
    title: "Internal audit",
    evidence: "Manual",
    appSupported: false,
  },
  {
    clause: "9.3",
    area: "Performance",
    title: "Management review",
    evidence: "Manual",
    appSupported: false,
  },
  {
    clause: "10.2",
    area: "Improvement",
    title: "Incident, nonconformity & corrective action",
    evidence: "Incidents + CAPA board",
    appSupported: true,
  },
  {
    clause: "10.3",
    area: "Improvement",
    title: "Continual improvement",
    evidence: "Residual-risk trend",
    appSupported: true,
  },
];

export const COMPLIANCE_STATUS_META: Record<
  ComplianceStatus,
  { label: string; text: string; bg: string }
> = {
  not_started: { label: "Not started", text: "text-muted-foreground", bg: "bg-muted/40" },
  in_progress: { label: "In progress", text: "text-amber-300", bg: "bg-amber-500/15" },
  met: { label: "Met", text: "text-emerald-300", bg: "bg-emerald-500/15" },
  not_applicable: { label: "N/A", text: "text-muted-foreground", bg: "bg-muted/30" },
};

export const COMPLIANCE_STATUS_ORDER: ComplianceStatus[] = [
  "not_started",
  "in_progress",
  "met",
  "not_applicable",
];
