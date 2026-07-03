import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-shim";
import { ArrowLeft, CheckCircle2, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { db } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";
import type { HazardType, Severity } from "@/integrations/supabase/db";
import type {
  ReportDraftPayload,
  ReportDraftRow,
  ReportType,
} from "@/features/report-composer/types";

const HAZARD_OPTIONS: { value: HazardType; label: string }[] = [
  { value: "unsafe_lift", label: "Unsafe manual handling" },
  { value: "ppe_missing", label: "Missing PPE" },
  { value: "person_proximity", label: "Unsafe proximity" },
  { value: "restricted_zone", label: "Restricted-zone entry" },
  { value: "blocked_exit", label: "Blocked exit / egress" },
  { value: "forklift_proximity", label: "Forklift / vehicle proximity" },
  { value: "fall_risk", label: "Fall from height" },
];
const SEVERITY_OPTIONS: Severity[] = ["low", "medium", "high", "critical"];
const REPORT_TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: "near_miss", label: "Near miss" },
  { value: "hazard", label: "Hazard" },
  { value: "incident", label: "Incident" },
];

const SEVERITY_TONE: Record<Severity, string> = {
  low: "border-emerald-500/40 text-emerald-300",
  medium: "border-amber-500/40 text-amber-300",
  high: "border-orange-500/40 text-orange-300",
  critical: "border-red-500/40 text-red-300",
};

function fallbackDraft(): ReportDraftPayload {
  return {
    report_type: "hazard",
    hazard_type: "person_proximity",
    severity: "medium",
    title: "",
    summary: "",
    probable_cause: "",
    corrective_action: "",
    confidence: 0.5,
    source: "rules",
  };
}

/** Human review / approve / file surface for an agent report draft (/report/:id).
 *  Approving inserts a row into the existing incidents table — the only place a
 *  composer draft becomes a filed record. Nothing auto-files. */
export default function ReportDraftReview({ id }: { id: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<ReportDraftPayload | null>(null);
  const [saving, setSaving] = useState<"approve" | "discard" | null>(null);

  const { data: row, isLoading } = useQuery({
    queryKey: ["report_draft", id],
    enabled: !!user && !!id,
    queryFn: async (): Promise<ReportDraftRow | null> => {
      const { data, error } = await db.from("report_drafts").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as ReportDraftRow | null) ?? null;
    },
    // The draft is written asynchronously right after insert; poll briefly until
    // the agent's suggestion lands (status flips drafting → draft).
    refetchInterval: (q) =>
      (q.state.data as ReportDraftRow | null)?.status === "drafting" ? 900 : false,
  });

  useEffect(() => {
    if (row && !form && row.status !== "drafting") {
      setForm(row.draft ?? { ...fallbackDraft(), summary: row.input_text });
    }
  }, [row, form]);

  const media = row?.media ?? [];
  const set = <K extends keyof ReportDraftPayload>(k: K, v: ReportDraftPayload[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const confidencePct = useMemo(() => (form ? Math.round(form.confidence * 100) : 0), [form]);

  const approve = async () => {
    if (!user || !form || saving) return;
    setSaving("approve");
    try {
      const { data: incident, error: incErr } = await db
        .from("incidents")
        .insert({
          owner_id: user.id,
          session_id: null,
          hazard_type: form.hazard_type,
          severity: form.severity,
          confidence: form.confidence,
          message: form.title ? `${form.title} — ${form.summary}` : form.summary,
        })
        .select("id")
        .single();
      if (incErr || !incident?.id) throw incErr ?? new Error("incident_insert_failed");

      await db
        .from("report_drafts")
        .update({
          draft: form,
          status: "approved",
          incident_id: incident.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      qc.invalidateQueries({ queryKey: ["incidents"] });
      toast({ title: "Report filed", description: "Added to Incidents." });
      navigate("/incidents");
    } catch {
      toast({
        title: "Couldn't file the report",
        description: "Please try again.",
        variant: "destructive",
      });
      setSaving(null);
    }
  };

  const discard = async () => {
    if (saving) return;
    setSaving("discard");
    try {
      await db.from("report_drafts").update({ status: "discarded" }).eq("id", id);
      navigate("/");
    } catch {
      setSaving(null);
    }
  };

  if (isLoading || (row && row.status === "drafting") || !form) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Drafting your report…</p>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-xl py-10 text-center text-muted-foreground">
        <p>This draft could not be found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-2">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Home
        </Button>
        <Badge variant="outline" className="gap-1 text-[11px]">
          <Sparkles className="h-3 w-3" />
          {form.source === "deepseek" ? "AI draft" : "Assisted draft"} · {confidencePct}%
        </Badge>
      </div>

      <div>
        <h1 className="font-display text-xl font-semibold">Review report</h1>
        <p className="text-sm text-muted-foreground">
          Edit anything below, then file it into your safety records. Nothing is saved as an
          incident until you approve.
        </p>
      </div>

      {media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <img
              key={i}
              src={m.thumb}
              alt={m.name}
              className="h-20 w-20 rounded-lg border border-border object-cover"
            />
          ))}
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <Input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Short title"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Report type</span>
            <Select
              value={form.report_type}
              onValueChange={(v) => set("report_type", v as ReportType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Hazard</span>
            <Select
              value={form.hazard_type}
              onValueChange={(v) => set("hazard_type", v as HazardType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HAZARD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Severity</span>
            <Select value={form.severity} onValueChange={(v) => set("severity", v as Severity)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filing as</span>
          <Badge variant="outline" className={`capitalize ${SEVERITY_TONE[form.severity]}`}>
            {form.severity}
          </Badge>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Summary</span>
          <Textarea
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            rows={3}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Probable cause</span>
          <Textarea
            value={form.probable_cause}
            onChange={(e) => set("probable_cause", e.target.value)}
            rows={2}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Corrective action</span>
          <Textarea
            value={form.corrective_action}
            onChange={(e) => set("corrective_action", e.target.value)}
            rows={2}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" disabled={saving !== null} onClick={() => void approve()}>
          {saving === "approve" ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
          )}
          Approve & file
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={saving !== null}
          onClick={() => void discard()}
        >
          <Trash2 className="mr-1.5 h-4 w-4" /> Discard
        </Button>
      </div>
    </div>
  );
}
