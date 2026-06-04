import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createDetector } from "@/lib/detection/detectorFactory";
import type { PoseDebug } from "@/lib/detection/poseGeometry";
import { RiskEngine } from "@/lib/detection/riskEngine";
import type { Alert, Detector, LiveBox } from "@/lib/detection/types";
import { HAZARDS, SEVERITY_META } from "@/lib/detection/hazardCatalog";
import { localizedMessage } from "@/lib/detection/messages";
import type { Json } from "@/integrations/supabase/types";
import type { AlertConfig } from "./useAlertSettings";

const FPS = 8;
const FRAME_MS = 1000 / FPS;

export interface SessionStats {
  frames: number;
  alerts: number;
  incidents: number;
}

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
 * snapshot). The detector is the simulated one today and swaps out cleanly.
 */
export function useDetectionSession({ video, config, captureSnapshot, onIncidentSaved }: Options) {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [liveBoxes, setLiveBoxes] = useState<LiveBox[]>([]);
  const [stats, setStats] = useState<SessionStats>({ frames: 0, alerts: 0, incidents: 0 });
  const [debug, setDebug] = useState<PoseDebug | null>(null);

  const detectorRef = useRef<Detector | null>(null);
  const engineRef = useRef<RiskEngine | null>(null);
  const timerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const framesRef = useRef(0);
  const configRef = useRef(config);
  const videoRef = useRef(video);
  const captureRef = useRef(captureSnapshot);
  const onSavedRef = useRef(onIncidentSaved);

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
        .then(() => onSavedRef.current?.(), () => undefined);
    },
    [user],
  );

  const tick = useCallback(async () => {
    const engine = engineRef.current;
    const det = detectorRef.current;
    if (!engine || !det) return;
    const now = performance.now();
    const obs = det.detect({
      video: videoRef.current,
      timestamp: now,
      enabledHazards: configRef.current.enabledHazards,
      sensitivity: configRef.current.sensitivity,
    });
    framesRef.current++;

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
      // Low-tier events are recorded silently; only medium+ surface in the feed.
      const surfaced = newAlerts.filter((a) => !a.silent);
      if (surfaced.length) setAlerts((prev) => [...surfaced, ...prev].slice(0, 40));
      setStats((s) => ({
        frames: framesRef.current,
        alerts: s.alerts + surfaced.length,
        incidents: s.incidents + surfaced.filter((a) => a.isIncident).length,
      }));
      for (const alert of newAlerts) {
        const detId = await persistDetection(alert);
        if (alert.isIncident) await persistIncident(alert, detId);
      }
      // Browser "supervisor" notification for high/critical (visual — not voice).
      const cfg = configRef.current;
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
    } else {
      setStats((s) => ({ ...s, frames: framesRef.current }));
    }

    if (import.meta.env.DEV) {
      const d = (detectorRef.current as { getDebug?: () => PoseDebug | null }).getDebug?.();
      setDebug(d ?? null);
    }
  }, [persistDetection, persistIncident]);

  const start = useCallback(async () => {
    if (timerRef.current) return;
    const detector = createDetector(configRef.current.detectionMode);
    await detector.start();
    detectorRef.current = detector;
    engineRef.current = new RiskEngine();
    framesRef.current = 0;
    setAlerts([]);
    setStats({ frames: 0, alerts: 0, incidents: 0 });

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

    setRunning(true);
    timerRef.current = window.setInterval(() => {
      void tick();
    }, FRAME_MS);
  }, [tick, user]);

  const stop = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    detectorRef.current?.stop();
    setRunning(false);
    setLiveBoxes([]);
    setDebug(null);
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
        .then(() => undefined, () => undefined);
    }
  }, [user]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { running, alerts, liveBoxes, stats, debug, start, stop, dismissAlert };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
