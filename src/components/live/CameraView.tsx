import { Camera, CameraOff, Loader2, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetectionOverlay } from "./DetectionOverlay";
import type { Alert, LiveBox } from "@/lib/detection/types";
import { SEVERITY_META, HAZARDS } from "@/lib/detection/hazardCatalog";
import { localizedMessage, isRTL } from "@/lib/detection/messages";
import { HAZARD_ICONS } from "./hazardIcons";
import type { CameraFacing } from "@/hooks/useCamera";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
  starting: boolean;
  error: string | null;
  boxes: LiveBox[];
  running: boolean;
  topAlert: Alert | null;
  language: string;
  facing: CameraFacing;
  onEnable: () => void;
  onFlip: () => void;
}

export function CameraView({
  videoRef,
  active,
  starting,
  error,
  boxes,
  running,
  topAlert,
  language,
  facing,
  onEnable,
  onFlip,
}: Props) {
  const TopIcon = topAlert ? HAZARD_ICONS[topAlert.hazardType] : null;
  const topSev = topAlert ? SEVERITY_META[topAlert.severity] : null;

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-black sm:aspect-video">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`h-full w-full object-cover transition-opacity ${active ? "opacity-100" : "opacity-0"} ${facing === "user" ? "scale-x-[-1]" : ""}`}
      />

      {active && (
        <Button
          onClick={onFlip}
          variant="glass"
          size="icon"
          className="absolute right-3 top-3 h-9 w-9 rounded-full"
          aria-label="Flip camera"
        >
          <SwitchCamera className="h-4 w-4" />
        </Button>
      )}


      {active && running && <DetectionOverlay boxes={boxes} />}

      {active && running && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 animate-scan bg-gradient-to-r from-transparent via-primary to-transparent" />
      )}

      {active && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-red-500" : "bg-muted-foreground"}`}
          />
          {running ? "Monitoring" : "Paused"}
        </div>
      )}

      {/* prominent banner for the latest high/critical hazard */}
      {active && running && topAlert && TopIcon && topSev && (
        <div
          className={`absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-xl border ${topSev.border} bg-black/70 px-4 py-3 text-white shadow-2xl backdrop-blur animate-slide-in-right`}
        >
          <div className={`rounded-lg bg-white/10 p-2 ${topSev.text}`}>
            <TopIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className={`text-xs font-bold uppercase tracking-wide ${topSev.text}`}>
              {topSev.label} · {HAZARDS[topAlert.hazardType].label}
            </p>
            <p dir={isRTL(language) ? "rtl" : "ltr"} className="truncate text-sm font-medium">
              {localizedMessage(topAlert.hazardType, language)}
            </p>
          </div>
        </div>
      )}

      {!active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="rounded-2xl bg-primary/10 p-4">
            {error ? (
              <CameraOff className="h-8 w-8 text-destructive" />
            ) : (
              <Camera className="h-8 w-8 text-primary" />
            )}
          </div>
          {error ? (
            <>
              <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
              <Button onClick={onEnable} variant="secondary">
                Try again
              </Button>
            </>
          ) : (
            <>
              <div>
                <p className="font-display text-lg font-semibold">
                  Use this phone as a safety camera
                </p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Point the rear camera at the work area. SafeLens watches for hazards and alerts
                  you the moment one appears.
                </p>
              </div>
              <Button onClick={onEnable} disabled={starting} size="lg">
                {starting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="mr-2 h-4 w-4" />
                )}
                Enable camera
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
