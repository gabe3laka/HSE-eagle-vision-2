import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useIncidents, type Incident } from "@/hooks/useIncidents";
import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/own-client";
import { toast } from "@/hooks/use-toast";

/** Compact calendar-style stamp showing the day an incident occurred. */
function IncidentDate({ at }: { at: string }) {
  const when = new Date(at);
  const month = when.toLocaleDateString(undefined, { month: "short" });
  const day = when.toLocaleDateString(undefined, { day: "numeric" });
  return (
    <div
      title={when.toLocaleString()}
      className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-muted/50 text-center leading-none"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {month}
      </span>
      <span className="mt-1 text-xl font-bold">{day}</span>
    </div>
  );
}

export default function Incidents() {
  const { data: incidents, isLoading } = useIncidents();
  const queryClient = useQueryClient();

  const toggleResolved = async (inc: Incident) => {
    const { error } = await supabase
      .from("incidents")
      .update({ resolved: !inc.resolved })
      .eq("id", inc.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">
          Safety log
        </p>
        <h1 className="font-display text-2xl font-bold">Incidents</h1>
        <p className="text-sm text-muted-foreground">
          High and critical hazards are recorded here with the time and date for review.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : !incidents || incidents.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No incidents yet"
          description="When monitoring detects a high or critical hazard, it's recorded here with the time and date."
          actionLabel="Go to live monitoring"
          actionHref="/"
        />
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => {
            const meta = HAZARDS[inc.hazard_type];
            const sev = SEVERITY_META[inc.severity];
            const Icon = HAZARD_ICONS[inc.hazard_type];
            const time = new Date(inc.occurred_at).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            });
            return (
              <div
                key={inc.id}
                className={`flex items-center gap-4 rounded-xl border ${sev.border} bg-card/60 p-4 ${
                  inc.resolved ? "opacity-60" : ""
                }`}
              >
                <IncidentDate at={inc.occurred_at} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`flex items-center gap-1 text-xs font-semibold uppercase ${sev.text}`}
                    >
                      <Icon className="h-3.5 w-3.5" /> {sev.label}
                    </span>
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{inc.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {time} · {Math.round(Number(inc.confidence) * 100)}%
                    {inc.zone_label ? ` · ${inc.zone_label}` : ""}
                  </p>
                </div>
                <Button
                  variant={inc.resolved ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => toggleResolved(inc)}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {inc.resolved ? "Resolved" : "Resolve"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
