import { useMemo } from "react";
import { Link } from "@/lib/router-shim";
import { AlertOctagon, Camera, ShieldAlert, ShieldCheck, Video } from "lucide-react";
import { useIncidents, useSessions, useDetections } from "@/hooks/useIncidents";
import { ALL_HAZARDS, HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { Button } from "@/components/ui/button";
import { RiskHeatmap } from "@/components/RiskHeatmap";
import type { HazardType } from "@/lib/detection/types";

function StatCard({
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
    <div className="glass-panel rounded-2xl border p-4 transition-colors hover:border-primary/30">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/15">
          <Icon className={`h-4 w-4 ${accent ?? "text-primary"}`} />
        </span>
        {label}
      </div>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function Overview() {
  const { data: incidents } = useIncidents();
  const { data: sessions } = useSessions();
  const { data: detections } = useDetections();

  const stats = useMemo(() => {
    const list = incidents ?? [];
    const counts = ALL_HAZARDS.reduce(
      (acc, h) => ({ ...acc, [h]: 0 }),
      {} as Record<HazardType, number>,
    );
    for (const inc of list) counts[inc.hazard_type] = (counts[inc.hazard_type] ?? 0) + 1;
    const max = Math.max(1, ...(Object.values(counts) as number[]));
    return {
      total: list.length,
      unresolved: list.filter((i) => !i.resolved).length,
      critical: list.filter((i) => i.severity === "critical").length,
      counts,
      max,
      recent: list.slice(0, 6),
    };
  }, [incidents]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">
            Safety dashboard
          </p>
          <h1 className="font-display text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Site safety at a glance — hazard activity, incidents and sessions.
          </p>
        </div>
        <Button asChild>
          <Link to="/">
            <Camera className="mr-2 h-4 w-4" /> Start monitoring
          </Link>
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={ShieldAlert} label="Total incidents" value={stats.total} />
        <StatCard
          icon={AlertOctagon}
          label="Critical"
          value={stats.critical}
          accent="text-red-500"
        />
        <StatCard
          icon={ShieldCheck}
          label="Unresolved"
          value={stats.unresolved}
          accent="text-orange-500"
        />
        <StatCard icon={Video} label="Sessions" value={sessions?.length ?? 0} />
      </div>

      <section className="glass-panel rounded-2xl border p-5">
        <h2 className="mb-1 font-display text-sm font-semibold">Risk heatmap</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Where hazards are detected across the camera frame.
        </p>
        <RiskHeatmap detections={detections ?? []} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="glass-panel rounded-2xl border p-5">
          <h2 className="mb-4 font-display text-sm font-semibold">Incidents by hazard</h2>
          <div className="space-y-3">
            {ALL_HAZARDS.map((h) => {
              const Icon = HAZARD_ICONS[h];
              const count = stats.counts[h];
              return (
                <div key={h} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                    {HAZARDS[h].label}
                  </span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(count / stats.max) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-xs font-medium">{count}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glass-panel rounded-2xl border p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Recent incidents</h2>
            <Link to="/incidents" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {stats.recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No incidents recorded yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {stats.recent.map((inc) => {
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
    </div>
  );
}
