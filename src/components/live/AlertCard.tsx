import { X } from "lucide-react";
import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { HAZARD_ICONS } from "./hazardIcons";
import { localizedMessage, isRTL } from "@/lib/detection/messages";
import type { Alert } from "@/lib/detection/types";

export function AlertCard({
  alert,
  language,
  onDismiss,
}: {
  alert: Alert;
  language: string;
  onDismiss?: (id: string) => void;
}) {
  const meta = HAZARDS[alert.hazardType];
  const sev = SEVERITY_META[alert.severity];
  const Icon = HAZARD_ICONS[alert.hazardType];
  const message = localizedMessage(alert.hazardType, language);
  const rtl = isRTL(language);

  return (
    <div
      className={`relative flex gap-3 rounded-xl border ${sev.border} ${sev.bg} p-3 shadow-[0_12px_36px_-24px_rgba(0,0,0,0.8)] backdrop-blur animate-slide-in-right`}
    >
      <div
        className={`mt-0.5 shrink-0 rounded-lg border border-white/[0.06] bg-black/20 p-2 ${sev.text}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wide ${sev.text}`}>
            {sev.label}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">{meta.label}</span>
        </div>
        <p
          dir={rtl ? "rtl" : "ltr"}
          className="mt-0.5 text-sm font-medium leading-snug text-foreground"
        >
          {message}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {new Date(alert.createdAt).toLocaleTimeString()} · {Math.round(alert.confidence * 100)}%
          {alert.zoneLabel ? ` · ${alert.zoneLabel}` : ""}
        </p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(alert.id)}
          className="absolute right-2 top-2 text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Dismiss alert"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
