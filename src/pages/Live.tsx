import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Bug, Check, Hammer, Route, Shapes, Trash2 } from "lucide-react";
import { useCamera } from "@/hooks/useCamera";
import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useDetectionSession } from "@/hooks/useDetectionSession";
import type { PerfMetrics, SessionStats } from "@/hooks/useDetectionSession";
import { useZones, useCreateZone, useDeleteZone } from "@/hooks/useZones";
import { CameraView } from "@/components/live/CameraView";
import { AlertFeed } from "@/components/live/AlertFeed";
import { SessionControls } from "@/components/live/SessionControls";
import { LiveModeHeader } from "@/components/live/LiveModeHeader";
import { PoseDebugPanel } from "@/components/live/PoseDebugPanel";
import type { BackendStatus } from "@/lib/detection/backendVisionDetector";
import {
  postDetectFrame,
  captureVideoFrameBase64,
  parseDetectRiskFields,
  hasRiskAwareData,
  summarizeDetectResponse,
  formatDetectSummary,
} from "@/lib/detection/backendVisionHttpDetector";
import { buildHseDetectRequest } from "@/lib/detection/hseDetectProfile";
import { isMobileViewport, MOBILE_VISUAL_ASPECT } from "@/lib/detection/coverCrop";
import type { BackendEntity, BackendPose, BackendSegment } from "@/lib/detection/types";
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
import { BlueprintCalloutLayer } from "@/features/build-mode/components/BlueprintCalloutLayer";
import { PlanHologramRenderer } from "@/features/build-mode/components/PlanHologramRenderer";
import { PlanConsole } from "@/features/build-mode/components/PlanConsole";
import { useHseMonitoring } from "@/features/hse-monitoring/hooks/useHseMonitoring";
import { useHseLiveRiskViewModel } from "@/features/hse-monitoring/hooks/useHseLiveRiskViewModel";
import { EagleVisionHUD } from "@/components/live/EagleVisionHUD";
import {
  SceneRiskPanel,
  MonitoringDegradedBanner,
  RiskDebugPanel,
  CameraPrivacyNotice,
} from "@/components/live/SceneRiskPanel";
import {
  readRiskFeatureFlags,
  readHseFeatureFlags,
  readHseQwenHeartbeatFlags,
} from "@/lib/featureFlags";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import { WearableAlertOverlay } from "@/components/live/WearableAlertOverlay";
import { HseMonitoringPanel } from "@/components/live/HseMonitoringPanel";
import {
  ReasonerContractProbe,
  computeQwenDiagnostic,
  formatRouteStatus,
} from "@/components/live/ReasonerContractProbe";
import {
  useQwenHeartbeat,
  type QwenHeartbeatDiagnostic,
} from "@/features/hse-monitoring/hooks/useQwenHeartbeat";
import {
  HeartbeatDiagnosticsPanel,
  type HeartbeatCounters,
} from "@/components/live/HeartbeatDiagnosticsPanel";
import {
  mergeParsedRisk,
  isHeartbeatFresh,
  heartbeatIgnoreReason,
  heartbeatIgnoreMessage,
} from "@/features/hse-monitoring/lib/mergeParsedRisk";
import { HandPointerLayer } from "@/features/build-mode/components/HandPointerLayer";
import { ARRecordButton } from "@/features/build-mode/components/ARRecordButton";
import { ExtractableCandidateOverlay } from "@/features/build-mode/components/ExtractableCandidateOverlay";
import {
  buildExtractCandidates,
  detectionBoxToRegion,
  findCandidateAtPoints,
  pointerInBounds,
} from "@/features/build-mode/lib/handTracking";
import { isRecordTargetPhase, isStopTargetPhase } from "@/features/build-mode/lib/holdToTrigger";
import type {
  BlueprintWorkflowMode,
  BuildGesture,
  BuildHandInteraction,
  BuildHandLandmark,
  ExtractCandidate,
} from "@/features/build-mode/types";

/** Top-level app workflow: HSE monitoring | Build (document) | Plan (guide). */
type AppMode = "hse" | "build" | "plan";

/** Readout of the vision backend (YOLO26 default, EdgeCrafter fallback) — fast Cloudflare HTTP, legacy HTTP dry-run, or WebSocket stream. */
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
  const isYolo = status.backend === "yolo26";
  const transportLabel = isStream
    ? "Vision stream (beta)"
    : isCloudflare
      ? isYolo
        ? "YOLO26 HTTP"
        : "Vision HTTP"
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
          backend:{" "}
          <span className={isYolo ? "text-emerald-500" : "text-foreground"}>
            {status.backend ?? "—"}
          </span>{" "}
          · tasks: {status.tasks?.join(",") ?? "—"}
          {status.model ? ` · model ${status.model}` : ""}
        </div>
        {/* Fallback + segmentation metadata — makes a YOLO26→EdgeCrafter
            fallback obvious, and shows the seg count when present. */}
        {(status.fallbackUsed || status.fallbackReason || status.warning) && (
          <div className="text-amber-500">
            {status.fallbackUsed ? `${status.backend ?? "backend"} fallback` : "warning"}
            {status.fallbackReason ? ` · reason: ${status.fallbackReason}` : ""}
            {status.warning ? ` · ${status.warning}` : ""}
          </div>
        )}
        {status.segmentCount != null && status.segmentCount > 0 && (
          <div>segments: {status.segmentCount}</div>
        )}
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
        <div>response label: {status.model ?? "—"}</div>
        <div>detector model id: {status.detModelId ?? "—"}</div>
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
          <span className="font-semibold text-foreground">Vision stream (beta).</span> Authenticated
          with a short-lived Supabase-issued session token (<code>?token=</code>); the gateway URL
          comes from the session (override with <code>VITE_VISION_STREAM_WS_URL</code>, legacy{" "}
          <code>VITE_EDGECRAFT_STREAM_WS_URL</code>). The browser never holds the RunPod API key or
          the signing secret.
        </div>
      )}
      {isCloudflare && (
        <div className="mt-2 border-t border-border/60 pt-2 text-[10px] not-italic text-muted-foreground">
          <span className="font-semibold text-foreground">Fast vision HTTP dry-run.</span> Frames
          POST directly to the Cloudflare <code>/detect</code> Worker (YOLO26 by default,
          EdgeCrafter fallback), which holds the RunPod API key and forwards to the worker.
          Authenticated with a short-lived Supabase session token (<code>?token=</code>, reused from{" "}
          <code>create-stream-session</code>). One request in flight, newest frame only — no alerts,
          no incidents.
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
  // Selfie mirror: the front camera mirrors the VIDEO (CameraView); overlays
  // keep RAW coordinates internally and flip their GEOMETRY at draw time so
  // boxes/dots/ghosts land on the mirrored image (text always stays readable).
  const mirrored = facing === "user";

  // Risk-aware feature flags (all default OFF). When every flag is off the
  // risk-aware UI below is never mounted and behavior is byte-for-byte unchanged.
  const riskFlags = useMemo(() => readRiskFeatureFlags(), []);
  const hseFlags = useMemo(() => readHseFeatureFlags(), []);

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
    backendSegments,
    backendRisk,
    start,
    stop,
    dismissAlert,
    setMonitoringRequest,
  } = useDetectionSession({
    videoRef,
    config,
    zones,
    onIncidentSaved,
    suppressIncidents: buildModeOn,
    suppressLocalRiskEngine: appMode === "hse" && !hseFlags.localAlertsEnabled,
  });

  // Eagle Vision HSE monitoring pipeline (HSE mode only) — backend detections →
  // tracks → risk rules → wearable alerts + HUD + throttled DeepSeek. Runs
  // alongside the existing RiskEngine/pose path without touching it.
  const hseActive = appMode === "hse" && running;
  const [focusArmed, setFocusArmed] = useState(false);
  const hse = useHseMonitoring({
    enabled: hseActive,
    backendEntities: backendEntities as BackendEntity[],
    backendPoses: backendPoses as BackendPose[],
    backendSegments: backendSegments as BackendSegment[],
    liveBoxes: hseFlags.localAlertsEnabled ? liveBoxes : [],
    zones,
    backendName: (backendStatus as BackendStatus | null)?.backend ?? null,
    fallbackActive: !!(backendStatus as BackendStatus | null)?.fallbackUsed,
    setMonitoringRequest,
    localAlertsEnabled: hseFlags.localAlertsEnabled,
  });

  // HSE Live Risk View Model — single selector for what the HSE UI shows
  // (priority list, scene panel, overlay entities/poses, Qwen badge). Only
  // built in HSE mode so Build/Plan are byte-for-byte unchanged.
  const liveBackendRisk = (backendRisk as ParsedDetectRisk | null) ?? null;

  // Qwen scene-reasoning heartbeat (HSE only). Runs at a low frequency, never
  // replaces backendEntities/backendPoses/backendSegments. Merged into the HSE
  // view model only when the result is fresh; otherwise updates diagnostics.
  const heartbeatFlags = useMemo(() => readHseQwenHeartbeatFlags(), []);
  const [heartbeatRisk, setHeartbeatRisk] = useState<ParsedDetectRisk | null>(null);
  const [heartbeatRaw, setHeartbeatRaw] = useState<unknown>(null);
  const [heartbeatAtMs, setHeartbeatAtMs] = useState<number | null>(null);
  const [heartbeatSessionId, setHeartbeatSessionId] = useState<string | null>(null);
  const [currentHeartbeatSessionId, setCurrentHeartbeatSessionId] = useState<string | null>(null);
  const [heartbeatForceReasonSent, setHeartbeatForceReasonSent] = useState<boolean>(false);
  const [heartbeatLastDiag, setHeartbeatLastDiag] = useState<QwenHeartbeatDiagnostic | null>(null);
  const [heartbeatCounters, setHeartbeatCounters] = useState<HeartbeatCounters>({
    okCount: 0,
    errorCount: 0,
    skippedInflightCount: 0,
    noVideoCount: 0,
  });
  // Share the live detector's worker session_id with the heartbeat so both
  // loops use the SAME temporal/Qwen memory window on the worker. Cloudflare
  // `?token=` (set inside postDetectFrame) authorizes the gateway request and
  // is independent of this session id.
  const liveDetectorSessionId = (backendStatus as BackendStatus | null)?.sessionId ?? null;
  useQwenHeartbeat({
    enabled: hseActive && heartbeatFlags.enabled,
    videoRef,
    profile: hse.profile,
    roi: hse.roi,
    intervalMs: heartbeatFlags.intervalMs,
    backoffMs: heartbeatFlags.backoffMs,
    extendedBackoffMs: heartbeatFlags.extendedBackoffMs,
    extendedBackoffAfter: heartbeatFlags.extendedBackoffAfter,
    forceReason: heartbeatFlags.forceReason,
    sessionIdOverride: liveDetectorSessionId,
    onResponse: useCallback(
      (r: {
        parsed: ParsedDetectRisk | null;
        raw: unknown;
        receivedAtMs: number;
        sessionId: string;
        forceReasonSent: boolean;
      }) => {
        setHeartbeatRisk(r.parsed);
        setHeartbeatRaw(r.raw);
        setHeartbeatAtMs(r.receivedAtMs);
        setHeartbeatSessionId(r.sessionId);
        setHeartbeatForceReasonSent(r.forceReasonSent);
      },
      [],
    ),
    onSessionStart: useCallback((sid: string) => {
      setCurrentHeartbeatSessionId(sid);
    }, []),
    onDiagnostic: useCallback((d: QwenHeartbeatDiagnostic) => {
      setHeartbeatLastDiag(d);
      setHeartbeatCounters((prev) => ({
        okCount: prev.okCount + (d.outcome === "ok" ? 1 : 0),
        errorCount: prev.errorCount + (d.outcome === "error" ? 1 : 0),
        skippedInflightCount:
          prev.skippedInflightCount + (d.outcome === "skipped-inflight" ? 1 : 0),
        noVideoCount: prev.noVideoCount + (d.outcome === "no-video" ? 1 : 0),
      }));
    }, []),
  });

  const nowMsForVm = Date.now();
  const heartbeatFresh = isHeartbeatFresh(heartbeatAtMs, heartbeatFlags.resultTtlMs, nowMsForVm);
  const hbIgnoreReason = heartbeatRisk
    ? heartbeatIgnoreReason({
        receivedAtMs: heartbeatAtMs,
        ttlMs: heartbeatFlags.resultTtlMs,
        nowMs: nowMsForVm,
        heartbeatSessionId,
        // True live detector session id — surfaces real session-mismatch when a
        // stale in-flight heartbeat from a previous live session arrives late.
        liveSessionId: liveDetectorSessionId,
        liveHasEntities: (backendEntities as BackendEntity[]).length > 0,
      })
    : null;
  void heartbeatFresh;
  const parsedRiskForVm = heartbeatRisk
    ? mergeParsedRisk(liveBackendRisk, heartbeatRisk, {
        applyHeartbeatRisks: hbIgnoreReason == null,
      })
    : liveBackendRisk;
  const hseRiskViewModel = useHseLiveRiskViewModel({
    entities: backendEntities as BackendEntity[],
    poses: backendPoses as BackendPose[],
    parsedRisk: parsedRiskForVm,
    localActiveAlerts: hse.activeAlerts,
    nowMs: nowMsForVm,
    qwenCandidateLaneEnabled: hseFlags.qwenCandidateLaneEnabled,
    showQwenCandidates: hseFlags.showQwenCandidates,
    localAlertsEnabled: hseFlags.localAlertsEnabled,
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

  // Plan reasoning context (Plan mode only): the live YOLO26 detections feed the
  // DeepSeek plan reasoner. Refs keep the callback stable. Build mode ignores it.
  const backendEntitiesRef = useRef(backendEntities);
  backendEntitiesRef.current = backendEntities;
  const backendSegmentsRef = useRef(backendSegments);
  backendSegmentsRef.current = backendSegments;
  const getPlanContext = useCallback(() => {
    const ents = (backendEntitiesRef.current as BackendEntity[]).slice(0, 12).map((e) => ({
      label: e.label,
      confidence: e.confidence,
      bbox: e.bbox,
      source: e.source,
    }));
    const segs = (backendSegmentsRef.current as BackendSegment[]).slice(0, 8).map((s) => ({
      label: s.label,
      confidence: s.confidence,
      maskContour: s.maskContour,
      source: s.source,
    }));
    return { detectedEntities: ents, segments: segs };
  }, []);

  // Plan multi-object scene: the live extraction candidates at capture time feed
  // the holographic scene builder. Filled below once `candidates` exists; the
  // getter is stable so the session callback never churns. Build ignores it.
  const planCandidatesRef = useRef<ExtractCandidate[]>([]);
  const getPlanCandidates = useCallback(() => planCandidatesRef.current, []);

  const build = useBuildModeSession({
    videoRef,
    enabled: buildModeOn,
    cameraFacing: facing,
    getHandLandmarks,
    getGesture,
    workflowMode,
    getPlanContext,
    getPlanCandidates,
  });
  // Plan "reply" drawer open-state — lifted so a Plan callout tap can open the
  // goal input in the panel below.
  const [planReplyOpen, setPlanReplyOpen] = useState(false);
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
  // Holographic Scene Canvas: a Plan frame carrying a multi-object scene renders
  // the PlanHologramRenderer instead of the single-object guidance overlay. Any
  // other frame (Build, single-object Plan, saved blueprints without a scene)
  // renders the EXISTING path unchanged.
  const planScene =
    ghostFrame?.workflowMode === "plan" && ghostFrame.sceneBlueprint?.version === "plan-scene-v1"
      ? ghostFrame.sceneBlueprint
      : null;
  // Live ghost bounds (card space) reported by the floating layer — the
  // external callout cards attach their leader lines to it.
  const [ghostBounds, setGhostBounds] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

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
  // YOLO26 entities (and optional seg outlines) become candidates exactly like
  // EdgeCrafter entities; the resolved backend just sets the candidate `source`.
  const backendName = (backendStatus as BackendStatus | null)?.backend ?? null;
  const candidates = useMemo(
    () =>
      buildExtractCandidates(backendEntities as BackendEntity[], liveBoxes, {
        backend: backendName,
        segments: backendSegments as BackendSegment[],
      }),
    [backendEntities, liveBoxes, backendName, backendSegments],
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
  // Feed the same live candidates to the Plan scene builder (region-local
  // mapping + clamping happens inside the session).
  planCandidatesRef.current = candidates;
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

  // Parsed risk-aware view from the HTTP detector (null for legacy responses).
  // Only consumed when a risk-aware flag is on — otherwise it's inert.
  const risk = appMode === "hse" ? parsedRiskForVm : liveBackendRisk;
  const showSceneRiskPanel =
    appMode === "hse" &&
    riskFlags.workerSceneRisks &&
    (hseRiskViewModel.priorityRisks.length > 0 || !!risk?.riskSummary);
  const showDegradedBanner = riskFlags.workerSceneRisks && !!risk && risk.degraded;

  // All EdgeCrafter modes share the same dry-run overlays + debug panel. The
  // single-frame test button is for the HTTP modes (fast Cloudflare /detect, or
  // the legacy Supabase-proxy path).
  const isCloudflareHttp = config.detectionMode === "backend-edgecrafter-http";
  const isLegacyHttp = config.detectionMode === "backend-deimv2";
  const isBackendMode =
    isCloudflareHttp || isLegacyHttp || config.detectionMode === "backend-edgecrafter-stream";
  const showFrameTest = isCloudflareHttp || isLegacyHttp;
  const liveBackendName = (backendStatus as BackendStatus | null)?.backend ?? null;
  const fallbackActive = !!(backendStatus as BackendStatus | null)?.fallbackUsed;

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
      const targetAspect = isMobileViewport(window.innerWidth) ? MOBILE_VISUAL_ASPECT : null;
      const captured = captureVideoFrameBase64(video, { targetAspect });
      if (!captured) {
        setBackendTest("Frame capture failed.");
        return;
      }
      const { image_b64, cw, ch } = captured;
      setBackendTestImg(`data:image/jpeg;base64,${image_b64}`);
      if (isCloudflareHttp) {
        // In HSE mode, send the SAME monitoring/reasoning context the live
        // stream uses so the test exercises the full worker contract.
        // Build/Plan stays detection-only.
        // Manual test must exercise Qwen — apply the same force_reason
        // override the heartbeat uses so the worker prefers Qwen reasoning
        // and the probe block reports `manual force_reason sent: yes`.
        const monitoringRequest =
          appMode === "hse"
            ? {
                ...buildHseDetectRequest(hse.profile, hse.roi, "manual-test"),
                reasoningPreferencesOverride: {
                  force_reason: true,
                  prefer_low_latency: true,
                  require_visual_evidence: true,
                  allow_no_active_risk: true,
                  return_scene_risks: true,
                  return_linked_entities: true,
                  return_reasoner_status: true,
                  return_scene_context: true,
                  return_semantic_corrections: true,
                  avoid_repeating_unconfirmed_risks: true,
                  verify_current_frame_before_reusing_cached_risk: true,
                },
              }
            : null;
        const t0 = performance.now();
        const resp = await postDetectFrame(image_b64, {
          conf: 0.15,
          monitoringRequest,
        });
        const latency = Math.round(performance.now() - t0);
        if (appMode === "hse") {
          const parsed = hasRiskAwareData(resp) ? parseDetectRiskFields(resp) : null;
          const forceReasonSent =
            (
              monitoringRequest?.reasoningPreferencesOverride as
                | { force_reason?: unknown }
                | undefined
            )?.force_reason === true;
          const summary = summarizeDetectResponse(resp, parsed, {
            latencyMs: latency,
            proxy: "cloudflare",
            transport: "http-cloudflare",
            forceReasonSent,
          });
          const diag = computeQwenDiagnostic(summary);
          setBackendTest(
            `capture ${cw}×${ch} · round-trip ${latency} ms\n\n${formatDetectSummary(
              summary,
            )}\n\nRoute status:\n${formatRouteStatus(summary, diag)}\n\n${diag.message}`,
          );
        } else {
          setBackendTest(
            `capture ${cw}×${ch} · round-trip ${latency} ms\n${JSON.stringify(resp, null, 2)}`,
          );
        }
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
  }, [videoRef, isCloudflareHttp, appMode, hse.profile, hse.roi]);

  // Plan Mode shows the holographic planning console (the two mockups): the
  // chrome panels arrange AROUND the unchanged camera card. We extract the
  // camera card node and either render it bare (HSE/Build) or hand it to
  // PlanConsole as its center slot — the card's sizing/coordinate system is
  // never wrapped or altered.
  const planConsoleActive = appMode === "plan";
  const cameraCard = (
    <div className="console-panel overflow-hidden p-2 sm:p-3 xl:col-start-1 xl:row-start-1">
      <CameraView
        videoRef={videoRef}
        active={active}
        starting={starting}
        error={error}
        boxes={liveBoxes}
        running={running}
        topAlert={appMode === "hse" && !hseFlags.localAlertsEnabled ? null : topAlert}
        language={config.language}
        facing={facing}
        onEnable={() => startCamera()}
        onFlip={flip}
        poseStatus={poseStatus}
        debug={debug}
        showSkeleton={import.meta.env.DEV}
        backendEntities={
          appMode === "hse"
            ? hseRiskViewModel.overlayEntities
            : (backendEntities as BackendEntity[])
        }
        backendPoses={
          appMode === "hse" ? hseRiskViewModel.overlayPoses : (backendPoses as BackendPose[])
        }
        rawBackendEntityCount={
          appMode === "hse" ? (backendEntities as BackendEntity[]).length : undefined
        }
        rawBackendPoseCount={appMode === "hse" ? (backendPoses as BackendPose[]).length : undefined}
        riskLinkedEntityCount={
          appMode === "hse" ? hseRiskViewModel.activeRiskEntityCount : undefined
        }
        riskLinkedPoseCount={appMode === "hse" ? hseRiskViewModel.riskLinkedPoseCount : undefined}
        statusEntityCount={appMode === "hse" ? hseRiskViewModel.statusEntityCount : undefined}
        // Dry-run debug overlays (raw entity boxes, the fuchsia pose skeleton
        // and the entity/pose count chip) belong to HSE monitoring only. In
        // Build/Plan they just clutter the camera on top of the clean
        // ExtractableCandidateOverlay selection boxes, so suppress them there.
        backendDryRun={isBackendMode && !buildModeOn}
        riskAwareOverlay={riskFlags.riskAwareOverlay && !buildModeOn}
        overlayMode={appMode === "hse" ? "hse-status" : "normal"}
        privacyNotice={
          riskFlags.cameraPrivacyNotice && !buildModeOn ? <CameraPrivacyNotice /> : undefined
        }
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
                  mirrored={mirrored}
                />
              )}
              <SelectionOverlay
                active={build.phase === "selecting"}
                onSelect={(region) => void build.lockSelection(region)}
                mirrored={mirrored}
              />
              <HandPointerLayer
                landmarks={hand.handLandmarks}
                primaryId={hand.primaryPointer?.id}
                pinch={mp.pinch}
                hint={fingerHint}
                mirrored={mirrored}
              />
              {/* Mini countdown clock while a pinch is HELD on a detected
                      box — extraction fires only when the ring completes. */}
              {extractHold && (
                <div
                  className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[130%]"
                  style={{
                    left: `${(mirrored ? 1 - extractHold.x : extractHold.x) * 100}%`,
                    top: `${extractHold.y * 100}%`,
                  }}
                >
                  <PinchHoldRing progress={extractHold.progress} label="creating blueprint…" />
                </div>
              )}
              {/* Source marker stays on the real object once the ghost detaches. */}
              {build.region &&
                ["placing", "pinned", "recording", "review"].includes(build.phase) && (
                  <SelectedRegionMarker region={build.region} mirrored={mirrored} />
                )}
              {/* In-camera Record/Stop targets: a full pinch-hold or dwell
                      on the target triggers — never instant. */}
              {isRecordTargetPhase(build.phase) && (
                <ARRecordButton
                  variant="record"
                  pointer={hand.primaryPointer}
                  pinch={hand.sourceMode === "mediapipe" ? mp.pinch : null}
                  onTrigger={build.startProcedureRecording}
                />
              )}
              {isStopTargetPhase(build.phase) && (
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
                  onDelete={build.reset}
                  onHandInteraction={onHandInteraction}
                  onBounds={setGhostBounds}
                  // Build keeps a clean minimal ghost (crop + outline only)
                  // until review; Plan shows the guidance markers — but a
                  // multi-object scene draws its own holographic guidance,
                  // so the single-object markers are suppressed then.
                  showGuidanceMarkers={
                    !planScene && (appMode !== "build" || build.phase === "review")
                  }
                  mirrored={mirrored}
                />
              )}
              {/* Holographic Scene Canvas — ALL detected objects, one
                      animating per step. Replaces the single-object guidance
                      overlay/callouts whenever a plan-scene-v1 frame is present. */}
              {planScene && build.region && (
                <PlanHologramRenderer
                  scene={planScene}
                  region={build.region}
                  mirrored={mirrored}
                  assetImage={
                    ghostAsset?.imageB64
                      ? `data:image/jpeg;base64,${ghostAsset.imageB64}`
                      : ghostAsset?.thumbnailB64
                        ? `data:image/jpeg;base64,${ghostAsset.thumbnailB64}`
                        : undefined
                  }
                />
              )}
              {/* Readable instruction text as external callout cards with
                      leader lines back to the blueprint markers — never trapped
                      inside the crop. */}
              {/* Callout cards: Plan shows them while guiding; Build stays
                      clean and only shows notes in review. Suppressed when the
                      holographic scene canvas is showing (it has its own card). */}
              {!planScene &&
                build.region &&
                ["placing", "pinned", "recording", "review"].includes(build.phase) &&
                (appMode === "plan" || build.phase === "review") && (
                  <BlueprintCalloutLayer
                    frame={ghostFrame}
                    bounds={ghostBounds}
                    mode={appMode === "plan" ? "plan" : "build"}
                    onReplyRequest={() => setPlanReplyOpen(true)}
                  />
                )}
            </>
          ) : null
        }
        hseOverlay={
          hseActive && hseFlags.localAlertsEnabled ? (
            <>
              <WearableAlertOverlay severity={hse.visibleTopAlert?.severity ?? null} />
              <EagleVisionHUD
                tracks={hse.tracks}
                poses={backendPoses as BackendPose[]}
                topAlert={hse.visibleTopAlert}
                status={hse.status}
                objectCount={hse.objectCount}
                stableCount={hse.stableCount}
                reasoningSource={hse.reasoningSource}
                mirrored={mirrored}
              />
              {focusArmed && (
                <button
                  type="button"
                  className="absolute inset-0 z-30 cursor-crosshair bg-cyan-400/5"
                  aria-label="Tap an area to focus the scan"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    // visual tap → RAW frame space (the ROI the worker scans)
                    const vx = (e.clientX - r.left) / r.width;
                    hse.focusAt(mirrored ? 1 - vx : vx, (e.clientY - r.top) / r.height);
                    setFocusArmed(false);
                  }}
                />
              )}
            </>
          ) : null
        }
      />
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <LiveModeHeader
        mode={appMode}
        running={running}
        cameraActive={active}
        backendName={liveBackendName}
        fallbackActive={fallbackActive}
        objectCount={appMode === "hse" ? hse.objectCount : candidates.length}
        alertCount={alerts.length}
        topRisk={
          appMode === "hse"
            ? (hse.visibleTopAlert?.title ?? hseRiskViewModel.priorityRisks[0]?.hazardLabel ?? null)
            : null
        }
      />

      <div
        className={
          planConsoleActive
            ? "space-y-4"
            : "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-5"
        }
      >
        {/* min-w-0: this grid item defaults to min-width:auto, so any non-wrapping
            child (e.g. the debug panel's 1500-char `raw:` line) would blow the
            column out to ~10000px — pushing the centered camera card off-screen
            and making it "jump" as the text length changes each frame. In Plan
            mode the holographic console owns the full width and `xl:contents` is
            dropped so its rails lay out around the camera. */}
        <div
          className={
            planConsoleActive ? "min-w-0 space-y-4" : "min-w-0 space-y-3 sm:space-y-4 xl:contents"
          }
        >
          {/* Plan Mode: the holographic console wraps the camera card as its
              center slot (the card's coordinate system is untouched). HSE/Build:
              the bare camera card sits in column 1. */}
          {planConsoleActive ? (
            <PlanConsole
              session={build}
              camera={cameraCard}
              fallbackSafetyNote={ghostFrame?.safetyWarning}
              fallbackQualityCheck={ghostFrame?.qualityCheck}
            />
          ) : (
            cameraCard
          )}
          <div className={planConsoleActive ? undefined : "xl:col-start-1 xl:row-start-2"}>
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
                      variant="secondary"
                      className={`min-h-12 shrink-0 rounded-xl px-3 ${
                        appMode === "build"
                          ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-300/15"
                          : ""
                      }`}
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
                      variant="secondary"
                      className={`min-h-12 shrink-0 rounded-xl px-3 ${
                        appMode === "plan"
                          ? "border-violet-300/30 bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/15"
                          : ""
                      }`}
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
          </div>

          <aside
            className={
              planConsoleActive
                ? "min-w-0 space-y-3"
                : "min-w-0 space-y-3 xl:sticky xl:top-7 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:max-h-[calc(100vh-3.5rem)] xl:overflow-y-auto xl:pr-1"
            }
          >
            {appMode === "hse" && !running && (
              <div className="console-panel p-4">
                <p className="console-eyebrow">Eagle Vision</p>
                <h2 className="mt-1 font-display text-base font-semibold">
                  Ready for a safety scan
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Start monitoring to detect people, vehicles, PPE, restricted zones, and unsafe
                  proximity.
                </p>
              </div>
            )}

            {hseActive && (
              <HseMonitoringPanel
                hse={hse}
                focusArmed={focusArmed}
                onArmFocus={() => setFocusArmed(true)}
                viewModel={hseRiskViewModel}
                localAlertsEnabled={hseFlags.localAlertsEnabled}
              />
            )}

            {/* Risk-aware UI (feature-flagged). When the flags are off these are
                never rendered, so the layout is unchanged. Read-only surfacing —
                never converts a draft/VLM risk into an incident or CAPA. */}
            {showDegradedBanner && <MonitoringDegradedBanner />}
            {showSceneRiskPanel && <SceneRiskPanel viewModel={hseRiskViewModel} />}

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
                replyOpen={planReplyOpen}
                onReplyOpenChange={setPlanReplyOpen}
                hideSceneNavigator={planConsoleActive}
              />
            )}

            {/* Restricted-zone editor */}
            <div className="console-panel p-4">
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

            {/* Mobile-only alerts trigger — hidden in HSE mode unless legacy
                local alerts are explicitly enabled. */}
            {(appMode !== "hse" || hseFlags.localAlertsEnabled) && (
              <div className="xl:hidden">
                <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      className="console-panel flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-colors hover:border-cyan-300/20"
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
            )}

            {((import.meta.env.DEV && !!debug) || isBackendMode) && (
              <details className="console-panel group p-3">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  <span className="flex items-center gap-2">
                    <Bug className="h-4 w-4 text-violet-300" />
                    Diagnostics
                  </span>
                  <span className="text-[10px] uppercase tracking-wider group-open:text-cyan-300">
                    Expand
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
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
                      {/* Risk-aware diagnostics (degradation_mode, privacy blur,
                          reasoner availability, schema warnings) — flag-gated. */}
                      {riskFlags.riskDebugPanel && risk && <RiskDebugPanel risk={risk} />}
                      {/* Reasoner Contract Probe — dev-only, HSE mode only.
                          Diagnostic only: never creates alerts/boxes/incidents. */}
                      {import.meta.env.DEV && appMode === "hse" && (
                        <ReasonerContractProbe
                          parsedRisk={parsedRiskForVm}
                          rawResp={
                            heartbeatRaw ??
                            (() => {
                              const raw = (backendStatus as BackendStatus | null)?.lastRawResponse;
                              if (typeof raw !== "string" || !raw) return null;
                              try {
                                return JSON.parse(raw);
                              } catch {
                                return null;
                              }
                            })()
                          }
                          status={(backendStatus as BackendStatus | null) ?? null}
                          localAlertsEnabled={hseFlags.localAlertsEnabled}
                          riskLinkedEntityCount={hseRiskViewModel.riskLinkedEntityCount}
                          riskLinkedPoseCount={hseRiskViewModel.riskLinkedPoseCount}
                          forceReasonSent={heartbeatForceReasonSent}
                        />
                      )}
                      {import.meta.env.DEV && appMode === "hse" && (
                        <HeartbeatDiagnosticsPanel
                          enabled={hseActive && heartbeatFlags.enabled}
                          intervalMs={heartbeatFlags.intervalMs}
                          backoffMs={heartbeatFlags.backoffMs}
                          extendedBackoffMs={heartbeatFlags.extendedBackoffMs}
                          extendedBackoffAfter={heartbeatFlags.extendedBackoffAfter}
                          forceReason={heartbeatFlags.forceReason}
                          currentSessionId={currentHeartbeatSessionId}
                          lastDiagnostic={heartbeatLastDiag}
                          counters={heartbeatCounters}
                          ignoreReason={hbIgnoreReason}
                          nowMs={nowMsForVm}
                        />
                      )}
                      {import.meta.env.DEV && appMode === "hse" && hbIgnoreReason && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-200">
                          {heartbeatIgnoreMessage(hbIgnoreReason)}
                        </div>
                      )}
                      {showFrameTest && (
                        <div className="rounded-xl border border-border bg-background/40 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              Vision dry-run · single-frame test
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={testBackendFrame}
                              disabled={!active || backendTesting}
                            >
                              {backendTesting ? "Testing…" : "Test detect frame"}
                            </Button>
                          </div>
                          {(backendTestImg || backendTest) && (
                            <div className="mt-2 space-y-2">
                              {backendTestImg && (
                                <div>
                                  <div className="mb-1 text-[10px] text-muted-foreground">
                                    captured frame sent to /detect (check it isn't
                                    black/blank/rotated):
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
              </details>
            )}
            {(appMode !== "hse" || hseFlags.localAlertsEnabled) && (
              <div className="console-panel hidden h-[360px] p-4 xl:block">
                <AlertFeed
                  alerts={alerts}
                  running={running}
                  language={config.language}
                  onDismiss={dismissAlert}
                />
              </div>
            )}
          </aside>
        </div>
      </div>

      <p className="pt-1 text-center text-[10px] text-muted-foreground/60">
        build {BUILD_MARKER} · {buildTime()} · {import.meta.env.MODE} · mode {config.detectionMode}
      </p>
    </div>
  );
}
