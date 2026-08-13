import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useIncidents, useSessions, useDetections } from "@/hooks/useIncidents";
import { deriveRisksFromIncidents } from "@/features/safety/lib/riskModel";
import { useRisks, useRiskActions } from "@/features/safety/hooks/useSafety";
import { SafetyDashboard } from "@/features/safety/components/SafetyDashboard";
import { RiskAssessment } from "@/features/safety/components/RiskAssessment";
import { CapaBoard } from "@/features/safety/components/CapaBoard";
import { ControlsPanel } from "@/features/safety/components/ControlsPanel";
import { ComplianceMap } from "@/features/safety/components/ComplianceMap";
import { Reports } from "@/features/safety/components/Reports";

const TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "risk", label: "Risk assessment" },
  { value: "actions", label: "Actions" },
  { value: "controls", label: "Controls" },
  { value: "compliance", label: "Compliance" },
  { value: "reports", label: "Reports" },
];

/**
 * Safety Management — the management-system layer above the incident log:
 * risk matrix + register, CAPA actions, hierarchy-of-controls library, ISO
 * 45001 readiness and reports. Renders at /overview (nav label "Safety").
 * Risk scores are derived from incidents; risks/actions/compliance persist in
 * owner-scoped Supabase tables.
 */
export default function Safety() {
  const { data: incidents } = useIncidents();
  const { data: sessions } = useSessions();
  const { data: detections } = useDetections();
  const { data: registerRisks } = useRisks();
  const { data: actions } = useRiskActions();

  // Safety aggregates CONFIRMED records only — items still in the Incidents
  // tab's pending-approval queue (or dismissed as false positives) never feed
  // risk scores, compliance or reports.
  const inc = useMemo(
    () => (incidents ?? []).filter((i) => i.review_status === "approved"),
    [incidents],
  );
  const derivedRisks = useMemo(() => deriveRisksFromIncidents(inc), [inc]);
  const risks = registerRisks ?? [];
  const acts = actions ?? [];

  return (
    <div className="space-y-6">
      <header className="page-hero">
        <p className="console-eyebrow">Safety management</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Risk &amp; controls
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          The aggregated management view of what actually happened — approved incidents become
          assessed risks, controls and corrective actions (ISO 45001 / HSE-aligned). Monitoring
          itself lives in the Live tab.
        </p>
      </header>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-9 rounded-lg border border-border/60 bg-secondary/40 px-3.5 text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <SafetyDashboard
            incidents={inc}
            sessions={sessions ?? []}
            detections={detections ?? []}
            derivedRisks={derivedRisks}
            registerRisks={risks}
            actions={acts}
          />
        </TabsContent>
        <TabsContent value="risk" className="mt-4">
          <RiskAssessment risks={risks} derived={derivedRisks} />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <CapaBoard actions={acts} risks={risks} />
        </TabsContent>
        <TabsContent value="controls" className="mt-4">
          <ControlsPanel risks={derivedRisks} />
        </TabsContent>
        <TabsContent value="compliance" className="mt-4">
          <ComplianceMap />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <Reports risks={risks} actions={acts} incidents={inc} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
