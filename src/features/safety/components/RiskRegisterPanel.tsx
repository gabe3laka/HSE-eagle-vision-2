import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { ALL_HAZARDS, HAZARDS } from "@/lib/detection/hazardCatalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HazardType } from "@/lib/detection/types";
import { useCreateRisk, useDeleteRisk, useUpdateRisk } from "../hooks/useSafety";
import { RISK_LEVEL_META, type DerivedRisk } from "../lib/riskModel";
import {
  initialOf,
  residualOf,
  RISK_STATUS_META,
  RISK_STATUS_ORDER,
  type RiskRow,
  type RiskStatus,
} from "../lib/safetyTypes";

type Draft = {
  title: string;
  hazard_type: HazardType | "none";
  likelihood: number;
  severity: number;
  status: RiskStatus;
  owner_name: string;
  due_date: string;
  residual_likelihood: number | 0;
  residual_severity: number | 0;
  existing_controls: string;
};

function blankDraft(): Draft {
  return {
    title: "",
    hazard_type: "none",
    likelihood: 3,
    severity: 3,
    status: "open",
    owner_name: "",
    due_date: "",
    residual_likelihood: 0,
    residual_severity: 0,
    existing_controls: "",
  };
}

function draftFromRow(r: RiskRow): Draft {
  return {
    title: r.title,
    hazard_type: r.hazard_type ?? "none",
    likelihood: r.likelihood,
    severity: r.severity,
    status: r.status,
    owner_name: r.owner_name ?? "",
    due_date: r.due_date ?? "",
    residual_likelihood: r.residual_likelihood ?? 0,
    residual_severity: r.residual_severity ?? 0,
    existing_controls: r.existing_controls ?? "",
  };
}

function Scale({
  value,
  onChange,
  allowNone,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  allowNone?: boolean;
  label: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="0">—</SelectItem>}
        {[1, 2, 3, 4, 5].map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RiskDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: RiskRow | null;
  onSave: (patch: Partial<RiskRow>) => void;
}) {
  const [d, setD] = useState<Draft>(initial ? draftFromRow(initial) : blankDraft());
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (!d.title.trim()) return;
    onSave({
      title: d.title.trim(),
      hazard_type: d.hazard_type === "none" ? null : d.hazard_type,
      likelihood: d.likelihood,
      severity: d.severity,
      status: d.status,
      owner_name: d.owner_name.trim() || null,
      due_date: d.due_date || null,
      residual_likelihood: d.residual_likelihood || null,
      residual_severity: d.residual_severity || null,
      existing_controls: d.existing_controls.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit risk" : "New risk"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-xs">Title</Label>
            <Input
              value={d.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Unauthorized entry into restricted work zone"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">Hazard type</Label>
              <Select
                value={d.hazard_type}
                onValueChange={(v) => set("hazard_type", v as Draft["hazard_type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">General / other</SelectItem>
                  {ALL_HAZARDS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {HAZARDS[h].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Status</Label>
              <Select value={d.status} onValueChange={(v) => set("status", v as RiskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {RISK_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">Likelihood (1–5)</Label>
              <Scale
                label="Likelihood"
                value={d.likelihood}
                onChange={(v) => set("likelihood", v)}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Severity (1–5)</Label>
              <Scale label="Severity" value={d.severity} onChange={(v) => set("severity", v)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">Residual likelihood</Label>
              <Scale
                label="Residual likelihood"
                allowNone
                value={d.residual_likelihood}
                onChange={(v) => set("residual_likelihood", v)}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Residual severity</Label>
              <Scale
                label="Residual severity"
                allowNone
                value={d.residual_severity}
                onChange={(v) => set("residual_severity", v)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">Owner</Label>
              <Input
                value={d.owner_name}
                onChange={(e) => set("owner_name", e.target.value)}
                placeholder="Responsible person"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Due date</Label>
              <Input
                type="date"
                value={d.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Existing controls</Label>
            <Textarea
              value={d.existing_controls}
              onChange={(e) => set("existing_controls", e.target.value)}
              rows={2}
              placeholder="Controls already in place…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!d.title.trim()}>
            {initial ? "Save changes" : "Create risk"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RiskRegisterPanel({
  risks,
  derived,
}: {
  risks: RiskRow[];
  derived: DerivedRisk[];
}) {
  const createRisk = useCreateRisk();
  const updateRisk = useUpdateRisk();
  const deleteRisk = useDeleteRisk();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RiskRow | null>(null);

  // Derived hazards not yet in the register → "add to register" suggestions.
  const registered = new Set(risks.map((r) => r.hazard_type).filter(Boolean));
  const suggestions = derived.filter((d) => !registered.has(d.hazardType));

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: RiskRow) => {
    setEditing(r);
    setDialogOpen(true);
  };
  const addFromDerived = (d: DerivedRisk) =>
    createRisk.mutate({
      title: d.label,
      hazard_type: d.hazardType,
      zone_label: d.zones[0] ?? null,
      source: "camera",
      likelihood: d.likelihood,
      severity: d.severity,
      status: "open",
    });

  return (
    <section className="console-panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold">Risk register</h2>
          <p className="text-xs text-muted-foreground">
            Persistent risk records — score, controls, owner, due date and residual risk.
          </p>
        </div>
        <Button size="sm" className="rounded-lg" onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" /> New risk
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="mb-3 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
            Suggested from incidents
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((d) => {
              const meta = RISK_LEVEL_META[d.level];
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => addFromDerived(d)}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-xs transition-colors hover:border-cyan-300/50"
                  title="Add to register"
                >
                  <Plus className="h-3 w-3 text-cyan-300" />
                  {d.label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold ${meta.bg} ${meta.text}`}
                  >
                    {d.score}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {risks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No risks yet. Add one from the incident suggestions above, or create a manual record.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="py-2 pr-3 font-medium">Risk</th>
                <th className="py-2 pr-3 text-center font-medium">Initial</th>
                <th className="py-2 pr-3 text-center font-medium">Residual</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 pr-3 font-medium">Due</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => {
                const init = initialOf(r);
                const initMeta = RISK_LEVEL_META[init.level];
                const res = residualOf(r);
                const resMeta = res ? RISK_LEVEL_META[res.level] : null;
                const Icon = r.hazard_type ? HAZARD_ICONS[r.hazard_type] : null;
                const st = RISK_STATUS_META[r.status];
                return (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="font-medium text-foreground">{r.title}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${initMeta.bg} ${initMeta.text}`}
                      >
                        {init.score}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-center">
                      {resMeta ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${resMeta.bg} ${resMeta.text}`}
                        >
                          {res!.score}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.bg} ${st.text}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.owner_name ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {r.due_date ? new Date(r.due_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label="Edit risk"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete risk"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => deleteRisk.mutate(r.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <RiskDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={editing}
          onSave={(patch) =>
            editing
              ? updateRisk.mutate({ id: editing.id, patch })
              : createRisk.mutate({ ...patch, source: "manual" })
          }
        />
      )}
    </section>
  );
}
