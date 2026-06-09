import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetectionOverlay } from "./DetectionOverlay";
import { BackendEntityOverlay } from "./BackendEntityOverlay";
import { BackendPoseOverlay } from "./BackendPoseOverlay";
import type { Alert, LiveBox, BackendEntity, BackendPose } from "@/lib/detection/types";
import { SEVERITY_META, HAZARDS } from "@/lib/detection/hazardCatalog";
import { localizedMessage, isRTL } from "@/lib/detection/messages";
import { HAZARD_ICONS } from "./hazardIcons";
import type { CameraFacing } from "@/hooks/useCamera";
import { SkeletonOverlay } from "./SkeletonOverlay";
import { ZoneOverlay } from "./ZoneOverlay";
import type { PoseDebug, PoseStatus } from "@/lib/detection/poseGeometry";
import type { DetectionZone, ZonePoint } from "@/lib/detection/types";
import { useIsMobile } from "@/hooks/use-mobile";

const POSE_STATUS_LABEL: Record<PoseStatus, string> = {
  loading: "Loading pose model",
  ready: "Pose model ready",
  scanning: "Scanning video",
  no_stable_person: "No stable person detected",
  low_confidence: "Low confidence — improve lighting / show full body",
  person_detected: "Person detected",
};

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
  poseStatus?: PoseStatus | null;
  debug?: PoseDebug | null;
  showSkeleton?: boolean;
  backendEntities?: BackendEntity[];
  backendPoses?: BackendPose[];
  backendDryRun?: boolean;
  zones?: DetectionZone[];
  editingZones?: boolean;
  onZoneCreate?: (points: ZonePoint[]) => void;
}

/**
 * Contain-fit rectangle: returns the largest width×height that preserves
 * `videoAspect` AND fits entirely inside the container. Mirrors CSS
 * `object-fit: contain` — letterboxes with empty space when aspects differ.
 */
export function computeContainRect(cw: number, ch: number, va: number) {
  if (cw <= 0 || ch <= 0 || !Number.isFinite(va) || va <= 0) {
    return { width: cw, height: ch };
  }
  const ca = cw / ch;
  if (ca > va) {
    const height = ch;
    return { width: height * va, height };
  }
  const width = cw;
  return { width, height: width / va };
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
  poseStatus,
  debug,
  showSkeleton,
  backendEntities,
  backendPoses,
  backendDryRun,
  zones,
  editingZones,
  onZoneCreate,
}: Props) {
  const TopIcon = topAlert ? HAZARD_ICONS[topAlert.hazardType] : null;
  const topSev = topAlert ? SEVERITY_META[topAlert.severity] : null;

  // Measurement wrapper (full-bleed on mobile) provides the available width/
  // height for the contain-fit calc. The visible black SHELL then shrink-wraps
  // to the fitted media rectangle so there are no side letterbox bars.
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainer({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-grab metadata in case it fired before mount.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    }
  }, [active, videoRef]);

  const isMobile = useIsMobile();
  const haveAspect = videoSize.w > 0 && videoSize.h > 0;
  const aspect = haveAspect ? videoSize.w / videoSize.h : 16 / 9;

  // Shrink-wrap the shell to the real video aspect on every breakpoint so a
  // portrait camera stream never gets pillarboxed inside a forced landscape
  // shell (the black-side-bars bug). Mobile reserves more chrome height than
  // desktop.
  const reservedH = isMobile ? 260 : 180;
  const viewportAvailH =
    typeof window !== "undefined" ? Math.max(0, window.innerHeight - reservedH) : container.h;
  const availH = container.h > 0 ? Math.min(container.h, viewportAvailH) : viewportAvailH;
  const rect = computeContainRect(container.w || 0, availH || 0, aspect);
  const shellW = Math.max(0, Math.floor(rect.width));
  const shellH = Math.max(0, Math.floor(rect.height));

  const shellStyle: React.CSSProperties | undefined =
    haveAspect && shellW > 0 && shellH > 0
      ? {
          width: `${shellW}px`,
          height: `${shellH}px`,
          maxWidth: "100%",
          maxHeight: `calc(100svh - ${reservedH}px)`,
        }
      : undefined;

  const showDebug = import.meta.env.DEV;

  // Shell classes:
  //  - haveAspect: shrink-wrapped via inline style; just visuals here.
  //  - Fallback (pre-stream): portrait 3/4 on mobile, landscape aspect-video
  //    on desktop so the "Enable camera" empty state renders nicely.
  const shellClass = haveAspect
    ? "relative overflow-hidden border border-border bg-black sm:rounded-2xl"
    : "relative aspect-[3/4] w-full max-h-[calc(100svh-260px)] overflow-hidden border border-border bg-black sm:aspect-video sm:max-h-none sm:w-full sm:rounded-2xl";


  return (
    <div
      ref={containerRef}
      className="-mx-3 flex w-[calc(100%+1.5rem)] justify-center sm:mx-0 sm:w-full"
    >
    <div style={shellStyle} className={shellClass}>
      {/* Orientation layer — the video and ALL overlays share this single layer
          so boxes/poses/zones stay aligned to the visible video. The front/
          selfie camera is intentionally NOT mirrored: a mirrored preview makes
          real-world text, signs and labels read backwards, which matters more
          for a safety camera than a natural selfie. The capture canvas also
          sees the un-mirrored frame, so overlays stay aligned. */}
      <div className="absolute inset-0">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0 && v.videoHeight > 0) {
                setVideoSize({ w: v.videoWidth, h: v.videoHeight });
              }
            }}
            className={`h-full w-full object-contain transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
          />

          {active && (
            <ZoneOverlay
              zones={zones ?? []}
              editing={!!editingZones}
              onCreate={onZoneCreate ?? (() => undefined)}
            />
          )}

          {active && running && <DetectionOverlay boxes={boxes} />}

          {active && running && backendDryRun && (
            <>
              <BackendEntityOverlay entities={backendEntities ?? []} />
              <BackendPoseOverlay poses={backendPoses ?? []} />
            </>
          )}

          {active && running && showSkeleton && debug && <SkeletonOverlay debug={debug} />}

          {active && running && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 animate-scan bg-gradient-to-r from-transparent via-primary to-transparent" />
          )}
      </div>

      {/* Chips and banners anchored to the SHELL (which IS the visible video rect on mobile). */}
      {active && (
        <Button
          onClick={onFlip}
          variant="glass"
          size="icon"
          className="absolute bottom-24 right-4 z-30 h-12 w-12 rounded-full shadow-xl sm:bottom-auto sm:top-3 sm:h-9 sm:w-9"
          aria-label="Flip camera"
        >
          <SwitchCamera className="h-5 w-5 sm:h-4 sm:w-4" />
        </Button>
      )}

      {active && running && backendDryRun && (
        <div className="pointer-events-none absolute right-3 top-12 z-20 flex flex-col items-end gap-1">
          <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-teal-300 backdrop-blur">
            EdgeCrafter entities: {backendEntities?.length ?? 0}
          </span>
          <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-fuchsia-300 backdrop-blur">
            EdgeCrafter poses: {backendPoses?.length ?? 0}
          </span>
        </div>
      )}

      {active && running && poseStatus && (
        <div className="pointer-events-none absolute left-3 top-12 z-20 max-w-[80%] rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
          {topAlert ? "Hazard detected" : POSE_STATUS_LABEL[poseStatus]}
        </div>
      )}

      {active && (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-red-500" : "bg-muted-foreground"}`}
          />
          {running ? "Monitoring" : "Paused"}
        </div>
      )}

      {showDebug && active && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-30 rounded bg-black/60 px-2 py-1 font-mono text-[10px] leading-tight text-white/80">
          measure {Math.round(container.w)}×{Math.round(container.h)}
          <br />
          shell {shellW}×{shellH}
          <br />
          video {videoSize.w}×{videoSize.h}
          <br />
          mirror off · facing {facing}
        </div>
      )}

      {active && running && topAlert && TopIcon && topSev && (
        <div
          className={`absolute inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-xl border ${topSev.border} bg-black/70 px-4 py-3 text-white shadow-2xl backdrop-blur animate-slide-in-right`}
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
          <div className="rounded-2xl bg-primary/10 p-5">
            {error ? (
              <CameraOff className="h-10 w-10 text-destructive" />
            ) : (
              <Camera className="h-10 w-10 text-primary" />
            )}
          </div>
          {error ? (
            <>
              <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
              <Button onClick={onEnable} variant="secondary" size="lg">
                Try again
              </Button>
            </>
          ) : (
            <>
              <div>
                <p className="font-display text-lg font-semibold sm:text-xl">
                  Use this phone as a safety camera
                </p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Point the rear camera at the work area. SafeLens watches for hazards and alerts
                  you the moment one appears.
                </p>
              </div>
              <Button onClick={onEnable} disabled={starting} size="lg" className="min-w-[180px]">
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
    </div>
  );
}
