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

  // Outer viewport is bounded (mobile: max height; desktop: aspect-video).
  // We measure its REAL pixel size and then size the inner media layer to a
  // contain-fit rect so the visible video + overlays never overflow.
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

  const aspect = videoSize.w > 0 && videoSize.h > 0 ? videoSize.w / videoSize.h : 16 / 9;
  const rect = computeContainRect(container.w, container.h, aspect);
  const mediaW = Math.max(0, Math.floor(rect.width));
  const mediaH = Math.max(0, Math.floor(rect.height));

  const innerStyle: React.CSSProperties = {
    position: "relative",
    width: mediaW || undefined,
    height: mediaH || undefined,
    maxWidth: "100%",
    maxHeight: "100%",
  };

  const mirror = facing === "user";

  // Re-measure when the video stream becomes active so the inner layer sizes
  // correctly even if metadata fired before mount.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    }
  }, [active, videoRef]);

  const showDebug = import.meta.env.DEV;

  return (
    <div
      ref={containerRef}
      className={
        "relative -mx-3 flex aspect-[3/4] max-h-[calc(100svh-220px)] w-[calc(100%+1.5rem)] items-center justify-center overflow-hidden border border-border bg-black sm:mx-0 sm:aspect-video sm:max-h-none sm:w-full sm:rounded-2xl"
      }
    >
      {/* Inner media layer — measured contain-fit rect, no transform. */}
      <div style={innerStyle}>
        {/* Mirror layer — applies front-camera flip to video + overlays at once. */}
        <div
          className={`absolute inset-0 ${mirror ? "scale-x-[-1]" : ""}`}
          style={{ transformOrigin: "center" }}
        >
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
      </div>

      {/* Chips and banners on the OUTER viewport — stay anchored regardless of letterboxing. */}
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
          outer {Math.round(container.w)}×{Math.round(container.h)}
          <br />
          inner {mediaW}×{mediaH}
          <br />
          video {videoSize.w}×{videoSize.h}
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
  );
}
