import { BellRing, ShieldCheck } from "lucide-react";
import { AlertCard } from "./AlertCard";
import type { Alert } from "@/lib/detection/types";

interface Props {
  alerts: Alert[];
  running: boolean;
  language: string;
  onDismiss: (id: string) => void;
}

/** The slide-in side feed of live safety notifications. */
export function AlertFeed({ alerts, running, language, onDismiss }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2 border-b border-white/5 pb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-200">
          <BellRing className="h-4 w-4" />
        </span>
        <div>
          <p className="console-eyebrow">Safety feed</p>
          <h2 className="font-display text-sm font-semibold">Live alerts</h2>
        </div>
        {alerts.length > 0 && (
          <span className="ml-auto rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-300/10">
            {alerts.length}
          </span>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {alerts.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300/10 bg-emerald-400/[0.025] p-6 text-center">
            <ShieldCheck className="mb-2 h-8 w-8 text-emerald-300/45" />
            <p className="text-sm text-muted-foreground">
              {running
                ? "All clear — no hazards detected."
                : "Start monitoring to see live safety alerts here."}
            </p>
          </div>
        ) : (
          alerts.map((a) => (
            <AlertCard key={a.id} alert={a} language={language} onDismiss={onDismiss} />
          ))
        )}
      </div>
    </div>
  );
}
