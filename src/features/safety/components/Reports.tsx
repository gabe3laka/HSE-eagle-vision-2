import { Download, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Incident } from "@/hooks/useIncidents";
import { actionsCsv, downloadCsv, incidentsCsv, riskRegisterCsv } from "../lib/safetyReports";
import type { RiskActionRow, RiskRow } from "../lib/safetyTypes";

const today = () => new Date().toISOString().slice(0, 10);

export function Reports({
  risks,
  actions,
  incidents,
}: {
  risks: RiskRow[];
  actions: RiskActionRow[];
  incidents: Incident[];
}) {
  const riskTitle = (id: string) => risks.find((r) => r.id === id)?.title ?? "—";

  const cards = [
    {
      title: "Risk register",
      desc: "All risk records with initial & residual scores, owner and due dates.",
      count: risks.length,
      onClick: () => downloadCsv(`risk-register-${today()}.csv`, riskRegisterCsv(risks)),
    },
    {
      title: "Corrective actions",
      desc: "CAPA actions with control type, assignee, status and verification.",
      count: actions.length,
      onClick: () => downloadCsv(`safety-actions-${today()}.csv`, actionsCsv(actions, riskTitle)),
    },
    {
      title: "Incident log",
      desc: "Recorded incidents with hazard, severity, zone and resolution.",
      count: incidents.length,
      onClick: () => downloadCsv(`incidents-${today()}.csv`, incidentsCsv(incidents)),
    },
  ];

  return (
    <div className="space-y-5">
      <section className="console-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold">Reports &amp; exports</h2>
            <p className="text-xs text-muted-foreground">
              Export HSE evidence as CSV for audits, or print a summary of the current view.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-lg"
            onClick={() => window.print()}
          >
            <Printer className="mr-1.5 h-4 w-4" /> Print summary
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.title} className="console-panel flex flex-col p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]">
                <FileText className="h-4 w-4 text-cyan-300" />
              </span>
              <div>
                <p className="text-sm font-semibold">{c.title}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {c.count} rows
                </p>
              </div>
            </div>
            <p className="mt-2 flex-1 text-xs text-muted-foreground">{c.desc}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3 rounded-lg"
              onClick={c.onClick}
              disabled={c.count === 0}
            >
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
