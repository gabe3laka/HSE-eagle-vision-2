import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { CameraFacing } from "@/hooks/useCamera";
import {
  finishBuildSession,
  lockBuildSelection,
  sendBuildFrame,
  startBuildSession,
} from "../api/buildModeClient";
import { requestPlanReasoning } from "../api/planReasoningClient";
import { BUILD_CAPTURE_INTERVAL_MS, BUILD_MAX_FRAMES, resolveBuildModeApiUrl } from "../config";
import { derivePlanStage } from "../lib/blueprint";
import {
  buildPlanReasoningPayload,
  mergePlanReasoning,
  resolveAssemblyPlan,
} from "../lib/planReasoning";
import { pseudoPointsForFrame } from "../lib/pseudoPointCloud";
import { captureRegionBase64 } from "../lib/regionCapture";
import { applyAssemblyPlanToScene, buildPlanSceneBlueprint } from "../lib/sceneBlueprint";
import { completeStep, nextStep, previousStep, resetSteps } from "../lib/planStepNav";
import { buildSourceAsset, rehydrateSavedBlueprint, toV2Frame } from "../lib/sourceAssets";
import type {
  BlueprintFrame,
  BlueprintPlacement,
  BlueprintSourceAsset,
  BlueprintTransform,
  BlueprintWorkflowMode,
  BuildBackendMode,
  BuildBackendStatus,
  BuildGesture,
  BuildHandLandmark,
  BuildPhase,
  BuildSessionInfo,
  BuildUserIntent,
  ExtractCandidate,
  PlanReasoningPayload,
  PlanSceneBlueprint,
  PlanTaskType,
  SavedBlueprint,
  SelectedRegion,
} from "../types";

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Build Mode toggle — leaving Build Mode resets any session in progress. */
  enabled: boolean;
  cameraFacing?: CameraFacing;
  /** Latest tracked hand/wrist landmarks — recorded into each keyframe. */
  getHandLandmarks?: () => BuildHandLandmark[];
  /** Current gesture (e.g. active pinch) — stamped into each keyframe. */
  getGesture?: () => BuildGesture | undefined;
  /** Build = record/document my work; Plan = guide me through work. The SAME
   *  engine serves both — this flag just rides on every payload/frame. */
  workflowMode?: BlueprintWorkflowMode;
  /** Plan mode: detected entities/segments + selected label, fed to the
   *  DeepSeek plan reasoner (never images). Build mode never calls it. */
  getPlanContext?: () =>
    | {
        detectedEntities?: PlanReasoningPayload["detectedEntities"];
        segments?: PlanReasoningPayload["segments"];
        selectedLabel?: string;
      }
    | undefined;
  /** Plan mode: the LIVE extraction candidates on screen at extraction time —
   *  used to build the holographic multi-object scene. Additive; Build ignores
   *  it. Returns the candidates in visible-card coords (the scene builder maps
   *  them region-local). */
  getPlanCandidates?: () => ExtractCandidate[] | undefined;
}

/**
 * Map a card-space extraction candidate into REGION-LOCAL 0..1 (the coordinate
 * system every BlueprintFrame field uses): translate by the region origin and
 * scale by its size. Pure; the scene builder clamps the result.
 */
function candidateToRegionLocal(
  candidate: ExtractCandidate,
  region: SelectedRegion,
): ExtractCandidate {
  if (region.w <= 0 || region.h <= 0) return candidate;
  const toLocal = (p: { x: number; y: number }) => ({
    x: (p.x - region.x) / region.w,
    y: (p.y - region.y) / region.h,
  });
  const tl = toLocal({ x: candidate.bbox.x, y: candidate.bbox.y });
  return {
    ...candidate,
    bbox: { x: tl.x, y: tl.y, w: candidate.bbox.w / region.w, h: candidate.bbox.h / region.h },
    ...(candidate.maskContour ? { maskContour: candidate.maskContour.map(toLocal) } : {}),
  };
}

/** True when a card-space candidate's CENTER falls inside the region (with a
 *  small tolerance) — keeps the scene to the objects in the selected area. */
function candidateInRegion(candidate: ExtractCandidate, region: SelectedRegion): boolean {
  const cx = candidate.bbox.x + candidate.bbox.w / 2;
  const cy = candidate.bbox.y + candidate.bbox.h / 2;
  const tol = 0.05;
  return (
    cx >= region.x - tol &&
    cx <= region.x + region.w + tol &&
    cy >= region.y - tol &&
    cy <= region.y + region.h + tol
  );
}

/**
 * Build a holographic scene blueprint from the live candidates (card coords)
 * and attach it to a base frame. Only candidates whose center sits inside the
 * selected region are included (so a manual single-object selection doesn't pull
 * in unrelated table objects clamped to the edge). When nothing qualifies the
 * frame is returned unchanged → the single-object Plan path still works. Pure.
 */
function attachSceneToFrame(
  frame: BlueprintFrame,
  region: SelectedRegion | null,
  candidates: ExtractCandidate[] | undefined,
): BlueprintFrame {
  if (!region || !candidates?.length) return frame;
  const inRegion = candidates.filter((c) => candidateInRegion(c, region));
  if (inRegion.length === 0) return frame;
  const local = inRegion.map((c) => candidateToRegionLocal(c, region));
  const sceneBlueprint = buildPlanSceneBlueprint({
    region,
    candidates: local,
    sourceAssetId: frame.sourceAssetId,
  });
  return { ...frame, sceneBlueprint };
}

/**
 * Build Mode session orchestrator — the blueprint-extraction workflow:
 *
 *   beginSelection() → user drags a box → lockSelection(region) locks the
 *   object + starts the Build session and WAITS in "selected" (no recording)
 *   → user pinches the selected box → extractBlueprint() captures ONE crop
 *   and creates the base blueprint frame ("extracting" → "placing") → the
 *   ghost follows the pinch; release → pinBlueprint(transform) ("pinned")
 *   → user presses Record Procedure → startProcedureRecording() starts the
 *   ~3 FPS keyframe timer ("recording": selected-crop only, one request in
 *   flight, hard cap, no video) → stopRecording() → "review"/replay.
 *
 * Completely separate from the HSE detection session — it only reads the same
 * <video> element.
 */
export function useBuildModeSession({
  videoRef,
  enabled,
  cameraFacing,
  getHandLandmarks,
  getGesture,
  workflowMode = "build",
  getPlanContext,
  getPlanCandidates,
}: Options) {
  const [phase, setPhase] = useState<BuildPhase>("idle");
  const [region, setRegion] = useState<SelectedRegion | null>(null);
  const [frames, setFrames] = useState<BlueprintFrame[]>([]);
  const [latestFrame, setLatestFrame] = useState<BlueprintFrame | null>(null);
  /** First blueprint frame extracted from the selected object (the ghost). */
  const [baseFrame, setBaseFrame] = useState<BlueprintFrame | null>(null);
  /** Where the ghost was pinned in camera-card space. */
  const [placement, setPlacement] = useState<BlueprintPlacement | null>(null);
  const [backendMode, setBackendMode] = useState<BuildBackendMode | null>(null);
  const [backendStatus, setBackendStatus] = useState<BuildBackendStatus>("resolving");
  const [error, setError] = useState<string | null>(null);
  /** Last extraction attempt — surfaced on-phone so failures are never silent. */
  const [extractStatus, setExtractStatus] = useState<
    "idle" | "extract_requested" | "capture_failed" | "frame_received" | "placing_started"
  >("idle");
  /** Which detected candidate the blueprint was extracted from (for debug/UI). */
  const [extractSource, setExtractSource] = useState<{ source: string; label: string } | null>(
    null,
  );
  /** Confirmed user goal (Plan mode) — guidance is withheld until this is set. */
  const [userIntent, setUserIntent] = useState<BuildUserIntent | null>(null);
  /** True while a fresh guided plan frame is being requested after intent. */
  const [generatingPlan, setGeneratingPlan] = useState(false);
  /** Where the latest Plan guidance came from (DeepSeek vs local rules). */
  const [reasoningStatus, setReasoningStatus] = useState<"idle" | "thinking" | "ok" | "fallback">(
    "idle",
  );
  /** User-gated holographic scene step pointer (Plan multi-object canvas). The
   *  scene itself rides on baseFrame.sceneBlueprint; this mirrors its active
   *  step so the panel/navigator can read it without digging into the frame. */
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Resolve the Build Mode API base when Build Mode turns on, so the panel can
  // show the backend status before the first selection.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setBackendStatus("resolving");
    void resolveBuildModeApiUrl().then((cfg) => {
      if (cancelled) return;
      setBackendStatus(
        cfg.url
          ? cfg.source === "supabase-config"
            ? "supabase-cloudflare"
            : "cloudflare"
          : "config-missing",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const sessionRef = useRef<BuildSessionInfo | null>(null);
  const regionRef = useRef<SelectedRegion | null>(null);
  const framesRef = useRef<BlueprintFrame[]>([]);
  /** v2 source assets: pixels stored ONCE per capture; frames reference by id.
   *  Transient — in memory only, cleared with the session. */
  const assetsRef = useRef<Map<string, BlueprintSourceAsset>>(new Map());
  const userIntentRef = useRef<BuildUserIntent | null>(null);
  /** Compact Plan conversation history (last few user/assistant turns) — sent
   *  with follow-ups so DeepSeek keeps context. */
  const historyRef = useRef<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const startedAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const extractingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionReadyRef = useRef<Promise<void> | null>(null);
  const phaseRef = useRef<BuildPhase>("idle");
  phaseRef.current = phase;

  /** Phase transition that updates the ref SYNCHRONOUSLY, so async chains like
   *  lockAndExtract (lock → extract in one flow) see the new phase before
   *  React re-renders. */
  const go = useCallback((next: BuildPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  // Ref-held so the capture interval always reads the freshest tracker output.
  const getHandLandmarksRef = useRef(getHandLandmarks);
  getHandLandmarksRef.current = getHandLandmarks;
  const getGestureRef = useRef(getGesture);
  getGestureRef.current = getGesture;
  const workflowModeRef = useRef(workflowMode);
  workflowModeRef.current = workflowMode;
  const getPlanContextRef = useRef(getPlanContext);
  getPlanContextRef.current = getPlanContext;
  const getPlanCandidatesRef = useRef(getPlanCandidates);
  getPlanCandidatesRef.current = getPlanCandidates;
  const baseFrameRef = useRef<BlueprintFrame | null>(null);
  baseFrameRef.current = baseFrame;
  const extractSourceRef = useRef<{ source: string; label: string } | null>(null);
  extractSourceRef.current = extractSource;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    sessionRef.current = null;
    sessionReadyRef.current = null;
    regionRef.current = null;
    framesRef.current = [];
    assetsRef.current = new Map();
    userIntentRef.current = null;
    historyRef.current = [];
    inFlightRef.current = false;
    extractingRef.current = false;
    go("idle");
    setRegion(null);
    setFrames([]);
    setLatestFrame(null);
    setBaseFrame(null);
    setPlacement(null);
    setBackendMode(null);
    setError(null);
    setExtractStatus("idle");
    setExtractSource(null);
    setUserIntent(null);
    setGeneratingPlan(false);
    setReasoningStatus("idle");
    setCurrentStepIndex(0);
  }, [clearTimer, go]);

  // Leaving Build Mode (or unmount) tears the session down.
  useEffect(() => {
    if (!enabled) reset();
    return clearTimer;
  }, [enabled, reset, clearTimer]);

  // Switching Build ↔ Plan reuses the same engine but starts a fresh session —
  // a half-finished Build recording shouldn't continue as a Plan session.
  const prevWorkflowRef = useRef(workflowMode);
  useEffect(() => {
    if (prevWorkflowRef.current !== workflowMode) {
      prevWorkflowRef.current = workflowMode;
      reset();
    }
  }, [workflowMode, reset]);

  const beginSelection = useCallback(() => {
    if (!enabled) return;
    clearTimer();
    go("selecting");
    setRegion(null);
    regionRef.current = null;
    setFrames([]);
    framesRef.current = [];
    assetsRef.current = new Map();
    userIntentRef.current = null;
    historyRef.current = [];
    setLatestFrame(null);
    setBaseFrame(null);
    setPlacement(null);
    setError(null);
    setExtractStatus("idle");
    setExtractSource(null);
    setUserIntent(null);
    setGeneratingPlan(false);
    setReasoningStatus("idle");
    setCurrentStepIndex(0);
  }, [enabled, clearTimer, go]);

  const cancelSelection = useCallback(() => {
    // beginSelection clears the region, so cancelling returns to idle.
    if (phaseRef.current === "selecting") go(regionRef.current ? "selected" : "idle");
  }, [go]);

  /**
   * Lock the selected object/work area: store the region, start the Build
   * session (HTTP or mock — startBuildSession never throws) and WAIT in
   * "selected". No recording timer here — the user pinches the glowing box
   * to pull the blueprint out. The session bootstrap is tracked in
   * sessionReadyRef so a fast pinch can't race the session creation.
   */
  const lockSelection = useCallback(
    async (sel: SelectedRegion) => {
      if (!enabled) return;
      setRegion(sel);
      regionRef.current = sel;
      setError(null);
      setExtractStatus("idle");
      setExtractSource(null);
      go("selected");
      const ready = (async () => {
        const session = await startBuildSession(workflowModeRef.current);
        sessionRef.current = session;
        setBackendMode(session.backendMode);
        // Refine the status with the actual session outcome: a configured URL
        // that fell back to mock is "mock-fallback"; a live http session keeps
        // its source-derived label.
        if (session.backendMode === "http") {
          setBackendStatus(
            session.configSource === "supabase-config" ? "supabase-cloudflare" : "cloudflare",
          );
        } else {
          setBackendStatus(session.configSource ? "mock-fallback" : "config-missing");
        }
        await lockBuildSelection(session, sel);
      })();
      sessionReadyRef.current = ready;
      await ready;
    },
    [enabled, go],
  );

  /** Capture + send ONE keyframe of the selected crop (shared by blueprint
   *  extraction and procedure recording). Null when the video isn't ready. */
  const captureKeyframe = useCallback(
    async (index: number, timestampMs: number): Promise<BlueprintFrame | null> => {
      const video = videoRef.current;
      const session = sessionRef.current;
      const sel = regionRef.current;
      if (!video || !session || !sel || video.readyState < 2 || !video.videoWidth) return null;
      const crop = captureRegionBase64(video, sel);
      if (!crop) return null;
      const frame = await sendBuildFrame(
        session,
        {
          sessionId: session.sessionId,
          frameId: `f-${index}`,
          timestampMs,
          selectedRegion: sel,
          image_b64: crop.image_b64,
          cameraFacing,
          viewport:
            typeof window !== "undefined"
              ? { w: window.innerWidth, h: window.innerHeight }
              : undefined,
          handLandmarks: getHandLandmarksRef.current?.(),
          gesture: getGestureRef.current?.(),
          workflowMode: workflowModeRef.current,
          userIntent: userIntentRef.current ?? undefined,
        },
        index,
      );
      // The crop we already captured IS the ghost's object image: keep it
      // locally (transient, in-memory only) so the overlay never needs
      // Cloudflare/RunPod to send pixels back. v2: pixels live ONCE in a
      // source asset (merged with any backend-returned mask) and the frame
      // carries only the reference — never repeated base64 per keyframe.
      const asset = buildSourceAsset({
        id: `${session.sessionId}-a${index}`,
        imageB64: crop.image_b64,
        size: { w: crop.cw, h: crop.ch },
        backendFrame: frame,
      });
      assetsRef.current.set(asset.id, asset);
      return toV2Frame(
        {
          ...frame,
          sourceImageSize: { w: crop.cw, h: crop.ch },
          sourceImageMode: "transient",
          maskSource: frame.maskSource ?? "none",
          workflowMode: frame.workflowMode ?? workflowModeRef.current,
        },
        asset.id,
      );
    },
    [videoRef, cameraFacing],
  );

  /**
   * Pinch-on-the-box → pull the blueprint out: capture the selected crop ONCE
   * and create the base blueprint frame ("extracting" → "placing"). No
   * recording timer starts here; on failure the box stays pinchable.
   */
  const extractBlueprint = useCallback(async (): Promise<BlueprintFrame | null> => {
    if (phaseRef.current !== "selected" || extractingRef.current) return null;
    extractingRef.current = true;
    setExtractStatus("extract_requested");
    go("extracting");
    setError(null);
    try {
      // A fast pinch right after selection must not race the session bootstrap.
      if (sessionReadyRef.current) await sessionReadyRef.current.catch(() => undefined);
      const frame = await captureKeyframe(0, 0);
      if (!frame) {
        setExtractStatus("capture_failed");
        setError("capture failed — try reselecting the object");
        go("selected"); // box stays pinchable; the user can try again
        return null;
      }
      setExtractStatus("frame_received");
      // Plan mode: build the holographic multi-object scene from the live
      // candidates on screen and attach it to the base frame (additive — Build
      // and the single-object Plan path are untouched). Coordinates are mapped
      // region-local 0..1 and clamped by the pure builder.
      const withScene =
        workflowModeRef.current === "plan"
          ? attachSceneToFrame(frame, regionRef.current, getPlanCandidatesRef.current?.())
          : frame;
      setCurrentStepIndex(0);
      setBaseFrame(withScene);
      setLatestFrame(withScene);
      go("placing");
      setExtractStatus("placing_started");
      return withScene;
    } finally {
      extractingRef.current = false;
    }
  }, [captureKeyframe, go]);

  /**
   * MAIN extraction path: a pinched DETECTED box (HSE livebox / EdgeCrafter
   * entity) becomes the Build region and its blueprint is extracted in one
   * motion — set region → start/lock the Build session (awaited, no race) →
   * capture one crop → sendBuildFrame → baseFrame → "placing". The synced
   * phaseRef makes the lock → extract chain deterministic.
   */
  const extractFromRegion = useCallback(
    async (
      sel: SelectedRegion,
      meta?: { source?: string; label?: string },
    ): Promise<BlueprintFrame | null> => {
      if (!enabled) return null;
      if (phaseRef.current !== "idle" && phaseRef.current !== "selected") return null;
      await lockSelection(sel); // clears stale state, ensures session is ready
      setExtractSource(meta ? { source: meta.source ?? "manual", label: meta.label ?? "" } : null);
      return extractBlueprint();
    },
    [enabled, lockSelection, extractBlueprint],
  );

  /** Ghost released after dragging — remember where it was pinned. Re-drags
   *  while pinned/recording/review just update the stored placement. */
  const pinBlueprint = useCallback(
    (transform: BlueprintTransform) => {
      setPlacement({ transform, pinnedAtMs: Date.now() });
      if (phaseRef.current === "placing") go("pinned");
    },
    [go],
  );

  /** One capture tick of the procedure recording. */
  const captureTick = useCallback(async () => {
    if (inFlightRef.current) return; // one request at a time — never a queue
    if (framesRef.current.length >= BUILD_MAX_FRAMES) {
      void stopRecordingRef.current?.(); // hard cap — keyframes only, never video
      return;
    }
    inFlightRef.current = true;
    try {
      const index = framesRef.current.length;
      const frame = await captureKeyframe(index, Date.now() - startedAtRef.current);
      if (!frame) return;
      if (phaseRef.current !== "recording") return; // stopped while in flight
      framesRef.current = [...framesRef.current, frame];
      setFrames(framesRef.current);
      setLatestFrame(frame);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, [captureKeyframe]);

  /**
   * "Record Procedure" — only from "pinned". Starts the repeating keyframe
   * timer that captures the REAL work happening in the ORIGINAL selected
   * region (never the dragged ghost position).
   */
  const startProcedureRecording = useCallback(() => {
    if (phaseRef.current !== "pinned") return;
    framesRef.current = [];
    setFrames([]);
    setLatestFrame(baseFrame);
    startedAtRef.current = Date.now();
    go("recording");
    clearTimer();
    timerRef.current = setInterval(() => void captureTick(), BUILD_CAPTURE_INTERVAL_MS);
  }, [baseFrame, captureTick, clearTimer, go]);

  const stopRecording = useCallback(async () => {
    clearTimer();
    const session = sessionRef.current;
    go("review");
    if (session) {
      try {
        await finishBuildSession(session);
      } catch {
        // mock fallback already recorded everything locally
      }
    }
  }, [clearTimer, go]);
  const stopRecordingRef = useRef<typeof stopRecording | null>(null);
  stopRecordingRef.current = stopRecording;

  /** Resolve a frame's v2 source asset (transient pixel store lookup). */
  const getAsset = useCallback(
    (id?: string | null): BlueprintSourceAsset | undefined =>
      id ? assetsRef.current.get(id) : undefined,
    [],
  );

  const pushHistory = (role: "user" | "assistant", text: string) => {
    if (!text) return;
    historyRef.current = [...historyRef.current, { role, text }].slice(-6);
  };

  /**
   * Plan reasoning: take the worker's geometry frame as the visual base and ask
   * the DeepSeek-backed Supabase function (with a local rules fallback) for the
   * plan — steps, overlays, virtual points, notes — then MERGE it onto the
   * frame (worker geometry is never replaced). `recapture` grabs a fresh crop
   * (first confirm); follow-ups reuse the existing base frame.
   */
  const runPlanReasoning = useCallback(
    async (intent: BuildUserIntent, recapture: boolean, followUpText?: string) => {
      const ph = phaseRef.current;
      if (ph !== "placing" && ph !== "pinned" && ph !== "review") return;
      setGeneratingPlan(true);
      try {
        let base = recapture ? await captureKeyframe(0, 0) : baseFrameRef.current;
        if (!base) return;
        if (recapture) {
          // Carry the just-built holographic scene onto the fresh crop (or
          // rebuild it from the current candidates) so multi-object planning
          // survives the confirm-intent recapture.
          if (workflowModeRef.current === "plan") {
            base = baseFrameRef.current?.sceneBlueprint
              ? { ...base, sceneBlueprint: baseFrameRef.current.sceneBlueprint }
              : attachSceneToFrame(base, regionRef.current, getPlanCandidatesRef.current?.());
          }
          setBaseFrame(base);
          setLatestFrame(base);
        }
        // Build mode never reasons — it stays simple (extract / pin / record).
        if (workflowModeRef.current !== "plan") return;
        setReasoningStatus("thinking");
        const ctx = getPlanContextRef.current?.();
        const payload = buildPlanReasoningPayload({
          sessionId: sessionRef.current?.sessionId ?? "plan",
          intent,
          frame: base,
          region: regionRef.current,
          selectedLabel: ctx?.selectedLabel ?? extractSourceRef.current?.label,
          detectedEntities: ctx?.detectedEntities,
          segments: ctx?.segments,
          sceneObjects: base.sceneBlueprint?.objects,
          followUpText,
          history: historyRef.current,
        });
        const resp = await requestPlanReasoning(payload);
        if (phaseRef.current === "idle" || phaseRef.current === "selecting") return; // reset mid-flight
        const merged = mergePlanReasoning(base, resp);
        // Before worker depth exists, fall back to local contour pseudo-points
        // (an honest 2.5D layer — depthSource "none", never claimed as 3D).
        if ((merged.virtualBlueprintPoints?.length ?? 0) === 0) {
          merged.virtualBlueprintPoints = pseudoPointsForFrame(base);
          merged.depthSource = merged.depthSource ?? "none";
        }
        // Holographic scene canvas: re-derive the ordered assembly steps + each
        // object's target from the reasoner's plan (or the single-object steps
        // mapped into a plan). Resets the scene to step 1 (no auto-advance).
        if (merged.sceneBlueprint) {
          const plan = resolveAssemblyPlan(resp);
          merged.sceneBlueprint = applyAssemblyPlanToScene(merged.sceneBlueprint, plan);
          setCurrentStepIndex(merged.sceneBlueprint.currentStepIndex);
        }
        pushHistory("assistant", resp.nextAction || resp.detectedIntent);
        setBaseFrame(merged);
        setLatestFrame(merged);
        setReasoningStatus(resp.status === "ok" && resp.source === "deepseek" ? "ok" : "fallback");
      } finally {
        setGeneratingPlan(false);
      }
    },
    [captureKeyframe],
  );

  /**
   * Plan mode: the user answered "What do you want to do with this item?".
   * The confirmed intent rides on every payload; we immediately run the plan
   * reasoner so step 1 + overlays + virtual points appear right away
   * ("plan_generating_steps" → "plan_guiding").
   */
  const confirmIntent = useCallback(
    async (taskType?: PlanTaskType, text?: string) => {
      const intent: BuildUserIntent = { taskType, text, confirmed: true };
      userIntentRef.current = intent;
      setUserIntent(intent);
      setReasoningStatus("idle");
      historyRef.current = [];
      pushHistory("user", text ?? taskType ?? "");
      await runPlanReasoning(intent, true);
    },
    [runPlanReasoning],
  );

  /**
   * Plan mode follow-up question / new goal text — re-reason over the SAME
   * extracted blueprint (no re-capture, history included) and re-merge.
   */
  const askFollowUp = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      const prev = userIntentRef.current;
      const intent: BuildUserIntent = { taskType: prev?.taskType, text: t, confirmed: true };
      userIntentRef.current = intent;
      setUserIntent(intent);
      pushHistory("user", t);
      await runPlanReasoning(intent, false, t);
    },
    [runPlanReasoning],
  );

  /** Plan mode: drop the confirmed goal so the chooser reappears (the "change"
   *  affordance). Guidance is withheld again until a new goal is picked. */
  const clearIntent = useCallback(() => {
    userIntentRef.current = null;
    historyRef.current = [];
    setUserIntent(null);
    setGeneratingPlan(false);
    setReasoningStatus("idle");
  }, []);

  /**
   * Apply a pure transform to the holographic scene blueprint on the current
   * base frame (and the latest frame when it shares the same scene), then mirror
   * the new active step index into local state. The single mutation point for
   * user-gated step navigation — there is NO timer/auto-advance in Plan.
   */
  const applyToScene = useCallback(
    (transform: (scene: PlanSceneBlueprint) => PlanSceneBlueprint) => {
      const current = baseFrameRef.current?.sceneBlueprint;
      if (!current) return;
      const nextScene = transform(current);
      setCurrentStepIndex(nextScene.currentStepIndex);
      setBaseFrame((prev) =>
        prev && prev.sceneBlueprint === current ? { ...prev, sceneBlueprint: nextScene } : prev,
      );
      setLatestFrame((prev) =>
        prev && prev.sceneBlueprint === current ? { ...prev, sceneBlueprint: nextScene } : prev,
      );
    },
    [],
  );

  /** Plan multi-object canvas: advance to the next step (clamps on the last;
   *  marks the previous step completed). User-gated — no auto-advance. */
  const goToNextPlanStep = useCallback(() => applyToScene(nextStep), [applyToScene]);
  /** Plan multi-object canvas: step back to the previous step (clamps on first). */
  const goToPreviousPlanStep = useCallback(() => applyToScene(previousStep), [applyToScene]);
  /** Plan multi-object canvas: mark the current step done and advance. */
  const completeCurrentStep = useCallback(() => applyToScene(completeStep), [applyToScene]);
  /** Plan multi-object canvas: reset back to the first step. */
  const resetPlanSteps = useCallback(() => applyToScene(resetSteps), [applyToScene]);

  /**
   * Load a SAVED blueprint into the live session: region + ghost + replay
   * keyframes restored locally (no backend round-trip), the saved thumbnail
   * asset standing in for every frame's pixels. Lands in "review" when the
   * procedure has keyframes, else "pinned".
   */
  const loadSavedBlueprint = useCallback(
    (saved: SavedBlueprint) => {
      if (!enabled) return;
      clearTimer();
      const { asset, baseFrame: loadedBase, frames: loadedFrames } = rehydrateSavedBlueprint(saved);
      sessionRef.current = {
        sessionId: `loaded-${saved.id}`,
        backendMode: "mock",
        configSource: null,
        workflowMode: saved.workflowMode,
      };
      sessionReadyRef.current = Promise.resolve();
      regionRef.current = saved.region;
      setRegion(saved.region);
      assetsRef.current = new Map(asset ? [[asset.id, asset]] : []);
      framesRef.current = loadedFrames;
      setFrames(loadedFrames);
      setBaseFrame(loadedBase);
      setLatestFrame(loadedFrames[loadedFrames.length - 1] ?? loadedBase);
      setPlacement(
        saved.placement ?? { transform: { x: 0, y: 0, scale: 1 }, pinnedAtMs: Date.now() },
      );
      setBackendMode("mock");
      setError(null);
      setExtractStatus("frame_received");
      setExtractSource({ source: "saved", label: saved.name });
      userIntentRef.current = null;
      historyRef.current = [];
      setUserIntent(null);
      setGeneratingPlan(false);
      setReasoningStatus("idle");
      // Restore the holographic scene's active step (saved blueprints without a
      // sceneBlueprint load the old single-object way → index 0).
      setCurrentStepIndex(loadedBase.sceneBlueprint?.currentStepIndex ?? 0);
      go(loadedFrames.length > 0 ? "review" : "pinned");
    },
    [enabled, clearTimer, go],
  );

  // Plan-mode sub-state — gates the "ask for intent before guiding" flow.
  const planStage = derivePlanStage({
    phase,
    hasBaseFrame: baseFrame != null,
    intentConfirmed: !!userIntent?.confirmed,
    generating: generatingPlan,
  });

  // The holographic multi-object scene rides on the base frame; expose it (and
  // its active step) directly so the panel/navigator/overlay don't dig into the
  // frame. Null whenever no multi-object scene was built (single-object Plan or
  // Build) — those paths render the old way.
  const sceneBlueprint = baseFrame?.sceneBlueprint ?? null;

  return {
    phase,
    workflowMode,
    region,
    frames,
    latestFrame,
    baseFrame,
    placement,
    backendMode,
    backendStatus,
    error,
    extractStatus,
    extractSource,
    userIntent,
    generatingPlan,
    planStage,
    reasoningStatus,
    sceneBlueprint,
    currentStepIndex,
    frameCount: frames.length,
    beginSelection,
    cancelSelection,
    lockSelection,
    extractFromRegion,
    extractBlueprint,
    pinBlueprint,
    startProcedureRecording,
    stopRecording,
    getAsset,
    confirmIntent,
    askFollowUp,
    clearIntent,
    goToNextPlanStep,
    goToPreviousPlanStep,
    completeCurrentStep,
    resetPlanSteps,
    loadSavedBlueprint,
    reset,
  };
}

export type BuildModeSession = ReturnType<typeof useBuildModeSession>;
