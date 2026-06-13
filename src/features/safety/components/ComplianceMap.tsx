import { Check } from "lucide-react";
import {
  COMPLIANCE_STATUS_META,
  COMPLIANCE_STATUS_ORDER,
  ISO45001_ITEMS,
  type ComplianceStatus,
} from "../lib/iso45001";
import { useComplianceItems, useUpsertCompliance } from "../hooks/useSafety";

/**
 * ISO 45001 compliance map (clauses 4–10). Status persists per owner. Organises
 * evidence against the OH&S management-system clauses — it does not certify.
 */
export function ComplianceMap() {
  const { data: rows = [] } = useComplianceItems();
  const upsert = useUpsertCompliance();

  const statusOf = (clause: string, title: string): ComplianceStatus =>
    rows.find((r) => r.clause === clause && r.title === title)?.status ?? "not_started";

  const met = ISO45001_ITEMS.filter((it) => statusOf(it.clause, it.title) === "met").length;
  const pct = Math.round((met / ISO45001_ITEMS.length) * 100);

  const areas: string[] = [];
  for (const it of ISO45001_ITEMS) if (!areas.includes(it.area)) areas.push(it.area);

  return (
    <div className="space-y-5">
      <section className="console-panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold">ISO 45001 readiness</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Organise evidence against the OH&S management-system clauses. Certification is
              optional — this tracks readiness, it does not certify.
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-bold">{pct}%</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {met}/{ISO45001_ITEMS.length} met
            </p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/50">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      {areas.map((area) => (
        <section key={area} className="console-panel p-5">
          <h3 className="mb-3 font-display text-sm font-semibold">{area}</h3>
          <ul className="space-y-2.5">
            {ISO45001_ITEMS.filter((it) => it.area === area).map((item) => {
              const current = statusOf(item.clause, item.title);
              return (
                <li
                  key={`${item.clause}-${item.title}`}
                  className="flex flex-col gap-2 border-b border-border/40 pb-2.5 last:border-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {item.clause}
                      </span>
                      <span className="text-sm font-medium">{item.title}</span>
                      {item.appSupported && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[9px] font-semibold text-cyan-300">
                          <Check className="h-2.5 w-2.5" /> in-app
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Evidence: {item.evidence}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {COMPLIANCE_STATUS_ORDER.map((st) => {
                      const meta = COMPLIANCE_STATUS_META[st];
                      const active = current === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            upsert.mutate({
                              clause: item.clause,
                              title: item.title,
                              status: st,
                              reviewed_at: new Date().toISOString(),
                            })
                          }
                          className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                            active
                              ? `${meta.bg} ${meta.text} ring-1 ring-current`
                              : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.07]"
                          }`}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
