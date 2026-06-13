import { useMemo } from "react";
import { Link } from "@/lib/router-shim";
import { Camera } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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

  const inc = incidents ?? [];
  const derivedRisks = useMemo(() => deriveRisksFromIncidents(incidents ?? []), [incidents]);
  const risks = registerRisks ?? [];
  const acts = actions ?? [];

  return (
    <div className="space-y-6">
      <header className="page-hero flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="console-eyebrow text-cyan-300/80">Safety management</p>
          <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">
            Risk &amp; controls
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Turn detections into assessed risks, controls and corrective actions — an ISO 45001 /
            HSE-aligned management layer above the incident log.
          </p>
        </div>
        <Button asChild size="lg" className="min-h-11 rounded-xl">
          <Link to="/">
            <Camera className="mr-2 h-4 w-4" /> Start monitoring
          </Link>
        </Button>
      </header>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-9 rounded-lg border border-border/60 bg-secondary/40 px-3.5 data-[state=active]:border-cyan-300/40 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-100"
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
