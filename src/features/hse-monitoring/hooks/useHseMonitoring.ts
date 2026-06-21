import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/own-client";
import { useAuth } from "@/contexts/AuthContext";
import { mapToHseObservations } from "@/lib/detection/hseEntityMapper";
import { HSETracker } from "@/lib/detection/hseTracker";
import { runHseRules } from "@/lib/detection/hseRiskRules";
import {
  buildHseDetectRequest,
  HSE_LIVE_DETECT_REASON,
  HSE_PROFILES,
} from "@/lib/detection/hseDetectProfile";
import type {
  HSEActiveAlert,
  HSEDetectionProfile,
  HSEObservation,
  HSERoi,
  HSETrack,
} from "@/lib/detection/hseTypes";
import type {
  BackendEntity,
  BackendPose,
  BackendSegment,
  DetectionZone,
  LiveBox,
} from "@/lib/detection/types";
import { HSEAlertManager } from "../lib/hseAlertManager";
import { buildHseReasoningPayload } from "../lib/hseRiskReasoning";
import { requestHseReasoning } from "../api/hseRiskReasoningClient";
import { mapHseAlertToIncidentRow, shouldPersistHseAlert } from "../lib/hseIncidents";
import { BrowserVibrationAdapter, toWearableAlert } from "@/lib/wearable/wearableAlerts";

/**
 * Eagle Vision HSE monitoring orchestrator. Runs the wearable-ready pipeline
 * ALONGSIDE the existing RiskEngine/pose path (it never touches it):
 *
 *   backend detections → HSE observations → tracks → risk rules → alert manager
 *   → wearable haptics + HUD + (throttled) DeepSeek refinement + incidents
 *
 * Active only in HSE monitoring mode. DeepSeek runs at most every few seconds
 * and never blocks the immediate local alerts.
 */

const REASON_MIN_GAP_MS = 6000; // min spacing between DeepSeek calls
const REASON_IDLE_MS = 12000; // refresh reasoning at least this often if scene changed

type StatusLevel = "monitoring" | "scanning" | "risk" | "critical";

interface Options {
  enabled: boolean;
  backendEntities: BackendEntity[];
  backendPoses: BackendPose[];
  backendSegments: BackendSegment[];
  liveBoxes: LiveBox[];
  zones: DetectionZone[];
  backendName?: string | null;
  fallbackActive?: boolean;
  haptics?: boolean;
  setMonitoringRequest: (req: unknown) => void;
  /**
   * Gate the legacy local alert path (haptics, incidents, throttled DeepSeek
   * "Analyze scene"). When false (default), worker/reasoner scene risks are the
   * single source of truth for visible Live HSE alerts.
   */
  localAlertsEnabled?: boolean;
}

export function useHseMonitoring({
  enabled,
  backendEntities,
  backendPoses,
  backendSegments,
  liveBoxes,
  zones,
  backendName,
  fallbackActive,
  haptics = true,
  setMonitoringRequest,
  localAlertsEnabled = false,
}: Options) {
  const { user } = useAuth();
  const trackerRef = useRef(new HSETracker());
  const managerRef = useRef(new HSEAlertManager());
  const wearableRef = useRef(new BrowserVibrationAdapter());

  const [profile, setProfileState] = useState<HSEDetectionProfile>("balanced");
  const [roi, setRoiState] = useState<HSERoi | null>(null);
  const [tracks, setTracks] = useState<HSETrack[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<HSEActiveAlert[]>([]);
  const [reasoningSource, setReasoningSource] = useState<"deepseek" | "rules" | null>(null);
  const [sceneCaption, setSceneCaption] = useState<string>("");

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const roiRef = useRef(roi);
  roiRef.current = roi;
  const observationsRef = useRef<HSEObservation[]>([]);
  const tracksRef = useRef<HSETrack[]>([]);
  const lastReasonAtRef = useRef(0);
  const reasonInFlightRef = useRef(false);
  const lastSceneSigRef = useRef("");
  const farScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the detect-request metadata to the active detector whenever the
  // profile or ROI changes (worker may ignore it; the loop never breaks).
  useEffect(() => {
    if (!enabled) return;
    setMonitoringRequest(buildHseDetectRequest(profile, roi, HSE_LIVE_DETECT_REASON));
  }, [enabled, profile, roi, setMonitoringRequest]);

  // Reset everything when monitoring stops.
  useEffect(() => {
    if (enabled) return;
    trackerRef.current.reset();
    managerRef.current.reset();
    setTracks([]);
    setActiveAlerts([]);
    setReasoningSource(null);
    setSceneCaption("");
    setMonitoringRequest(null);
    if (farScanTimerRef.current) clearTimeout(farScanTimerRef.current);
  }, [enabled, setMonitoringRequest]);

  const ppeRequired = false; // no PPE policy configured yet — keep PPE cautious/off

  const persistIncident = useCallback(
    (alert: HSEActiveAlert) => {
      if (!user || !shouldPersistHseAlert(alert)) return;
      const row = mapHseAlertToIncidentRow(alert, user.id, null);
      void supabase
        .from("incidents")
        .insert(row)
        .then(
          () => undefined,
          () => undefined,
        );
    },
    [user],
  );

  // Run the reasoning request (DeepSeek via Supabase, rules fallback). Throttled
  // + non-blocking; merges the refined text/overlay onto the active alerts.
  const runReasoning = useCallback(
    async (candidates: ReturnType<typeof runHseRules>) => {
      if (reasonInFlightRef.current) return;
      reasonInFlightRef.current = true;
      lastReasonAtRef.current = Date.now();
      try {
        const payload = buildHseReasoningPayload({
          tracks: tracksRef.current,
          observations: observationsRef.current,
          zones,
          candidates,
          profile: profileRef.current,
        });
        const resp = await requestHseReasoning(payload, candidates);
        managerRef.current.mergeReasoning(resp.alerts);
        setReasoningSource(resp.source);
        if (resp.sceneCaption) setSceneCaption(resp.sceneCaption);
        setActiveAlerts(managerRef.current.list());
      } finally {
        reasonInFlightRef.current = false;
      }
    },
    [zones],
  );

  // The HSE tick — runs whenever the backend detections update (~4 Hz).
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    // When local alerts are off, never let legacy liveBoxes seed HSE
    // observations — they're the same source as the false "Worker near
    // vehicle" alerts and must not leak into the rule path even for tracking.
    const safeLiveBoxes = localAlertsEnabled ? liveBoxes : [];
    const observations = mapToHseObservations({
      entities: backendEntities,
      poses: backendPoses,
      segments: backendSegments,
      liveBoxes: safeLiveBoxes,
      timestampMs: now,
    });
    observationsRef.current = observations;
    const live = trackerRef.current.update(observations, now);
    tracksRef.current = live;
    setTracks(live);

    // Legacy local alert path is the only visible source of "Worker near
    // vehicle" et al. Default OFF — worker/reasoner scene risks are the single
    // source of truth. Set VITE_HSE_LOCAL_ALERTS_ENABLED=true to re-enable.
    if (!localAlertsEnabled) {
      setActiveAlerts((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const candidates = runHseRules({ tracks: live, observations, zones, ppeRequired });
    const { active, fired } = managerRef.current.ingest(candidates, now);
    setActiveAlerts(active);

    for (const a of fired) {
      if (haptics && a.wearablePattern !== "none") {
        void wearableRef.current.send(
          toWearableAlert({ id: a.id, severity: a.severity, spokenMessage: a.spokenMessage }),
        );
      }
      persistIncident(a);
    }

    // Throttled DeepSeek: a fresh medium+ alert, or a stale-but-changed scene.
    const sig = live
      .filter((t) => t.stable)
      .map((t) => t.category)
      .sort()
      .join(",");
    const hasSignificant = candidates.some(
      (c) => c.severity === "medium" || c.severity === "high" || c.severity === "critical",
    );
    const sinceReason = now - lastReasonAtRef.current;
    const sceneChanged = sig !== lastSceneSigRef.current;
    if (
      (hasSignificant && sinceReason > REASON_MIN_GAP_MS) ||
      (sceneChanged && sinceReason > REASON_IDLE_MS && candidates.length > 0)
    ) {
      lastSceneSigRef.current = sig;
      void runReasoning(candidates);
    }
  }, [
    enabled,
    backendEntities,
    backendPoses,
    backendSegments,
    liveBoxes,
    zones,
    haptics,
    ppeRequired,
    persistIncident,
    runReasoning,
    localAlertsEnabled,
  ]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const setProfile = useCallback((p: HSEDetectionProfile) => setProfileState(p), []);

  /** Temporarily switch to Far Scan for a few seconds, then revert. */
  const farScan = useCallback(() => {
    if (farScanTimerRef.current) clearTimeout(farScanTimerRef.current);
    const prev = profileRef.current === "far-scan" ? "balanced" : profileRef.current;
    setProfileState("far-scan");
    farScanTimerRef.current = setTimeout(() => setProfileState(prev), 8000);
  }, []);

  /** Tap-to-focus: set an ROI (inspection profile) around a tapped point. */
  const focusAt = useCallback((x: number, y: number) => {
    const w = 0.4;
    const h = 0.4;
    const region: HSERoi = {
      x: Math.max(0, Math.min(1 - w, x - w / 2)),
      y: Math.max(0, Math.min(1 - h, y - h / 2)),
      w,
      h,
    };
    setRoiState(region);
    setProfileState("inspection");
  }, []);

  const clearFocus = useCallback(() => {
    setRoiState(null);
    setProfileState("balanced");
  }, []);

  /** Manual "Analyze scene" — force a reasoning pass now. No-op when local
   *  alerts are disabled, so the legacy reasoning path can't leak even if a
   *  caller bypasses the UI gate. */
  const analyzeScene = useCallback(() => {
    if (!localAlertsEnabled) return;
    const candidates = runHseRules({
      tracks: tracksRef.current,
      observations: observationsRef.current,
      zones,
      ppeRequired,
    });
    void runReasoning(candidates);
  }, [localAlertsEnabled, zones, ppeRequired, runReasoning]);

  const acknowledge = useCallback((key: string) => {
    managerRef.current.acknowledge(key);
    setActiveAlerts(managerRef.current.list());
  }, []);

  const topAlert = activeAlerts.find((a) => a.state !== "resolved") ?? null;
  // When local alerts are disabled, no UI surface (HUD, wearable overlay,
  // header top-risk, camera top-alert banner) should consume `topAlert`.
  const visibleTopAlert = localAlertsEnabled ? topAlert : null;
  const status: StatusLevel = useMemo(() => {
    const sev = visibleTopAlert?.severity;
    if (sev === "critical") return "critical";
    if (sev === "high" || sev === "medium") return "risk";
    if (profile === "far-scan" || profile === "inspection") return "scanning";
    return "monitoring";
  }, [visibleTopAlert, profile]);

  const stableCount = tracks.filter((t) => t.stable).length;

  return {
    profile,
    setProfile,
    profileLabel: HSE_PROFILES[profile].label,
    roi,
    focusAt,
    clearFocus,
    farScan,
    analyzeScene,
    acknowledge,
    tracks,
    objectCount: tracks.length,
    stableCount,
    activeAlerts,
    topAlert,
    visibleTopAlert,
    localAlertsEnabled,
    status,
    reasoningSource,
    sceneCaption,
    backendName: backendName ?? null,
    fallbackActive: !!fallbackActive,
  };
}

export type HseMonitoring = ReturnType<typeof useHseMonitoring>;
