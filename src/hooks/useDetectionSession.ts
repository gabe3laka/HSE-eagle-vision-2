import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/own-client";
import { useAuth } from "@/contexts/AuthContext";
import { createDetector } from "@/lib/detection/detectorFactory";
import type { PoseDebug, PoseStatus } from "@/lib/detection/poseGeometry";
import { RiskEngine } from "@/lib/detection/riskEngine";
import type { Alert, Detector, LiveBox } from "@/lib/detection/types";
import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { localizedMessage } from "@/lib/detection/messages";
// Local Json type — avoids depending on the managed-project types.ts file.
type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[];
import type { AlertConfig } from "./useAlertSettings";

// Frame scheduling: process actual video frames (requestVideoFrameCallback) when
// available, otherwise a timer. Target ~15 FPS but back off if detection is slow.
const TARGET_FPS = 15;
const MIN_INTERVAL_MS = 1000 / TARGET_FPS;
const MAX_INTERVAL_MS = 250; // adaptive-backoff floor of ~4 FPS

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface VideoFrameMeta {
  mediaTime?: number;
  presentedFrames?: number;
}
type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: (now: number, metadata: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};
function rvfcSupported(): boolean {
  return (
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  );
}

export interface SessionStats {
  frames: number;
  alerts: number;
  incidents: number;
}

export interface PerfMetrics {
  mode: "rvfc" | "timer";
  fps: number; // processed frames in the last second
  avgDetectionMs: number;
  maxDetectionMs: number;
  skippedFrames: number; // frames skipped to hit the target FPS / backoff
  staleFrames: number; // callbacks where the video frame had not advanced
  presentedFrames: number; // from requestVideoFrameCallback metadata
  mediaTime: number; // last processed video time
}

const EMPTY_PERF: PerfMetrics = {
  mode: "timer",
  fps: 0,
  avgDetectionMs: 0,
  maxDetectionMs: 0,
  skippedFrames: 0,
  staleFrames: 0,
  presentedFrames: 0,
  mediaTime: 0,
};

interface Options {
  video: HTMLVideoElement | null;
  config: AlertConfig;
  /** Best-effort capture of the current frame for incident snapshots. */
  captureSnapshot?: () => Promise<Blob | null>;
  onIncidentSaved?: () => void;
}

/**
 * Orchestrates the live loop: detector → risk engine → alerts, and persists
 * medium+ events as detections and high/critical events as incidents (with a
 * snapshot). Detection runs on actual video frames (requestVideoFrameCallback)
 * when supported, with a timer fallback; detection is synchronous and never
 * overlaps, while persistence is fire-and-forget so the loop stays responsive.
 */
export function useDetectionSession({ video, config, captureSnapshot, onIncidentSaved }: Options) {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [liveBoxes, setLiveBoxes] = useState<LiveBox[]>([]);
  const [stats, setStats] = useState<SessionStats>({ frames: 0, alerts: 0, incidents: 0 });
  const [debug, setDebug] = useState<PoseDebug | null>(null);
  const [perf, setPerf] = useState<PerfMetrics>(EMPTY_PERF);
  const [poseStatus, setPoseStatus] = useState<PoseStatus | null>(null);

  const detectorRef = useRef<Detector | null>(null);
  const engineRef = useRef<RiskEngine | null>(null);
  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const rvfcHandleRef = useRef<number | null>(null);
  const modeRef = useRef<"rvfc" | "timer">("timer");
  const sessionIdRef = useRef<string | null>(null);
  const framesRef = useRef(0);
  const configRef = useRef(config);
  const videoRef = useRef(video);
  const captureRef = useRef(captureSnapshot);
  const onSavedRef = useRef(onIncidentSaved);

  // scheduling / metrics state
  const lastMediaTimeRef = useRef(-1);
  const lastProcessedAtRef = useRef(0);
  const lastUiAtRef = useRef(0);
  const intervalRef = useRef(MIN_INTERVAL_MS);
  const detSamplesRef = useRef<number[]>([]);
  const maxDetRef = useRef(0);
  const processedTimesRef = useRef<number[]>([]);
  const skippedRef = useRef(0);
  const staleRef = useRef(0);
  const presentedRef = useRef(0);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    videoRef.current = video;
  }, [video]);
  useEffect(() => {
    captureRef.current = captureSnapshot;
  }, [captureSnapshot]);
  useEffect(() => {
    onSavedRef.current = onIncidentSaved;
  }, [onIncidentSaved]);

  const persistDetection = useCallback(
    async (alert: Alert): Promise<string | null> => {
      const sid = sessionIdRef.current;
      if (!sid || !user) return null;
      const { data } = await supabase
        .from("detections")
        .insert({
          owner_id: user.id,
          session_id: sid,
          hazard_type: alert.hazardType,
          severity: alert.severity,
          confidence: round3(alert.confidence),
          message: alert.message,
          bbox: (alert.bbox ?? null) as unknown as Json,
        })
        .select("id")
        .maybeSingle();
      return data?.id ?? null;
    },
    [user],
  );

  const persistIncident = useCallback(
    async (alert: Alert, detectionId: string | null) => {
      if (!user) return;
      let snapshotPath: string | null = null;
      try {
        const blob = await captureRef.current?.();
        if (blob) {
          const path = `${user.id}/${crypto.randomUUID()}.jpg`;
          const { error } = await supabase.storage
            .from("incident-snapshots")
            .upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (!error) snapshotPath = path;
        }
      } catch {
        /* snapshot is best-effort — never block the incident record */
      }
      await supabase
        .from("incidents")
        .insert({
          owner_id: user.id,
          session_id: sessionIdRef.current,
          detection_id: detectionId,
          hazard_type: alert.hazardType,
          severity: alert.severity,
          confidence: round3(alert.confidence),
          message: alert.message,
          zone_label: alert.zoneLabel ?? null,
          snapshot_path: snapshotPath,
        })
        .then(
          () => onSavedRef.current?.(),
          () => undefined,
        );
    },
    [user],
  );

  // One synchronous detection cycle. Never awaited by the scheduler, so there is
  // at most one detect() call running at a time; persistence is fire-and-forget.
  const cycle = useCallback(
    (now: number, mediaTime: number) => {
      const det = detectorRef.current;
      const engine = engineRef.current;
      if (!det || !engine) return;
      const cfg = configRef.current;

      const tDet0 = performance.now();
      const obs = det.detect({
        video: videoRef.current,
        timestamp: now,
        enabledHazards: cfg.enabledHazards,
        sensitivity: cfg.sensitivity,
      });
      const detMs = performance.now() - tDet0;
      framesRef.current++;

      // metrics
      const ds = detSamplesRef.current;
      ds.push(detMs);
      if (ds.length > 30) ds.shift();
      if (detMs > maxDetRef.current) maxDetRef.current = detMs;
      const pt = processedTimesRef.current;
      pt.push(now);
      while (pt.length && pt[0] < now - 1000) pt.shift();
      // adaptive backoff: widen the interval when detection is slower than budget
      intervalRef.current =
        detMs > MIN_INTERVAL_MS
          ? clamp(detMs * 1.3, MIN_INTERVAL_MS, MAX_INTERVAL_MS)
          : Math.max(MIN_INTERVAL_MS, intervalRef.current * 0.9);

      setLiveBoxes(
        obs.map((o) => ({
          hazardType: o.hazardType,
          severity: engine.currentSeverity(o.hazardType, o.trackKey) ?? "low",
          confidence: o.confidence,
          bbox: o.bbox,
        })),
      );

      const newAlerts = engine.update(obs, now);
      if (newAlerts.length) {
        const surfaced = newAlerts.filter((a) => !a.silent);
        if (surfaced.length) setAlerts((prev) => [...surfaced, ...prev].slice(0, 40));
        setStats((s) => ({
          frames: framesRef.current,
          alerts: s.alerts + surfaced.length,
          incidents: s.incidents + surfaced.filter((a) => a.isIncident).length,
        }));
        // Browser "supervisor" notification for high/critical (visual — not voice).
        if (
          cfg.notificationsEnabled &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          for (const alert of surfaced) {
            if (alert.severity === "high" || alert.severity === "critical") {
              try {
                new Notification(
                  `${SEVERITY_META[alert.severity].label}: ${HAZARDS[alert.hazardType].label}`,
                  { body: localizedMessage(alert.hazardType, cfg.language), tag: alert.hazardType },
                );
              } catch {
                /* notifications are best-effort */
              }
            }
          }
        }
        // persistence is fire-and-forget so it never stalls the detection loop
        void (async () => {
          for (const alert of newAlerts) {
            const detId = await persistDetection(alert);
            if (alert.isIncident) await persistIncident(alert, detId);
          }
        })();
      } else {
        setStats((s) => ({ ...s, frames: framesRef.current }));
      }

      // status + perf + dev debug, throttled to ~4/s to limit re-renders
      if (now - lastUiAtRef.current > 250) {
        lastUiAtRef.current = now;
        const avg = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
        setPoseStatus((det as { getStatus?: () => PoseStatus }).getStatus?.() ?? null);
        setPerf({
          mode: modeRef.current,
          fps: pt.length,
          avgDetectionMs: avg,
          maxDetectionMs: maxDetRef.current,
          skippedFrames: skippedRef.current,
          staleFrames: staleRef.current,
          presentedFrames: presentedRef.current,
          mediaTime,
        });
        if (import.meta.env.DEV) {
          setDebug((det as { getDebug?: () => PoseDebug | null }).getDebug?.() ?? null);
        }
      }
    },
    [persistDetection, persistIncident],
  );

  const start = useCallback(async () => {
    if (runningRef.current) return;
    const detector = createDetector(configRef.current.detectionMode);
    await detector.start();
    detectorRef.current = detector;
    engineRef.current = new RiskEngine();

    // reset counters + metrics
    framesRef.current = 0;
    detSamplesRef.current = [];
    maxDetRef.current = 0;
    processedTimesRef.current = [];
    skippedRef.current = 0;
    staleRef.current = 0;
    presentedRef.current = 0;
    lastMediaTimeRef.current = -1;
    lastProcessedAtRef.current = 0;
    lastUiAtRef.current = 0;
    intervalRef.current = MIN_INTERVAL_MS;
    setAlerts([]);
    setLiveBoxes([]);
    setStats({ frames: 0, alerts: 0, incidents: 0 });
    setPoseStatus(null);

    const v = videoRef.current;
    modeRef.current = rvfcSupported() && v ? "rvfc" : "timer";
    setPerf({ ...EMPTY_PERF, mode: modeRef.current });

    // ask once for permission to show "supervisor" notifications on high/critical
    if (
      configRef.current.notificationsEnabled &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().catch(() => undefined);
    }

    if (user) {
      const { data } = await supabase
        .from("monitoring_sessions")
        .insert({ owner_id: user.id, label: "Live session", status: "active" })
        .select("id")
        .maybeSingle();
      sessionIdRef.current = data?.id ?? null;
    }

    runningRef.current = true;
    setRunning(true);

    // Decide whether to process this callback, then run one cycle. Stale frames
    // (video not advanced) and over-budget frames (target FPS / backoff) are
    // counted and skipped.
    const step = (now: number, mediaTime: number, presented?: number) => {
      if (mediaTime === lastMediaTimeRef.current) {
        staleRef.current++;
        return;
      }
      if (now - lastProcessedAtRef.current < intervalRef.current) {
        skippedRef.current++;
        return;
      }
      lastMediaTimeRef.current = mediaTime;
      lastProcessedAtRef.current = now;
      if (presented !== undefined) presentedRef.current = presented;
      cycle(now, mediaTime);
    };

    const onVideoFrame = (now: number, metadata: VideoFrameMeta) => {
      if (!runningRef.current) return;
      const vid = videoRef.current;
      const mediaTime = metadata?.mediaTime ?? vid?.currentTime ?? 0;
      step(now, mediaTime, metadata?.presentedFrames);
      if (runningRef.current && vid && "requestVideoFrameCallback" in vid) {
        rvfcHandleRef.current = (vid as VideoWithRvfc).requestVideoFrameCallback(onVideoFrame);
      }
    };

    const onTimer = () => {
      if (!runningRef.current) return;
      const vid = videoRef.current;
      step(performance.now(), vid?.currentTime ?? 0);
      if (runningRef.current) timerRef.current = window.setTimeout(onTimer, intervalRef.current);
    };

    if (modeRef.current === "rvfc" && v && "requestVideoFrameCallback" in v) {
      rvfcHandleRef.current = (v as VideoWithRvfc).requestVideoFrameCallback(onVideoFrame);
    } else {
      timerRef.current = window.setTimeout(onTimer, intervalRef.current);
    }
  }, [cycle, user]);

  const stop = useCallback(async () => {
    runningRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const v = videoRef.current;
    if (rvfcHandleRef.current != null && v && "cancelVideoFrameCallback" in v) {
      try {
        (v as VideoWithRvfc).cancelVideoFrameCallback(rvfcHandleRef.current);
      } catch {
        /* ignore */
      }
    }
    rvfcHandleRef.current = null;
    detectorRef.current?.stop();
    setRunning(false);
    setLiveBoxes([]);
    setDebug(null);
    setPoseStatus(null);
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid && user) {
      await supabase
        .from("monitoring_sessions")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
          frames_processed: framesRef.current,
        })
        .eq("id", sid)
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }, [user]);

  useEffect(
    () => () => {
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      const v = videoRef.current;
      if (rvfcHandleRef.current != null && v && "cancelVideoFrameCallback" in v) {
        try {
          (v as VideoWithRvfc).cancelVideoFrameCallback(rvfcHandleRef.current);
        } catch {
          /* ignore */
        }
      }
    },
    [],
  );

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return {
    running,
    alerts,
    liveBoxes,
    stats,
    debug,
    perf,
    poseStatus,
    start,
    stop,
    dismissAlert,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
