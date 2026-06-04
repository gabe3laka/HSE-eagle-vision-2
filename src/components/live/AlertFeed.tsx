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
      <div className="mb-3 flex items-center gap-2">
        <BellRing className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-semibold">Live alerts</h2>
        {alerts.length > 0 && (
          <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {alerts.length}
          </span>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {alerts.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-6 text-center">
            <ShieldCheck className="mb-2 h-8 w-8 text-muted-foreground/40" />
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
