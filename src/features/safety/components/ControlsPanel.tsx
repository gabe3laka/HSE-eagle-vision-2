import { HAZARD_ICONS } from "@/components/live/hazardIcons";
import { ALL_HAZARDS, HAZARDS } from "@/lib/detection/hazardCatalog";
import {
  CONTROL_LIBRARY,
  CONTROL_TYPE_META,
  CONTROL_TYPE_ORDER,
  type ControlType,
} from "../lib/controlLibrary";
import { type DerivedRisk } from "../lib/riskModel";
import type { HazardType } from "@/lib/detection/types";

/**
 * Hierarchy-of-controls reference (NIOSH order). Hazards that currently carry
 * risk are surfaced first; the rest of the catalogue follows so the full
 * control library is always available.
 */
export function ControlsPanel({ risks }: { risks: DerivedRisk[] }) {
  const ranked = risks.map((r) => r.hazardType);
  const orderedHazards: HazardType[] = [
    ...ranked,
    ...ALL_HAZARDS.filter((h) => !ranked.includes(h)),
  ];

  return (
    <div className="space-y-5">
      <section className="console-panel p-5">
        <h2 className="mb-1 font-display text-sm font-semibold">Hierarchy of controls</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Most effective first. Elimination, substitution and engineering controls reduce exposure
          without relying on behaviour — prefer them over administrative measures and PPE.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {CONTROL_TYPE_ORDER.map((t, i) => {
            const meta = CONTROL_TYPE_META[t];
            return (
              <div key={t} className={`rounded-xl p-3 ${meta.bg}`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${meta.text}`}>
                  {i + 1}. {meta.label}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{meta.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      {orderedHazards.map((h) => {
        const Icon = HAZARD_ICONS[h];
        const suggestions = [...CONTROL_LIBRARY[h]].sort(
          (a, b) => CONTROL_TYPE_META[a.type].rank - CONTROL_TYPE_META[b.type].rank,
        );
        const onlyLowOrder = suggestions.every(
          (s) => CONTROL_TYPE_META[s.type].rank >= 4, // administrative or PPE only
        );
        return (
          <section key={h} className="console-panel p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]">
                <Icon className="h-4 w-4 text-cyan-300" />
              </span>
              <h3 className="font-display text-sm font-semibold">{HAZARDS[h].label}</h3>
            </div>
            <ul className="space-y-1.5">
              {suggestions.map((s, idx) => {
                const meta = CONTROL_TYPE_META[s.type as ControlType];
                return (
                  <li key={idx} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={`w-28 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ${meta.bg} ${meta.text}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-foreground/90">{s.text}</span>
                  </li>
                );
              })}
            </ul>
            {onlyLowOrder && (
              <p className="mt-2 text-[11px] text-amber-300/90">
                ⚠ Only administrative / PPE controls listed — look for an engineering or elimination
                option where feasible.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
