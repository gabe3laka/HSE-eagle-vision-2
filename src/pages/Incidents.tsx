import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, ShieldCheck, XCircle } from "lucide-react";
import { useIncidents, type Incident } from "@/hooks/useIncidents";
import { HAZARDS } from "@/lib/detection/hazardCatalog";
import { hazardIcon } from "@/components/live/hazardIcons";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastAction } from "@/components/ui/toast";
import { SeverityBadge, severityStripeClass, SEVERITY_RANK } from "@/components/ui/severity";

/** Highest severity first, then most recent — critical always rises to the top. */
function bySeverityThenRecency(a: Incident, b: Incident): number {
  const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  return rank !== 0 ? rank : b.occurred_at > a.occurred_at ? 1 : -1;
}
import { supabase } from "@/integrations/supabase/own-client";
import { toast } from "@/hooks/use-toast";
import type { IncidentReviewStatus } from "@/integrations/supabase/db";

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

/** Shared row body: hazard, severity, message, time/confidence/zone. */
function IncidentBody({ inc }: { inc: Incident }) {
  const meta = HAZARDS[inc.hazard_type];
  const Icon = hazardIcon(inc.hazard_type);
  const time = new Date(inc.occurred_at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge level={inc.severity} size="sm" />
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> {meta.label}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{inc.message}</p>
      <p className="mt-1 text-xs tabular text-muted-foreground">
        {time} · {Math.round(Number(inc.confidence) * 100)}%
        {inc.zone_label ? ` · ${inc.zone_label}` : ""}
      </p>
    </div>
  );
}

/**
 * Incidents — two lanes with a human gate between them.
 *
 * 1. Pending approval: everything live monitoring auto-detected. Detections can
 *    be false flags, so nothing here counts as an incident yet — a human either
 *    approves (→ incident log, feeds Safety) or dismisses (kept as a
 *    false-positive record, never filed).
 * 2. Incident log: confirmed records only — human-approved detections and
 *    reports approved on /report/:id. Resolve/unresolve as before.
 */
export default function Incidents() {
  const { data: incidents, isLoading } = useIncidents();
  const queryClient = useQueryClient();

  const { pending, approved } = useMemo(() => {
    const list = incidents ?? [];
    return {
      pending: list.filter((i) => i.review_status === "pending").sort(bySeverityThenRecency),
      approved: list.filter((i) => i.review_status === "approved").sort(bySeverityThenRecency),
    };
  }, [incidents]);

  const setReviewStatus = async (inc: Incident, review_status: IncidentReviewStatus) => {
    const { error } = await supabase.from("incidents").update({ review_status }).eq("id", inc.id);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
    if (review_status === "dismissed") {
      // Dismiss is reversible — offer an immediate undo (restores to pending).
      toast({
        title: "Dismissed as false positive",
        action: (
          <ToastAction altText="Undo dismiss" onClick={() => void setReviewStatus(inc, "pending")}>
            Undo
          </ToastAction>
        ),
      });
    } else if (review_status === "approved") {
      toast({ title: "Incident confirmed" });
    } else {
      toast({ title: "Moved back to pending" });
    }
  };

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
    <div className="space-y-6">
      <header className="page-hero">
        <p className="console-eyebrow">Safety log</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Incident review
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Detections wait here for your judgement — nothing becomes an incident without a human
          approving it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wider">
          <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-warning tabular">
            {pending.length} pending approval
          </span>
          <span className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-muted-foreground tabular">
            {approved.length} confirmed
          </span>
          <span className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-muted-foreground tabular">
            {approved.filter((i) => !i.resolved).length} open
          </span>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {/* ---- Lane 1: pending approval ---- */}
          <section className="animate-fade-in-up">
            <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold">
              <ClipboardCheck className="h-4 w-4 text-warning" aria-hidden /> Pending approval
            </h2>
            {pending.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
                Nothing waiting. New detections from live monitoring appear here first.
              </p>
            ) : (
              <div className="space-y-3">
                {pending.map((inc) => (
                  <div
                    key={inc.id}
                    className={`console-panel hover-lift flex flex-col items-stretch gap-4 p-4 sm:flex-row sm:items-center ${severityStripeClass(inc.severity)}`}
                  >
                    <IncidentDate at={inc.occurred_at} />
                    <IncidentBody inc={inc} />
                    <div className="flex gap-2 self-end sm:flex-col sm:self-auto">
                      <Button
                        size="sm"
                        className="btn-sheen pressable min-h-9 rounded-lg"
                        onClick={() => void setReviewStatus(inc, "approved")}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="pressable min-h-9 rounded-lg text-muted-foreground hover:text-destructive"
                        onClick={() => void setReviewStatus(inc, "dismissed")}
                      >
                        <XCircle className="mr-1.5 h-4 w-4" /> Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- Lane 2: confirmed incident log ---- */}
          <section className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
            <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" /> Incident log
            </h2>
            {approved.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No confirmed incidents"
                description="Approved detections and approved reports appear here — and feed the Safety management view."
                actionLabel="Go to live monitoring"
                actionHref="/live"
              />
            ) : (
              <div className="space-y-3">
                {approved.map((inc) => {
                  return (
                    <div
                      key={inc.id}
                      className={`console-panel hover-lift flex flex-col items-stretch gap-4 p-4 sm:flex-row sm:items-center ${severityStripeClass(inc.severity)} ${
                        inc.resolved ? "opacity-60" : ""
                      }`}
                    >
                      <IncidentDate at={inc.occurred_at} />
                      <IncidentBody inc={inc} />
                      <Button
                        variant={inc.resolved ? "outline" : "secondary"}
                        size="sm"
                        className="pressable min-h-9 self-end rounded-lg sm:self-auto"
                        onClick={() => void toggleResolved(inc)}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                        {inc.resolved ? "Resolved" : "Resolve"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
