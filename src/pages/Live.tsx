import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Hammer, Route, Shapes, Trash2 } from "lucide-react";
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
import {
  BUILD_EXTRACT_HOLD_MS,
  ENABLE_BUILD_MODE,
  ENABLE_MEDIAPIPE_HANDS,
} from "@/features/build-mode/config";
import { PinchHoldRing } from "@/features/build-mode/components/PinchHoldRing";
import { useBuildModeSession } from "@/features/build-mode/hooks/useBuildModeSession";
import { useBlueprintReplay } from "@/features/build-mode/hooks/useBlueprintReplay";
import { useBuildHandTracking } from "@/features/build-mode/hooks/useBuildHandTracking";
import { useMediaPipeHands } from "@/features/build-mode/hooks/useMediaPipeHands";
import { BuildModePanel } from "@/features/build-mode/components/BuildModePanel";
import type { HandControlStatus } from "@/features/build-mode/components/BuildModePanel";
import {
  SelectedRegionMarker,
  SelectionOverlay,
} from "@/features/build-mode/components/SelectionOverlay";
import { FloatingBlueprintLayer } from "@/features/build-mode/components/FloatingBlueprintLayer";
import { HandPointerLayer } from "@/features/build-mode/components/HandPointerLayer";
import { ARRecordButton } from "@/features/build-mode/components/ARRecordButton";
import { ExtractableCandidateOverlay } from "@/features/build-mode/components/ExtractableCandidateOverlay";
import {
  buildExtractCandidates,
  detectionBoxToRegion,
  findCandidateAtPoints,
  pointerInBounds,
} from "@/features/build-mode/lib/handTracking";
import type {
  BlueprintWorkflowMode,
  BuildGesture,
  BuildHandInteraction,
  BuildHandLandmark,
  ExtractCandidate,
} from "@/features/build-mode/types";

/** Top-level app workflow: HSE monitoring | Build (document) | Plan (guide). */
type AppMode = "hse" | "build" | "plan";

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

  // App workflow: HSE monitoring (existing) | Build (document my work) | Plan
  // (guide me through work). Build and Plan share the SAME blueprint engine —
  // one flag distinguishes them. Both keep the live camera + HSE loop running
  // but suppress incident persistence — additive workflows, not detector changes.
  const [appMode, setAppMode] = useState<AppMode>("hse");
  const buildModeOn = ENABLE_BUILD_MODE && (appMode === "build" || appMode === "plan");
  const workflowMode: BlueprintWorkflowMode = appMode === "plan" ? "plan" : "build";

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

  // Finger-level hand tracking (MediaPipe Hand Landmarker) — Build Mode only,
  // lazy-loaded, independent of Start Monitoring, torn down on leaving.
  const mp = useMediaPipeHands({
    enabled: ENABLE_MEDIAPIPE_HANDS && buildModeOn && active,
    videoRef,
  });

  // Hand tracking adapter — control priority: MediaPipe fingers → EdgeCrafter
  // backend pose wrists → local pose-debug wrists → touch drag (UI fallback).
  const hand = useBuildHandTracking({
    enabled: buildModeOn,
    mediapipeLandmarks: mp.landmarks,
    backendPoses: backendPoses as BackendPose[],
    poseDebug: debug,
    running,
  });
  const handLandmarksRef = useRef<BuildHandLandmark[]>([]);
  handLandmarksRef.current = hand.handLandmarks;
  const getHandLandmarks = useCallback(() => handLandmarksRef.current, []);
  const pinchRef = useRef(mp.pinch);
  pinchRef.current = mp.pinch;
  const getGesture = useCallback((): BuildGesture | undefined => {
    const p = pinchRef.current;
    return p ? { type: "pinch", active: p.active, strength: p.strength } : undefined;
  }, []);
  // Grab/drag state reported up by the floating blueprint (it owns its bounds).
  const [handLayerMode, setHandLayerMode] = useState<BuildHandInteraction["mode"]>("idle");
  const onHandInteraction = useCallback((i: BuildHandInteraction) => setHandLayerMode(i.mode), []);

  const build = useBuildModeSession({
    videoRef,
    enabled: buildModeOn,
    cameraFacing: facing,
    getHandLandmarks,
    getGesture,
    workflowMode,
  });
  const replay = useBlueprintReplay(build.phase === "review" ? build.frames : []);
  // Ghost shown on the floating layer: the extracted base blueprint while
  // placing/pinned, the live latest keyframe while recording, and the replay
  // playhead frame in review.
  const ghostFrame =
    build.phase === "review"
      ? (replay.currentFrame ?? build.latestFrame ?? build.baseFrame)
      : build.phase === "recording"
        ? (build.latestFrame ?? build.baseFrame)
        : build.baseFrame;
  // v2: the ghost's pixels live in the session's transient asset store; the
  // frame only references them.
  const ghostAsset = build.getAsset(ghostFrame?.sourceAssetId);

  // Status chip: pinch-drag > finger tracking > wrist fallback > waiting
  // (model loading / loop running but no hand yet) > touch fallback.
  const handDragging = handLayerMode === "grab" || handLayerMode === "dragging";
  const handStatus: HandControlStatus | undefined = buildModeOn
    ? handDragging && hand.sourceMode === "mediapipe"
      ? "pinch-dragging"
      : hand.sourceMode === "mediapipe"
        ? "finger-tracking"
        : hand.sourceMode === "backend-wrist" || hand.sourceMode === "debug-wrist"
          ? "wrist-fallback"
          : mp.loading || mp.ready || running
            ? "waiting"
            : "touch-fallback"
    : undefined;

  // HSE DETECTION BOXES ARE THE MAIN EXTRACTION SOURCE. Every live detection
  // (EdgeCrafter entity + HSE live box, both card coords) becomes an
  // ExtractCandidate; HOLD a pinch on one for BUILD_EXTRACT_HOLD_MS (mini
  // countdown clock) and it converts to the Build region + extracts its
  // blueprint. Hit-testing uses BOTH the index tip and the thumb↔index pinch
  // midpoint so the visual pinch point can't miss. Manual Select-object stays
  // as the fallback path.
  const candidates = useMemo(
    () => buildExtractCandidates(backendEntities as BackendEntity[], liveBoxes),
    [backendEntities, liveBoxes],
  );
  const [extractHold, setExtractHold] = useState<{
    x: number;
    y: number;
    progress: number;
  } | null>(null);
  const [hotCandidateId, setHotCandidateId] = useState<string | null>(null);
  const holdCandidateRef = useRef<ExtractCandidate | null>(null);
  const holdStartRef = useRef(0);
  const holdFiredRef = useRef(false);
  const primaryPointerRef = useRef(hand.primaryPointer);
  primaryPointerRef.current = hand.primaryPointer;
  const handLandmarksRef2 = handLandmarksRef; // thumb tip lives in the same list
  const candidatesRef = useRef<ExtractCandidate[]>(candidates);
  candidatesRef.current = candidates;
  const extractFromRegionRef = useRef(build.extractFromRegion);
  extractFromRegionRef.current = build.extractFromRegion;

  useEffect(() => {
    if (!buildModeOn || !active || build.phase !== "idle") {
      holdCandidateRef.current = null;
      holdFiredRef.current = false;
      setExtractHold(null);
      setHotCandidateId(null);
      return;
    }
    const tick = () => {
      const p = primaryPointerRef.current;
      const pn = pinchRef.current;
      // Pinch midpoint (thumb↔index) of the primary hand, when available.
      const thumb = handLandmarksRef2.current.find(
        (l) => l.role === "thumb-tip" && l.hand === p?.hand,
      );
      const mid = p && thumb ? { x: (p.x + thumb.x) / 2, y: (p.y + thumb.y) / 2 } : null;
      const points = [p, mid];

      // Highlight the candidate under the finger even before pinching.
      const hover = findCandidateAtPoints(points, candidatesRef.current);
      setHotCandidateId(hover?.id ?? null);

      if (!p || !pn?.active) {
        // Pinch released/lost → reset the clock and re-arm.
        holdCandidateRef.current = null;
        holdFiredRef.current = false;
        setExtractHold(null);
        return;
      }
      if (holdFiredRef.current) return;
      if (!holdCandidateRef.current) {
        if (!hover) {
          setExtractHold(null);
          return;
        }
        holdCandidateRef.current = hover;
        holdStartRef.current = Date.now();
      }
      // The pinch must STAY on the same candidate (jitter tolerance; either
      // the fingertip OR the pinch midpoint inside counts).
      const b = holdCandidateRef.current.bbox;
      const tol = 0.03;
      const expanded = { x: b.x - tol, y: b.y - tol, w: b.w + 2 * tol, h: b.h + 2 * tol };
      const stillInside = points.some((pt) => pt && pointerInBounds(pt, expanded));
      if (!stillInside) {
        holdCandidateRef.current = null;
        setExtractHold(null);
        return;
      }
      const progress = Math.min(1, (Date.now() - holdStartRef.current) / BUILD_EXTRACT_HOLD_MS);
      setExtractHold({ x: p.x, y: p.y, progress });
      if (progress >= 1) {
        const c = holdCandidateRef.current;
        holdFiredRef.current = true;
        holdCandidateRef.current = null;
        setExtractHold(null);
        void extractFromRegionRef.current(detectionBoxToRegion(c.bbox), {
          source: c.source,
          label: c.label,
        });
      }
    };
    const id = setInterval(tick, 100);
    tick();
    return () => {
      clearInterval(id);
      setExtractHold(null);
      setHotCandidateId(null);
    };
  }, [buildModeOn, active, build.phase, handLandmarksRef2]);

  // Phase-appropriate fingertip hint — never a misleading "pinch to grab".
  const fingerHint = !buildModeOn
    ? null
    : build.phase === "idle"
      ? candidates.length > 0
        ? "hold pinch 4s on a box"
        : running
          ? "no objects detected yet"
          : "start detection below"
      : build.phase === "selected"
        ? "hold pinch 4s on the box"
        : build.phase === "placing"
          ? "release to pin"
          : build.phase === "pinned"
            ? "hold finger on Record"
            : build.phase === "recording"
              ? "hold finger on Stop"
              : null;

  // On-phone extraction diagnostics for the Build panel debug readout.
  const pointerInsideRegion =
    build.region && hand.primaryPointer
      ? pointerInBounds(hand.primaryPointer, build.region)
      : false;
  const hotCandidate = candidates.find((c) => c.id === hotCandidateId) ?? null;
  const buildDebug = {
    phase: build.phase,
    hasRegion: build.region != null,
    hasBaseFrame: build.baseFrame != null,
    hasGhostFrame: ghostFrame != null,
    extractStatus: build.extractStatus,
    pointer: hand.primaryPointer ? { x: hand.primaryPointer.x, y: hand.primaryPointer.y } : null,
    pointerInsideRegion,
    pinchActive: !!mp.pinch?.active,
    candidateCount: candidates.length,
    candidateUnderPinch: hotCandidate != null,
    candidateLabel: hotCandidate?.label ?? build.extractSource?.label ?? null,
  };

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
                  {/* Detection boxes as the MAIN extraction source: cyan
                      candidate outlines while choosing (idle). */}
                  {build.phase === "idle" && (
                    <ExtractableCandidateOverlay
                      candidates={candidates}
                      highlightId={hotCandidateId}
                    />
                  )}
                  <SelectionOverlay
                    active={build.phase === "selecting"}
                    onSelect={(region) => void build.lockSelection(region)}
                  />
                  <HandPointerLayer
                    landmarks={hand.handLandmarks}
                    primaryId={hand.primaryPointer?.id}
                    pinch={mp.pinch}
                    hint={fingerHint}
                  />
                  {/* Mini countdown clock while a pinch is HELD on a detected
                      box — extraction fires only when the ring completes. */}
                  {extractHold && (
                    <div
                      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[130%]"
                      style={{
                        left: `${extractHold.x * 100}%`,
                        top: `${extractHold.y * 100}%`,
                      }}
                    >
                      <PinchHoldRing progress={extractHold.progress} label="creating blueprint…" />
                    </div>
                  )}
                  {/* Source marker stays on the real object once the ghost detaches. */}
                  {build.region &&
                    ["placing", "pinned", "recording", "review"].includes(build.phase) && (
                      <SelectedRegionMarker region={build.region} />
                    )}
                  {/* In-camera Record/Stop targets: pressed with the tracked
                      finger (dwell ring / pinch) — never instant. */}
                  {build.phase === "pinned" && (
                    <ARRecordButton
                      variant="record"
                      pointer={hand.primaryPointer}
                      pinch={hand.sourceMode === "mediapipe" ? mp.pinch : null}
                      onTrigger={build.startProcedureRecording}
                    />
                  )}
                  {build.phase === "recording" && (
                    <ARRecordButton
                      variant="stop"
                      pointer={hand.primaryPointer}
                      pinch={hand.sourceMode === "mediapipe" ? mp.pinch : null}
                      onTrigger={() => void build.stopRecording()}
                    />
                  )}
                  {/* The extraction box / detachable ghost, from "selected" onward. */}
                  {build.region && build.phase !== "idle" && build.phase !== "selecting" && (
                    <FloatingBlueprintLayer
                      phase={build.phase}
                      region={build.region}
                      frame={ghostFrame}
                      sourceAsset={ghostAsset}
                      handPointer={hand.primaryPointer}
                      pinch={hand.sourceMode === "mediapipe" ? mp.pinch : null}
                      onExtractRequest={() => void build.extractBlueprint()}
                      onPinned={build.pinBlueprint}
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
            buildToggle={
              ENABLE_BUILD_MODE ? (
                <>
                  <Button
                    size="lg"
                    variant={appMode === "build" ? "default" : "secondary"}
                    className="shrink-0 px-2.5"
                    aria-pressed={appMode === "build"}
                    title={
                      appMode === "build"
                        ? "Switch to HSE monitoring"
                        : "Build Mode — record/document my work"
                    }
                    onClick={() => setAppMode((m) => (m === "build" ? "hse" : "build"))}
                  >
                    <Hammer className="mr-1.5 h-4 w-4" />
                    Build
                  </Button>
                  <Button
                    size="lg"
                    variant={appMode === "plan" ? "default" : "secondary"}
                    className="shrink-0 px-2.5"
                    aria-pressed={appMode === "plan"}
                    title={
                      appMode === "plan"
                        ? "Switch to HSE monitoring"
                        : "Plan Mode — guide me through work"
                    }
                    onClick={() => setAppMode((m) => (m === "plan" ? "hse" : "plan"))}
                  >
                    <Route className="mr-1.5 h-4 w-4" />
                    Plan
                  </Button>
                </>
              ) : undefined
            }
          />

          {buildModeOn && (
            <BuildModePanel
              session={build}
              replay={replay}
              cameraActive={active}
              monitoringRunning={running}
              onStartDetection={() => void handleStart()}
              candidateCount={candidates.length}
              handStatus={handStatus}
              debug={buildDebug}
              workflowMode={workflowMode}
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
