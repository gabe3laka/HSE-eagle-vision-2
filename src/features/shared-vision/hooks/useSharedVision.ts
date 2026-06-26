import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/own-client";
import { db } from "@/integrations/supabase/db";
import type { SvFrameMessage, SvRemoteRiskMessage, SvMessage, RemotePeerState } from "../types";
import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import type { SceneRisk, RiskSummary } from "@/lib/detection/riskTypes";
import type { ParsedDetectRisk } from "@/lib/detection/backendVisionHttpDetector";
import type { BackendStatus } from "@/lib/detection/backendVisionDetector";

const PEER_TTL_MS = 5_000;
const FRAME_GATE_MS = 300;
const RISK_GATE_MS = 1_500;
const RISK_EXPIRE_MS = 8_000;

const DEVICE_ID_KEY = "hse_device_id";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function makeDefaultCalibration(): SvFrameMessage["calibration"] {
  return {
    status: "uncalibrated",
    method: "none",
    confidence: null,
    transformId: null,
    expiresAt: null,
  };
}

function makeDefaultProjection(): SvFrameMessage["projection"] {
  return { localizable: false, coordinateSpace: "remote_image", confidence: null };
}

export interface UseSharedVisionOptions {
  enabled: boolean;
  orgId: string | null;
  userId: string | undefined;
  deviceLabel: string | null;
  backendEntities: BackendEntity[];
  backendPoses: BackendPose[];
  backendRisk: ParsedDetectRisk | null;
  backendStatus?: BackendStatus | null;
  capture: {
    w: number | null;
    h: number | null;
    mirrored: boolean;
    facing: "user" | "environment";
  };
  session?: { access_token: string } | null;
}

export interface UseSharedVisionResult {
  remotePeers: Map<string, RemotePeerState>;
  remoteRisks: Array<SvRemoteRiskMessage & { expiresAt: number }>;
  isConnected: boolean;
  sharedSessionId: string | null;
  deviceId: string;
  startSession: (label?: string) => Promise<void>;
  leaveSession: () => Promise<void>;
}

export function useSharedVision({
  enabled,
  orgId,
  userId,
  deviceLabel,
  backendEntities,
  backendPoses,
  backendRisk,
  backendStatus,
  capture,
  session,
}: UseSharedVisionOptions): UseSharedVisionResult {
  const deviceId = useRef(getOrCreateDeviceId());
  const sessionEpoch = useRef(crypto.randomUUID());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sharedSessionIdRef = useRef<string | null>(null);
  const lastFrameSentAt = useRef(0);
  const lastRiskSent = useRef<Map<string, number>>(new Map());
  const riskSeq = useRef(0);
  const lastSeenSeq = useRef<Map<string, number>>(new Map());
  const ttlTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerState>>(new Map());
  const [remoteRisks, setRemoteRisks] = useState<
    Array<SvRemoteRiskMessage & { expiresAt: number }>
  >([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sharedSessionId, setSharedSessionId] = useState<string | null>(null);

  const getOrSetSharedSessionId = useCallback((id: string) => {
    sharedSessionIdRef.current = id;
    setSharedSessionId(id);
  }, []);

  // Subscribe to the hive channel once a session is active
  const subscribeChannel = useCallback(
    (ssId: string) => {
      if (!orgId || !userId) return;
      const topic = `org:${orgId}:sv:${ssId}`;

      // Set realtime auth token
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      const ch = supabase.channel(topic, {
        config: { broadcast: { self: false }, presence: { key: deviceId.current } },
      });

      ch.on("broadcast", { event: "sv_frame" }, ({ payload }: { payload: SvFrameMessage }) => {
        if (!payload || payload.deviceId === deviceId.current) return;
        setRemotePeers((prev) => {
          const next = new Map(prev);
          next.set(payload.deviceId, {
            deviceId: payload.deviceId,
            userId: payload.userId,
            deviceLabel: payload.deviceLabel,
            lastSeenAt: Date.now(),
            isStale: false,
            calibration: payload.calibration,
            projection: payload.projection,
            capture: payload.capture,
            entities: payload.entities,
            poses: payload.poses ?? [],
            sceneRisks: payload.sceneRisks,
            riskSummary: payload.riskSummary,
            // projectedEntities is always computed locally by the receiver from
            // LocalPeerCalibration — never from the broadcast payload.
            // Phase 1: no calibration → always []. Populated in Phase 1B+ when
            // a valid transform exists (see ProjectedRemoteOverlay computation).
            projectedEntities: [],
          });
          return next;
        });
      });

      ch.on(
        "broadcast",
        { event: "sv_remote_risk" },
        ({ payload }: { payload: SvRemoteRiskMessage }) => {
          if (!payload || payload.deviceId === deviceId.current) return;
          // Clock-skew guard
          if (payload.ts > Date.now() + 5000) return;
          // De-dupe via (deviceId, session_epoch, seq)
          const epochKey = `${payload.deviceId}:${payload.session_epoch}`;
          const lastSeq = lastSeenSeq.current.get(epochKey) ?? -1;
          if (payload.seq <= lastSeq) return;
          lastSeenSeq.current.set(epochKey, payload.seq);

          const expiry = Date.now() + RISK_EXPIRE_MS;
          setRemoteRisks((prev) => {
            const filtered = prev.filter((r) => r.expiresAt > Date.now());
            return [...filtered, { ...payload, expiresAt: expiry }];
          });
        },
      );

      ch.on(
        "broadcast",
        { event: "sv_calibration_status" },
        ({ payload }: { payload: SvMessage }) => {
          if (payload.kind !== "sv_calibration_status") return;
          if (payload.status === "stale" || payload.status === "failed") {
            // Receiver clears its local calibration for this peer (Phase 2+ action)
          }
        },
      );

      ch.subscribe((status: string) => {
        setIsConnected(status === "SUBSCRIBED");
      });

      channelRef.current = ch;
    },
    [orgId, userId, session],
  );

  const unsubscribeChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const startSession = useCallback(
    async (label?: string) => {
      if (!orgId || !userId) return;
      const { data, error } = await db
        .from("shared_vision_sessions")
        .insert({ org_id: orgId, owner_id: userId, label: label ?? null })
        .select("id")
        .single();
      if (error || !data) return;
      const ssId = data.id as string;
      getOrSetSharedSessionId(ssId);
      await db.from("shared_vision_peers").upsert(
        {
          shared_session_id: ssId,
          org_id: orgId,
          user_id: userId,
          device_id: deviceId.current,
          peer_label: deviceLabel,
          role: "host",
          status: "online",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "shared_session_id,device_id" },
      );
      subscribeChannel(ssId);
    },
    [orgId, userId, deviceLabel, getOrSetSharedSessionId, subscribeChannel],
  );

  const leaveSession = useCallback(async () => {
    const ssId = sharedSessionIdRef.current;
    if (ssId && orgId && userId) {
      await db
        .from("shared_vision_peers")
        .update({ status: "offline" })
        .eq("shared_session_id", ssId)
        .eq("device_id", deviceId.current);
    }
    unsubscribeChannel();
    setSharedSessionId(null);
    sharedSessionIdRef.current = null;
    setRemotePeers(new Map());
    setRemoteRisks([]);
  }, [orgId, userId, unsubscribeChannel]);

  // Broadcast sv_frame heartbeat
  useEffect(() => {
    if (!enabled || !isConnected || !channelRef.current || !orgId || !userId) return;
    const ssId = sharedSessionIdRef.current;
    if (!ssId) return;

    const now = Date.now();
    if (now - lastFrameSentAt.current < FRAME_GATE_MS) return;
    lastFrameSentAt.current = now;

    const entities = backendEntities.map((e) => {
      const bbox = e.bbox ?? { x: 0, y: 0, w: 0, h: 0 };
      // Default ground contact = bbox bottom-center, in the sender image plane.
      // Box-first: works with detection boxes alone and never requires pose.
      // TODO: if worker-provided backendPoses can be reliably associated with this
      // entity, upgrade groundPointRemote.method to "worker_pose_ankles" using the
      // confident ankle keypoints. The app never generates pose itself.
      const groundPointRemote = {
        x: clamp01(bbox.x + bbox.w / 2),
        y: clamp01(bbox.y + bbox.h),
        confidence: Math.min(0.75, e.confidence ?? 0.75),
        method: "bbox_bottom_center" as const,
      };
      return {
        id: e.track_id ? String(e.track_id) : undefined,
        label: e.label,
        confidence: e.confidence ?? 0,
        bboxRemote: bbox,
        class_id: (e as { class_id?: number | null }).class_id ?? null,
        source: (e as { source?: string | null }).source ?? null,
        track_id: e.track_id,
        risk_level: e.risk_level,
        risk_reason: e.risk_reason,
        recommended_action: e.recommended_action,
        groundPointRemote,
        worldPoint: null,
      };
    });

    const msg: SvFrameMessage = {
      kind: "sv_frame",
      v: 1,
      orgId,
      sharedSessionId: ssId,
      deviceId: deviceId.current,
      userId,
      deviceLabel,
      sentAt: new Date().toISOString(),
      capture,
      backend: {
        state: backendStatus?.state ?? "unknown",
        backend: backendStatus?.backend ?? null,
        inferenceMs: null,
        latencyMs: null,
      },
      calibration: makeDefaultCalibration(),
      projection: makeDefaultProjection(),
      entities,
      // Optional, worker-owned. The app NEVER generates pose/skeletons — these
      // are only the worker's backendPoses forwarded as-is. Empty when the worker
      // did not run pose tasks; Hive works box-only without them.
      poses: backendPoses,
      sceneRisks: backendRisk?.sceneRisks ?? [],
      riskSummary: backendRisk?.riskSummary ?? null,
    };

    channelRef.current.send({ type: "broadcast", event: "sv_frame", payload: msg });
  });

  // TTL cleanup: mark peers stale after PEER_TTL_MS
  useEffect(() => {
    if (!enabled) return;
    ttlTimer.current = setInterval(() => {
      const cutoff = Date.now() - PEER_TTL_MS;
      setRemotePeers((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, peer] of next) {
          if (peer.lastSeenAt < cutoff && !peer.isStale) {
            next.set(id, { ...peer, isStale: true });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setRemoteRisks((prev) => {
        const now = Date.now();
        const filtered = prev.filter((r) => r.expiresAt > now);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);
    return () => {
      if (ttlTimer.current) clearInterval(ttlTimer.current);
    };
  }, [enabled]);

  // Update realtime auth on session change
  useEffect(() => {
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token);
    }
  }, [session?.access_token]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      unsubscribeChannel();
    },
    [unsubscribeChannel],
  );

  return {
    remotePeers,
    remoteRisks,
    isConnected,
    sharedSessionId,
    deviceId: deviceId.current,
    startSession,
    leaveSession,
  };
}
