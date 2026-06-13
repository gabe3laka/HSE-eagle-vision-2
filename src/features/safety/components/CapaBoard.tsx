import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { EmptyState } from "@/components/EmptyState";
import { ClipboardCheck } from "lucide-react";
import { CONTROL_LIBRARY, CONTROL_TYPE_META, type ControlType } from "../lib/controlLibrary";
import { type DerivedRisk } from "../lib/riskModel";
import type { HazardType } from "@/lib/detection/types";

/**
 * Corrective-action (CAPA) board. Phase 0 seeds suggested actions from the
 * highest control in the hierarchy for each High/Critical risk; status changes
 * are session-local (a working preview). Persistence + owners/due dates arrive
 * when the actions table is connected.
 */

type ActionStatus = "open" | "in_progress" | "pending_verification" | "closed";

const COLUMNS: { key: ActionStatus; label: string; accent: string }[] = [
  { key: "open", label: "Open", accent: "text-cyan-300" },
  { key: "in_progress", label: "In progress", accent: "text-amber-300" },
  { key: "pending_verification", label: "Pending verification", accent: "text-violet-300" },
  { key: "closed", label: "Closed", accent: "text-emerald-300" },
];
const STATUS_KEYS = COLUMNS.map((c) => c.key);

interface SuggestedAction {
  id: string;
  riskLabel: string;
  hazardType: HazardType;
  controlType: ControlType;
  text: string;
}

function buildActions(risks: DerivedRisk[]): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  for (const r of risks.filter((x) => x.level === "high" || x.level === "critical")) {
    const top = [...(CONTROL_LIBRARY[r.hazardType] ?? [])]
      .sort((a, b) => CONTROL_TYPE_META[a.type].rank - CONTROL_TYPE_META[b.type].rank)
      .slice(0, 2);
    top.forEach((c, i) =>
      actions.push({
        id: `${r.id}-${i}`,
        riskLabel: r.label,
        hazardType: r.hazardType,
        controlType: c.type,
        text: c.text,
      }),
    );
  }
  return actions;
}

export function CapaBoard({ risks }: { risks: DerivedRisk[] }) {
  const actions = useMemo(() => buildActions(risks), [risks]);
  const [statuses, setStatuses] = useState<Record<string, ActionStatus>>({});
  const statusOf = (id: string): ActionStatus => statuses[id] ?? "open";

  const move = (id: string, dir: -1 | 1) => {
    const idx = STATUS_KEYS.indexOf(statusOf(id));
    const next = Math.max(0, Math.min(STATUS_KEYS.length - 1, idx + dir));
    setStatuses((s) => ({ ...s, [id]: STATUS_KEYS[next] }));
  };

  if (actions.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No corrective actions needed"
        description="When a hazard reaches High or Critical risk, suggested controls appear here as a corrective-action plan."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Suggested controls for High/Critical risks, ranked by the hierarchy of controls. Move cards
        across the board to track progress — changes are session-local in this preview.
      </p>
      <div className="grid gap-3 lg:grid-cols-4">
        {COLUMNS.map((col, colIdx) => {
          const items = actions.filter((a) => statusOf(a.id) === col.key);
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
                  const Icon = HAZARD_ICONS[a.hazardType];
                  const meta = CONTROL_TYPE_META[a.controlType];
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg border border-border/60 bg-background/40 p-2.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-[11px] text-muted-foreground">
                          {a.riskLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-snug text-foreground">{a.text}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${meta.bg} ${meta.text}`}
                        >
                          {meta.label}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={colIdx === 0}
                            aria-label="Move back"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-30"
                            onClick={() => move(a.id, -1)}
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={colIdx === COLUMNS.length - 1}
                            aria-label="Advance"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-30"
                            onClick={() => move(a.id, 1)}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
