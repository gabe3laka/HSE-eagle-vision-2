import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Hammer, ShieldCheck, Shapes, Trash2 } from "lucide-react";
import { useCamera } from "@/hooks/useCamera";
import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useDetectionSession } from "@/hooks/useDetectionSession";
import type { PerfMetrics, SessionStats } from "@/hooks/useDetectionSession";
import { useZones, useCreateZone, useDeleteZone } from "@/hooks/useZones";
import { CameraView } from "@/components/live/CameraView";
import { AlertFeed } from "@/components/live/AlertFeed";
import { SessionControls } from "@/components/live/SessionControls";
import { PoseDebugPanel } from "@/components/live/PoseDebugPanel";
import type { BackendStatus } from "@/lib/detection/backendVisionDetector";
import {
  postDetectFrame,
  captureVideoFrameBase64,
} from "@/lib/detection/backendVisionHttpDetector";
import { isMobileViewport, MOBILE_VISUAL_ASPECT } from "@/lib/detection/coverCrop";
import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/own-client";
import { BUILD_MARKER, buildTime } from "@/lib/buildInfo";
import { ENABLE_BUILD_MODE } from "@/features/build-mode/config";
import { useBuildModeSession } from "@/features/build-mode/hooks/useBuildModeSession";
import { useBlueprintReplay } from "@/features/build-mode/hooks/useBlueprintReplay";
import { useBuildHandTracking } from "@/features/build-mode/hooks/useBuildHandTracking";
import { BuildModePanel } from "@/features/build-mode/components/BuildModePanel";
import type { HandControlStatus } from "@/features/build-mode/components/BuildModePanel";
import { SelectionOverlay } from "@/features/build-mode/components/SelectionOverlay";
import { FloatingBlueprintLayer } from "@/features/build-mode/components/FloatingBlueprintLayer";
import { HandPointerLayer } from "@/features/build-mode/components/HandPointerLayer";
import type { BuildHandInteraction, BuildHandLandmark } from "@/features/build-mode/types";

/** Readout of the EdgeCrafter backend — fast Cloudflare HTTP, legacy HTTP dry-run, or WebSocket stream. */
function BackendDebugPanel({
  status,
  entities,
  poses,
  perf,
  stats,
}: {
  status: BackendStatus;
  entities: BackendEntity[];
  poses: BackendPose[];
  perf: PerfMetrics;
  stats: SessionStats;
}) {
  const firstEntity = entities[0];
  const firstPose = poses[0];
  const isStream = status.transport === "ws";
  const isCloudflare = status.transport === "http-cloudflare";
  const fmt = (v?: number | null) => (v != null ? `${v}` : "—");
  const ms = (v?: number | null) => (v != null ? `${Math.round(v)} ms` : "—");
  const transportLabel = isStream
    ? "WebSocket stream (beta)"
    : isCloudflare
      ? "http-cloudflare"
      : "HTTP dry-run";
  const detectorName = isStream
    ? "BackendVisionStreamDetector"
    : isCloudflare
      ? "BackendVisionHttpDetector"
      : "BackendVisionDetector";
  const modeName = isStream
    ? "backend-edgecrafter-stream"
    : isCloudflare
      ? "backend-edgecrafter-http"
      : "backend-deimv2";
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">
          backend · {isStream ? (status.streamState ?? status.state) : status.state}
        </span>
        <span className={status.inFlight ? "text-amber-500" : "text-muted-foreground"}>
          {status.inFlight ? "in-flight" : "idle"} · {status.entityCount} ent · {status.poseCount}{" "}
          pose
        </span>
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          transport: <span className="text-foreground">{transportLabel}</span>
        </div>
        <div>
          backend: {status.backend ?? "—"} · tasks: {status.tasks?.join(",") ?? "—"}
        </div>
        <div>
          detector: {detectorName} · mode {modeName}
        </div>
        <div>
          sched: <span className="text-foreground">{perf.mode}</span> · processed: {perf.fps}/s ·
          frames: {stats.frames} · stale: {perf.staleFrames} · skipped: {perf.skippedFrames}
        </div>
        {isStream && (
          <>
            <div>
              frames sent: {status.requestCount} · vision msgs: {status.responseCount} · dropped:{" "}
              {fmt(status.droppedFrames)} · queue: {fmt(status.currentQueueDepth)}
            </div>
            <div>
              received: {fmt(status.receivedFps)} fps · processed: {fmt(status.processedFps)} fps
            </div>
            <div>
              avg inference: {ms(status.lastInferenceMs)} · avg latency:{" "}
              {status.avgEndToEndLatencyMs != null ? `${status.avgEndToEndLatencyMs} ms` : "—"}
            </div>
          </>
        )}
        {isCloudflare && (
          <>
            <div>
              target: {fmt(status.targetFps)} fps · requests: {status.requestCount} · responses:{" "}
              {status.responseCount}
            </div>
            <div>
              video: {status.videoWidth}×{status.videoHeight} · capture: {fmt(status.lastCaptureW)}×
              {fmt(status.lastCaptureH)} · backend img: {fmt(status.lastBackendImgW)}×
              {fmt(status.lastBackendImgH)}
            </div>
            <div>jpeg b64: {status.lastB64Bytes} B</div>
            <div>
              latency: {ms(status.lastLatencyMs)} (round-trip) · inference:{" "}
              {ms(status.lastInferenceMs)}
            </div>
          </>
        )}
        {!isStream && !isCloudflare && (
          <>
            <div>
              requests: {status.requestCount} · responses: {status.responseCount}
            </div>
            <div>
              video: {status.videoWidth}×{status.videoHeight} · jpeg b64: {status.lastB64Bytes} B
            </div>
            <div>last inference: {ms(status.lastInferenceMs)}</div>
          </>
        )}
        <div>model: {status.model ?? "—"}</div>
        <div>
          last success:{" "}
          {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleTimeString() : "—"}
        </div>
        {firstEntity && (
          <div className="text-teal-500">
            ent#0 {firstEntity.label} {Math.round(firstEntity.confidence * 100)}% · x
            {firstEntity.bbox.x.toFixed(2)} y{firstEntity.bbox.y.toFixed(2)} w
            {firstEntity.bbox.w.toFixed(2)} h{firstEntity.bbox.h.toFixed(2)}
          </div>
        )}
        {firstPose && (
          <div className="text-fuchsia-500">
            pose#0 {Math.round(firstPose.confidence * 100)}% · {firstPose.keypoints.length} kpts
          </div>
        )}
        {status.error && <div className="text-red-500">error: {status.error}</div>}
        {status.lastRawResponse && (
          <div className="truncate" title={status.lastRawResponse}>
            raw: {status.lastRawResponse}
          </div>
        )}
      </div>
      {/* Transport note. */}
      {isStream && (
        <div className="mt-2 border-t border-border/60 pt-2 text-[10px] not-italic text-muted-foreground">
          <span className="font-semibold text-foreground">WebSocket stream (beta).</span>{" "}
          Authenticated with a short-lived Supabase-issued session token (<code>?token=</code>); the
          gateway URL comes from the session (override with{" "}
          <code>VITE_EDGECRAFT_STREAM_WS_URL</code>). The browser never holds the RunPod API key or
          the signing secret.
        </div>
      )}
      {isCloudflare && (
        <div className="mt-2 border-t border-border/60 pt-2 text-[10px] not-italic text-muted-foreground">
          <span className="font-semibold text-foreground">Fast HTTP dry-run.</span> Frames POST
          directly to the Cloudflare <code>/detect</code> Worker, which holds the RunPod API key and
          forwards to the worker. Authenticated with a short-lived Supabase session token (
          <code>?token=</code>, reused from <code>create-stream-session</code>). One request in
          flight, newest frame only — no alerts, no incidents.
        </div>
      )}
      {!isStream && !isCloudflare && (
        <div className="mt-2 border-t border-border/60 pt-2 text-[10px] not-italic text-muted-foreground">
          <span className="font-semibold text-foreground">HTTP dry-run mode.</span> Frames go to the
          worker over HTTP via the Supabase <code>deimv2-proxy</code> (legacy path).
        </div>
      )}
    </div>
  );
}

export default function Live() {
  const { videoRef, active, starting, error, facing, start: startCamera, flip } = useCamera();
  const { config } = useAlertSettings();
  const queryClient = useQueryClient();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [editingZones, setEditingZones] = useState(false);
  const { data: zones = [] } = useZones();
  const createZone = useCreateZone();
  const deleteZone = useDeleteZone();
  const [backendTest, setBackendTest] = useState<string | null>(null);
  const [backendTestImg, setBackendTestImg] = useState<string | null>(null);
  const [backendTesting, setBackendTesting] = useState(false);

  // App workflow: HSE monitoring (existing) | Build Mode (blueprint capture).
  // Build Mode keeps the live camera + HSE loop running but suppresses incident
  // persistence — it's an additive workflow, not a detector change.
  const [appMode, setAppMode] = useState<"hse" | "build">("hse");
  const buildModeOn = ENABLE_BUILD_MODE && appMode === "build";

  const onIncidentSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
  }, [queryClient]);

  const {
    running,
    alerts,
    liveBoxes,
    stats,
    debug,
    perf,
    poseStatus,
    backendStatus,
    backendEntities,
    backendPoses,
    start,
    stop,
    dismissAlert,
  } = useDetectionSession({
    videoRef,
    config,
    zones,
    onIncidentSaved,
    suppressIncidents: buildModeOn,
  });

  // Hand tracking adapter: reuses the SAME tracking stream HSE already surfaces
  // (backend pose wrists first, local pose-debug wrists as fallback). Wrist-only
  // for MVP — true finger pinch needs a future MediaPipe Hands adapter.
  const hand = useBuildHandTracking({
    enabled: buildModeOn,
    backendPoses: backendPoses as BackendPose[],
    poseDebug: debug,
    running,
  });
  const handLandmarksRef = useRef<BuildHandLandmark[]>([]);
  handLandmarksRef.current = hand.handLandmarks;
  const getHandLandmarks = useCallback(() => handLandmarksRef.current, []);
  // Grab/drag state reported up by the floating blueprint (it owns its bounds).
  const [handLayerMode, setHandLayerMode] = useState<BuildHandInteraction["mode"]>("idle");
  const onHandInteraction = useCallback((i: BuildHandInteraction) => setHandLayerMode(i.mode), []);

  const build = useBuildModeSession({
    videoRef,
    enabled: buildModeOn,
    cameraFacing: facing,
    getHandLandmarks,
  });
  const replay = useBlueprintReplay(build.phase === "review" ? build.frames : []);
  // Ghost shown on the floating layer: live latest frame while recording,
  // replay playhead frame in review.
  const ghostFrame =
    build.phase === "review" ? (replay.currentFrame ?? build.latestFrame) : build.latestFrame;

  // Status chip: dragging > tracking > waiting (loop running, no wrist yet) >
  // touch fallback (no tracking stream at all — monitoring not started).
  const handStatus: HandControlStatus | undefined = buildModeOn
    ? handLayerMode === "grab" || handLayerMode === "dragging"
      ? "dragging"
      : hand.primaryPointer
        ? "tracking"
        : running
          ? "waiting"
          : "touch-fallback"
    : undefined;

  const topAlert = useMemo(() => alerts.find((a) => a.isIncident) ?? null, [alerts]);

  // All EdgeCrafter modes share the same dry-run overlays + debug panel. The
  // single-frame test button is for the HTTP modes (fast Cloudflare /detect, or
  // the legacy Supabase-proxy path).
  const isCloudflareHttp = config.detectionMode === "backend-edgecrafter-http";
  const isLegacyHttp = config.detectionMode === "backend-deimv2";
  const isBackendMode =
    isCloudflareHttp || isLegacyHttp || config.detectionMode === "backend-edgecrafter-stream";
  const showFrameTest = isCloudflareHttp || isLegacyHttp;

  const handleStart = useCallback(async () => {
    if (!active) await startCamera();
    await start();
  }, [active, startCamera, start]);

  // Dev/debug: capture the current frame and send one request, showing the raw
  // response. The fast mode hits the Cloudflare /detect Worker (with a token);
  // the legacy mode hits the Supabase deimv2-proxy. Dry-run only — never enters
  // the risk engine.
  const testBackendFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setBackendTest("No active video frame — enable the camera first.");
      return;
    }
    setBackendTesting(true);
    try {
      // Use the SAME aspect-preserving capture as the live detector so the
      // single-frame test mirrors what the live stream actually sends. On
      // mobile portrait this cover-crops to MOBILE_VISUAL_ASPECT — the preview
      // image below is proof that the backend receives exactly what the user
      // sees on the camera card.
      const targetAspect = isMobileViewport(window.innerWidth) ? MOBILE_VISUAL_ASPECT : null;
      const captured = captureVideoFrameBase64(video, { targetAspect });
      if (!captured) {
        setBackendTest("Frame capture failed.");
        return;
      }
      const { image_b64, cw, ch } = captured;
      setBackendTestImg(`data:image/jpeg;base64,${image_b64}`); // preview the exact frame we send
      if (isCloudflareHttp) {
        const t0 = performance.now();
        const resp = await postDetectFrame(image_b64, { conf: 0.15 });
        const latency = Math.round(performance.now() - t0);
        setBackendTest(
          `capture ${cw}×${ch} · round-trip ${latency} ms\n${JSON.stringify(resp, null, 2)}`,
        );
      } else {
        const { data, error } = await supabase.functions.invoke("deimv2-proxy", {
          body: { image_b64, conf: 0.15, img_size: 640, classes: null },
        });
        setBackendTest(`capture ${cw}×${ch}\n${JSON.stringify(error ?? data, null, 2)}`);
      }
    } catch (e) {
      setBackendTest(e instanceof Error ? e.message : String(e));
    } finally {
      setBackendTesting(false);
    }
  }, [videoRef, isCloudflareHttp]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <header>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Live monitoring</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          The phone is the camera. Hazards are detected on-device and surfaced instantly — nothing
          is recorded unless an incident is saved.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* min-w-0: this grid item defaults to min-width:auto, so any non-wrapping
            child (e.g. the debug panel's 1500-char `raw:` line) would blow the
            column out to ~10000px — pushing the centered camera card off-screen
            and making it "jump" as the text length changes each frame. */}
        <div className="min-w-0 space-y-4">
          {/* Workflow toggle: HSE monitoring vs Build Mode (blueprint capture). */}
          {ENABLE_BUILD_MODE && (
            <div className="mx-auto flex w-[min(88vw,340px)] rounded-xl border border-border bg-background/40 p-1 sm:mx-0 sm:w-fit">
              <Button
                size="sm"
                variant={appMode === "hse" ? "default" : "ghost"}
                className="flex-1 sm:flex-none"
                onClick={() => setAppMode("hse")}
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                HSE Mode
              </Button>
              <Button
                size="sm"
                variant={appMode === "build" ? "default" : "ghost"}
                className="flex-1 sm:flex-none"
                onClick={() => setAppMode("build")}
              >
                <Hammer className="mr-1.5 h-4 w-4" />
                Build Mode
              </Button>
            </div>
          )}

          <CameraView
            videoRef={videoRef}
            active={active}
            starting={starting}
            error={error}
            boxes={liveBoxes}
            running={running}
            topAlert={topAlert}
            language={config.language}
            facing={facing}
            onEnable={() => startCamera()}
            onFlip={flip}
            poseStatus={poseStatus}
            debug={debug}
            showSkeleton={import.meta.env.DEV}
            backendEntities={backendEntities as BackendEntity[]}
            backendPoses={backendPoses as BackendPose[]}
            backendDryRun={isBackendMode}
            zones={zones}
            editingZones={editingZones}
            onZoneCreate={(points) =>
              createZone.mutate({
                kind: "restricted",
                label: `Zone ${zones.length + 1}`,
                points,
              })
            }
            buildOverlay={
              buildModeOn ? (
                <>
                  <SelectionOverlay
                    active={build.phase === "selecting"}
                    onSelect={(region) => void build.lockSelection(region)}
                  />
                  <HandPointerLayer
                    landmarks={hand.handLandmarks}
                    primaryId={hand.primaryPointer?.id}
                  />
                  {build.region && (build.phase === "recording" || build.phase === "review") && (
                    <FloatingBlueprintLayer
                      region={build.region}
                      frame={ghostFrame}
                      recording={build.phase === "recording"}
                      handPointer={hand.primaryPointer}
                      onHandInteraction={onHandInteraction}
                    />
                  )}
                </>
              ) : null
            }
          />
          <SessionControls
            cameraActive={active}
            running={running}
            stats={stats}
            onStart={handleStart}
            onStop={stop}
          />

          {buildModeOn && (
            <BuildModePanel
              session={build}
              replay={replay}
              cameraActive={active}
              handStatus={handStatus}
            />
          )}

          {/* Restricted-zone editor */}
          <div className="rounded-xl border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Shapes className="h-4 w-4 text-primary" />
                Hazard zones
                <span className="text-xs text-muted-foreground">({zones.length})</span>
              </span>
              <Button
                size="sm"
                variant={editingZones ? "default" : "secondary"}
                onClick={() => setEditingZones((v) => !v)}
                disabled={!active}
              >
                {editingZones ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> Done
                  </>
                ) : (
                  "Edit zones"
                )}
              </Button>
            </div>
            {editingZones && (
              <p className="mt-2 text-xs text-muted-foreground">
                Drag a box on the camera to mark an off-limits area. A stable person who steps
                inside raises a restricted-zone alert (needs the “Restricted-zone entry” hazard
                enabled, in Pose mode).
              </p>
            )}
            {zones.length > 0 && (
              <ul className="mt-2 space-y-1">
                {zones.map((z) => (
                  <li
                    key={z.id}
                    className="flex items-center justify-between rounded-lg bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="truncate">{z.label ?? "Zone"}</span>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => deleteZone.mutate(z.id)}
                      aria-label="Delete zone"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Mobile-only alerts trigger */}
          <div className="lg:hidden">
            <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <BellRing className="h-4 w-4 text-primary" />
                    Live alerts
                  </span>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                    {alerts.length}
                  </span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[80vh] rounded-t-2xl p-4">
                <AlertFeed
                  alerts={alerts}
                  running={running}
                  language={config.language}
                  onDismiss={dismissAlert}
                />
              </SheetContent>
            </Sheet>
          </div>

          {import.meta.env.DEV && debug && <PoseDebugPanel debug={debug} perf={perf} />}

          {/* EdgeCrafter dry-run debug — visible in either EdgeCrafter mode (HTTP
              dry-run or WebSocket stream beta), not gated to dev builds so the
              pipeline is observable in the deployed app. Dry-run only: no alerts,
              no incidents. */}
          {isBackendMode && (
            <div className="space-y-2">
              {backendStatus != null && (
                <BackendDebugPanel
                  status={backendStatus as BackendStatus}
                  entities={backendEntities as BackendEntity[]}
                  poses={backendPoses as BackendPose[]}
                  perf={perf}
                  stats={stats}
                />
              )}
              {showFrameTest && (
                <div className="rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      EdgeCrafter dry-run · single-frame test
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={testBackendFrame}
                      disabled={!active || backendTesting}
                    >
                      {backendTesting ? "Testing…" : "Test EdgeCrafter frame"}
                    </Button>
                  </div>
                  {(backendTestImg || backendTest) && (
                    <div className="mt-2 space-y-2">
                      {backendTestImg && (
                        <div>
                          <div className="mb-1 text-[10px] text-muted-foreground">
                            captured frame sent to /detect (check it isn't black/blank/rotated):
                          </div>
                          <img
                            src={backendTestImg}
                            alt="captured frame"
                            className="max-h-40 rounded border border-border"
                          />
                        </div>
                      )}
                      {backendTest && (
                        <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-snug">
                          {backendTest}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="glass-panel hidden rounded-2xl border p-4 lg:sticky lg:top-6 lg:block lg:h-[calc(100vh-9rem)]">
          <AlertFeed
            alerts={alerts}
            running={running}
            language={config.language}
            onDismiss={dismissAlert}
          />
        </aside>
      </div>

      <p className="pt-1 text-center text-[10px] text-muted-foreground/60">
        build {BUILD_MARKER} · {buildTime()} · {import.meta.env.MODE} · mode {config.detectionMode}
      </p>
    </div>
  );
}
