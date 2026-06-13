import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { EmptyState } from "@/components/EmptyState";
import { ShieldCheck } from "lucide-react";
import {
  LIKELIHOOD_LABELS,
  RISK_LEVEL_META,
  SEVERITY_LABELS,
  riskLevel,
  type DerivedRisk,
} from "../lib/riskModel";

/**
 * Risk Assessment tab — a 5×5 likelihood × severity matrix (HSE workflow) with
 * each derived hazard plotted in its cell, plus the read-only risk register
 * beneath it. Phase 0: everything is computed from incident history.
 */
export function RiskAssessment({ risks }: { risks: DerivedRisk[] }) {
  // Severity rows are listed 5 (top) → 1 (bottom); likelihood columns 1 → 5.
  const severities = [5, 4, 3, 2, 1];
  const likelihoods = [1, 2, 3, 4, 5];
  const byCell = new Map<string, DerivedRisk[]>();
  for (const r of risks) {
    const key = `${r.likelihood}-${r.severity}`;
    byCell.set(key, [...(byCell.get(key) ?? []), r]);
  }

  return (
    <div className="space-y-5">
      <section className="console-panel p-5">
        <h2 className="mb-1 font-display text-sm font-semibold">Risk matrix</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Likelihood × severity. Each hazard is plotted from its recent incident frequency and worst
          observed severity — score = likelihood × severity.
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
                        className={`h-14 rounded-md align-top ${meta.cell} relative p-1`}
                        title={`Score ${score} — ${meta.label}`}
                      >
                        <span className="absolute right-1 top-0.5 text-[9px] font-bold opacity-70">
                          {score}
                        </span>
                        <div className="flex flex-wrap gap-0.5 pt-2">
                          {here.map((r) => {
                            const Icon = HAZARD_ICONS[r.hazardType];
                            return (
                              <span
                                key={r.id}
                                title={r.label}
                                className="flex h-5 w-5 items-center justify-center rounded bg-black/30"
                              >
                                <Icon className="h-3 w-3" />
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

      <section className="console-panel p-5">
        <h2 className="mb-1 font-display text-sm font-semibold">Risk register</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          One record per recurring hazard, derived from incidents. Persistent, editable records
          (owner, due date, residual risk) arrive when the register is connected to the database.
        </p>
        {risks.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No risks to assess yet"
            description="Once monitoring records hazards, each recurring hazard becomes a scored risk record here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 pr-3 font-medium">Hazard</th>
                  <th className="py-2 pr-3 font-medium">Zones</th>
                  <th className="py-2 pr-3 text-center font-medium">L</th>
                  <th className="py-2 pr-3 text-center font-medium">S</th>
                  <th className="py-2 pr-3 text-center font-medium">Score</th>
                  <th className="py-2 pr-3 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => {
                  const Icon = HAZARD_ICONS[r.hazardType];
                  const meta = RISK_LEVEL_META[r.level];
                  return (
                    <tr key={r.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground">{r.label}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {r.zones.length ? r.zones.join(", ") : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-center">{r.likelihood}</td>
                      <td className="py-2.5 pr-3 text-center">{r.severity}</td>
                      <td className="py-2.5 pr-3 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.bg} ${meta.text}`}
                        >
                          {r.score} {meta.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {r.lastSeen ? new Date(r.lastSeen).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
