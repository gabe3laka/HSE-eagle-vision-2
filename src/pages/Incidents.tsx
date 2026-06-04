import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImageOff, ShieldCheck } from "lucide-react";
import { useIncidents, getSnapshotUrl, type Incident } from "@/hooks/useIncidents";
import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/own-client";
import { toast } from "@/hooks/use-toast";

function IncidentSnapshot({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSnapshotUrl(path).then((u) => {
      if (cancelled) return;
      setUrl(u);
      if (!u) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed || !path) {
    return (
      <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-5 w-5 text-muted-foreground/50" />
      </div>
    );
  }
  if (!url) return <div className="h-20 w-28 shrink-0 animate-pulse rounded-lg bg-muted" />;
  return <img src={url} alt="Incident snapshot" className="h-20 w-28 shrink-0 rounded-lg object-cover" />;
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
        <h1 className="font-display text-2xl font-bold">Incidents</h1>
        <p className="text-sm text-muted-foreground">
          High and critical hazards are saved here with a snapshot for review.
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
          description="When monitoring detects a high or critical hazard, it's recorded here with a snapshot."
          actionLabel="Go to live monitoring"
          actionHref="/"
        />
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => {
            const meta = HAZARDS[inc.hazard_type];
            const sev = SEVERITY_META[inc.severity];
            const Icon = HAZARD_ICONS[inc.hazard_type];
            return (
              <div
                key={inc.id}
                className={`flex items-center gap-4 rounded-xl border ${sev.border} bg-card/60 p-4 ${
                  inc.resolved ? "opacity-60" : ""
                }`}
              >
                <IncidentSnapshot path={inc.snapshot_path} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`flex items-center gap-1 text-xs font-semibold uppercase ${sev.text}`}>
                      <Icon className="h-3.5 w-3.5" /> {sev.label}
                    </span>
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{inc.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(inc.occurred_at).toLocaleString()} ·{" "}
                    {Math.round(Number(inc.confidence) * 100)}%
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
