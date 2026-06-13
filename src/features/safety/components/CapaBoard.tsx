import { useState } from "react";
import { ArrowLeft, ArrowRight, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  CONTROL_LIBRARY,
  CONTROL_TYPE_META,
  CONTROL_TYPE_ORDER,
  type ControlType,
} from "../lib/controlLibrary";
import { useCreateAction, useDeleteAction, useUpdateAction } from "../hooks/useSafety";
import { isOverdue, type ActionStatus, type RiskActionRow, type RiskRow } from "../lib/safetyTypes";

const COLUMNS: { key: ActionStatus; label: string; accent: string }[] = [
  { key: "open", label: "Open", accent: "text-cyan-300" },
  { key: "in_progress", label: "In progress", accent: "text-amber-300" },
  { key: "pending_verification", label: "Pending verification", accent: "text-violet-300" },
  { key: "closed", label: "Closed", accent: "text-emerald-300" },
];
const STATUS_KEYS = COLUMNS.map((c) => c.key);

function AddActionDialog({
  open,
  onOpenChange,
  risks,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  risks: RiskRow[];
  onCreate: (a: Partial<RiskActionRow>) => void;
}) {
  const [riskId, setRiskId] = useState(risks[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [controlType, setControlType] = useState<ControlType>("engineering");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");

  const selectedRisk = risks.find((r) => r.id === riskId);
  const suggestions = selectedRisk?.hazard_type ? CONTROL_LIBRARY[selectedRisk.hazard_type] : [];

  const submit = () => {
    if (!riskId || !title.trim()) return;
    onCreate({
      risk_id: riskId,
      title: title.trim(),
      control_type: controlType,
      assignee: assignee.trim() || null,
      due_date: dueDate || null,
      status: "open",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New corrective action</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-xs">Risk</Label>
            <Select value={riskId} onValueChange={setRiskId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a risk" />
              </SelectTrigger>
              <SelectContent>
                {risks.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {suggestions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs">Suggested controls (hierarchy order)</Label>
              <div className="flex flex-wrap gap-1.5">
                {[...suggestions]
                  .sort((a, b) => CONTROL_TYPE_META[a.type].rank - CONTROL_TYPE_META[b.type].rank)
                  .map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setTitle(s.text);
                        setControlType(s.type);
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] ${CONTROL_TYPE_META[s.type].bg} ${CONTROL_TYPE_META[s.type].text}`}
                    >
                      {s.text}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div>
            <Label className="mb-1 block text-xs">Action</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What will be done"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">Control type</Label>
              <Select value={controlType} onValueChange={(v) => setControlType(v as ControlType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTROL_TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CONTROL_TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Assignee</Label>
            <Input
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Owner"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!riskId || !title.trim()}>
            Add action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyInline({ onVerify }: { onVerify: (result: string) => void }) {
  const [result, setResult] = useState("");
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Input
        value={result}
        onChange={(e) => setResult(e.target.value)}
        placeholder="Verification result…"
        className="h-8 text-[11px]"
      />
      <Button
        size="sm"
        className="h-8 shrink-0 rounded-md px-2 text-[11px]"
        onClick={() => onVerify(result.trim() || "Verified")}
      >
        Verify
      </Button>
    </div>
  );
}

export function CapaBoard({ actions, risks }: { actions: RiskActionRow[]; risks: RiskRow[] }) {
  const createAction = useCreateAction();
  const updateAction = useUpdateAction();
  const deleteAction = useDeleteAction();
  const [addOpen, setAddOpen] = useState(false);

  const riskTitle = (id: string) => risks.find((r) => r.id === id)?.title ?? "—";
  const move = (a: RiskActionRow, dir: -1 | 1) => {
    const idx = STATUS_KEYS.indexOf(a.status);
    const next = Math.max(0, Math.min(STATUS_KEYS.length - 1, idx + dir));
    const patch: Partial<RiskActionRow> = { status: STATUS_KEYS[next] };
    if (STATUS_KEYS[next] === "closed" && !a.verified_at)
      patch.verified_at = new Date().toISOString();
    updateAction.mutate({ id: a.id, patch });
  };
  const verify = (a: RiskActionRow, result: string) =>
    updateAction.mutate({
      id: a.id,
      patch: {
        status: "closed",
        verification_result: result,
        verified_at: new Date().toISOString(),
      },
    });

  const overdueCount = actions.filter((a) => isOverdue(a)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Corrective &amp; preventive actions, classified by the hierarchy of controls.
          {overdueCount > 0 && (
            <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
              {overdueCount} overdue
            </span>
          )}
        </p>
        <Button
          size="sm"
          className="rounded-lg"
          onClick={() => setAddOpen(true)}
          disabled={risks.length === 0}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add action
        </Button>
      </div>

      {risks.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Add a risk first"
          description="Corrective actions attach to a risk. Create a risk in the Risk assessment tab, then plan its controls here."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-4">
          {COLUMNS.map((col, colIdx) => {
            const items = actions.filter((a) => a.status === col.key);
            return (
              <div key={col.key} className="console-panel p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className={`text-xs font-semibold uppercase tracking-wide ${col.accent}`}>
                    {col.label}
                  </h3>
                  <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((a) => {
                    const meta = CONTROL_TYPE_META[a.control_type];
                    const overdue = isOverdue(a);
                    return (
                      <div
                        key={a.id}
                        className={`rounded-lg border bg-background/40 p-2.5 ${overdue ? "border-red-400/40" : "border-border/60"}`}
                      >
                        <p className="truncate text-[11px] text-muted-foreground">
                          {riskTitle(a.risk_id)}
                        </p>
                        <p className="mt-0.5 text-[13px] leading-snug text-foreground">{a.title}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${meta.bg} ${meta.text}`}
                          >
                            {meta.label}
                          </span>
                          {a.assignee && (
                            <span className="text-[10px] text-muted-foreground">{a.assignee}</span>
                          )}
                          {a.due_date && (
                            <span
                              className={`text-[10px] ${overdue ? "font-semibold text-red-300" : "text-muted-foreground"}`}
                            >
                              {overdue ? "overdue " : "due "}
                              {new Date(a.due_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {a.status === "closed" && a.verification_result && (
                          <p className="mt-1 text-[10px] text-emerald-300">
                            ✓ {a.verification_result}
                          </p>
                        )}
                        {a.status === "pending_verification" ? (
                          <VerifyInline onVerify={(result) => verify(a, result)} />
                        ) : (
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={colIdx === 0}
                                aria-label="Move back"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-30"
                                onClick={() => move(a, -1)}
                              >
                                <ArrowLeft className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={colIdx === COLUMNS.length - 1}
                                aria-label="Advance"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-30"
                                onClick={() => move(a, 1)}
                              >
                                <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <button
                              type="button"
                              aria-label="Delete action"
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => deleteAction.mutate(a.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddActionDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          risks={risks}
          onCreate={(a) => createAction.mutate(a)}
        />
      )}
    </div>
  );
}
