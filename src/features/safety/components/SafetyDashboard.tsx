import { Link } from "@/lib/router-shim";
import {
  AlertOctagon,
  Camera,
  CheckCircle2,
  Clock,
  Layers,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { RiskHeatmap } from "@/components/RiskHeatmap";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import type { Detection, Incident, MonitoringSession } from "@/hooks/useIncidents";
import type { HazardType } from "@/lib/detection/types";
import { RISK_LEVEL_META, type DerivedRisk, type RiskLevel } from "../lib/riskModel";
import { initialOf, isOverdue, type RiskActionRow, type RiskRow } from "../lib/safetyTypes";

function Metric({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Camera;
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="metric-card transition-colors hover:border-cyan-300/20">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]">
          <Icon className={`h-4 w-4 ${accent ?? "text-primary"}`} />
        </span>
        {label}
      </div>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
    </div>
  );
}

interface TopHazard {
  key: string;
  label: string;
  hazardType: HazardType | null;
  score: number;
  level: RiskLevel;
  sub: string;
}

export function SafetyDashboard({
  incidents,
  sessions,
  detections,
  derivedRisks,
  registerRisks,
  actions,
}: {
  incidents: Incident[];
  sessions: MonitoringSession[];
  detections: Detection[];
  derivedRisks: DerivedRisk[];
  registerRisks: RiskRow[];
  actions: RiskActionRow[];
}) {
  const total = incidents.length;
  const critical = incidents.filter((i) => i.severity === "critical").length;
  const openIncidents = incidents.filter((i) => !i.resolved).length;

  const usingRegister = registerRisks.length > 0;
  const highRisk = usingRegister
    ? registerRisks.filter((r) => ["high", "critical"].includes(initialOf(r).level)).length
    : derivedRisks.filter((r) => r.level === "high" || r.level === "critical").length;
  const overdue = actions.filter((a) => isOverdue(a)).length;
  const pendingVerification = actions.filter((a) => a.status === "pending_verification").length;

  const topHazards: TopHazard[] = usingRegister
    ? [...registerRisks]
        .map((r) => {
          const init = initialOf(r);
          return {
            key: r.id,
            label: r.title,
            hazardType: r.hazard_type,
            score: init.score,
            level: init.level,
            sub: r.owner_name ?? r.status,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    : derivedRisks.slice(0, 5).map((r) => ({
        key: r.id,
        label: r.label,
        hazardType: r.hazardType,
        score: r.score,
        level: r.level,
        sub: `${r.count} in 90d`,
      }));
  const recent = incidents.slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric icon={ShieldAlert} label="Total incidents" value={total} />
        <Metric icon={AlertOctagon} label="Critical" value={critical} accent="text-red-500" />
        <Metric
          icon={ShieldCheck}
          label="Open incidents"
          value={openIncidents}
          accent="text-orange-500"
        />
        <Metric icon={Layers} label="High-risk" value={highRisk} accent="text-amber-400" />
        <Metric icon={Clock} label="Overdue actions" value={overdue} accent="text-red-400" />
        <Metric
          icon={CheckCircle2}
          label="Pending verify"
          value={pendingVerification}
          accent="text-violet-300"
        />
      </div>

      <section className="console-panel p-5">
        <h2 className="mb-1 font-display text-sm font-semibold">Risk heatmap</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Where hazards are detected across the camera frame.
        </p>
        <RiskHeatmap detections={detections} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="console-panel p-5">
          <h2 className="mb-1 font-display text-sm font-semibold">Top hazards by risk</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {usingRegister ? "From the risk register." : "Derived from recent incident activity."}
          </p>
          {topHazards.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hazards recorded yet — start monitoring to build the risk picture.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {topHazards.map((r) => {
                const Icon = r.hazardType ? HAZARD_ICONS[r.hazardType] : ShieldAlert;
                const meta = RISK_LEVEL_META[r.level];
                return (
                  <li key={r.key} className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.sub}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.bg} ${meta.text}`}
                    >
                      {meta.label} · {r.score}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="console-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Recent incidents</h2>
            <Link to="/incidents" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No incidents recorded yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {recent.map((inc) => {
                const sev = SEVERITY_META[inc.severity];
                const Icon = HAZARD_ICONS[inc.hazard_type];
                return (
                  <div key={inc.id} className="flex items-center gap-3 text-sm">
                    <span className={`rounded-md p-1.5 ${sev.bg} ${sev.text}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate">{HAZARDS[inc.hazard_type].label}</span>
                    <span className={`text-xs font-medium ${sev.text}`}>{sev.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(inc.occurred_at).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <p className="text-center text-[11px] text-muted-foreground/70">
        {sessions.length} monitoring session{sessions.length === 1 ? "" : "s"} on record
      </p>
    </div>
  );
}
