import { CheckCircle2, ShieldCheck } from "lucide-react";

/**
 * Plan console — "SAFETY NOTES" panel (mockup): a green-check bullet list. The
 * notes are derived upstream (derivePlanSafetyNotes) from the active step plus
 * sensible defaults. PURE presentation.
 */
export function PlanSafetyNotes({ notes, className }: { notes: string[]; className?: string }) {
  if (notes.length === 0) return null;
  return (
    <div className={`console-panel p-3 ${className ?? ""}`}>
      <p className="console-eyebrow flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
        Safety notes
      </p>
      <ul className="mt-2 space-y-1.5">
        {notes.map((note, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[11px] leading-snug text-foreground/90"
          >
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
