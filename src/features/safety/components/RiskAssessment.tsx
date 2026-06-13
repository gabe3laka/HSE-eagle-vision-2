import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import type { HazardType } from "@/lib/detection/types";
import {
  LIKELIHOOD_LABELS,
  RISK_LEVEL_META,
  SEVERITY_LABELS,
  riskLevel,
  type DerivedRisk,
} from "../lib/riskModel";
import { type RiskRow } from "../lib/safetyTypes";
import { RiskRegisterPanel } from "./RiskRegisterPanel";

interface PlotItem {
  id: string;
  label: string;
  hazardType: HazardType | null;
  likelihood: number;
  severity: number;
}

/**
 * Risk Assessment tab — a 5×5 likelihood × severity matrix (HSE workflow) that
 * plots the persisted risk register (or the incident-derived suggestions while
 * the register is still empty), with the editable register beneath it.
 */
export function RiskAssessment({ risks, derived }: { risks: RiskRow[]; derived: DerivedRisk[] }) {
  const usingRegister = risks.length > 0;
  const plotted: PlotItem[] = usingRegister
    ? risks.map((r) => ({
        id: r.id,
        label: r.title,
        hazardType: r.hazard_type,
        likelihood: r.likelihood,
        severity: r.severity,
      }))
    : derived.map((d) => ({
        id: d.id,
        label: d.label,
        hazardType: d.hazardType,
        likelihood: d.likelihood,
        severity: d.severity,
      }));

  const severities = [5, 4, 3, 2, 1];
  const likelihoods = [1, 2, 3, 4, 5];
  const byCell = new Map<string, PlotItem[]>();
  for (const p of plotted) {
    const key = `${p.likelihood}-${p.severity}`;
    byCell.set(key, [...(byCell.get(key) ?? []), p]);
  }

  return (
    <div className="space-y-5">
      <section className="console-panel p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold">Risk matrix</h2>
          <span className="text-[11px] text-muted-foreground">
            {usingRegister
              ? "Plotting risk register"
              : "Preview from incidents — add risks to pin them"}
          </span>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Likelihood × severity — score = likelihood × severity. Initial (inherent) risk is shown;
          add controls in the register to drive residual risk down.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-24" />
                {likelihoods.map((l) => (
                  <th key={l} className="text-center text-[10px] font-medium text-muted-foreground">
                    {l}
                    <span className="block font-normal">{LIKELIHOOD_LABELS[l - 1]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {severities.map((s) => (
                <tr key={s}>
                  <th className="pr-2 text-right align-middle text-[10px] font-medium text-muted-foreground">
                    {s}
                    <span className="block font-normal">{SEVERITY_LABELS[s - 1]}</span>
                  </th>
                  {likelihoods.map((l) => {
                    const score = l * s;
                    const meta = RISK_LEVEL_META[riskLevel(score)];
                    const here = byCell.get(`${l}-${s}`) ?? [];
                    return (
                      <td
                        key={l}
                        className={`relative h-14 rounded-md p-1 align-top ${meta.cell}`}
                        title={`Score ${score} — ${meta.label}`}
                      >
                        <span className="absolute right-1 top-0.5 text-[9px] font-bold opacity-70">
                          {score}
                        </span>
                        <div className="flex flex-wrap gap-0.5 pt-2">
                          {here.map((p) => {
                            const Icon = p.hazardType ? HAZARD_ICONS[p.hazardType] : null;
                            return (
                              <span
                                key={p.id}
                                title={p.label}
                                className="flex h-5 w-5 items-center justify-center rounded bg-black/30"
                              >
                                {Icon ? (
                                  <Icon className="h-3 w-3" />
                                ) : (
                                  <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
          {(["low", "medium", "high", "critical"] as const).map((lvl) => (
            <span key={lvl} className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-sm ${RISK_LEVEL_META[lvl].dot}`} />
              {RISK_LEVEL_META[lvl].label}
            </span>
          ))}
        </div>
      </section>

      <RiskRegisterPanel risks={risks} derived={derived} />
    </div>
  );
}
