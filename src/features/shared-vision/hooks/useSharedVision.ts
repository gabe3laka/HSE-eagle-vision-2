import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/own-client";
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
    // Compass hive-mind (optional). Sender's live heading + horizontal FOV, sent
    // every frame so receivers can place detections by world bearing. Scalars
    // only. The existing `capture` spread at frame-build carries these through.
    headingDeg?: number | null;
    headingSource?: "absolute" | "webkit" | "relative" | null;
    headingAccuracyDeg?: number | null;
    hfovDeg?: number | null;
  };
  session?: { access_token: string } | null;
}

/** An org-mate currently present in the hive room (from Realtime presence). */
export interface LivePeer {
  deviceId: string;
  userId: string;
  deviceLabel: string | null;
}

/**
 * Observability snapshot for the org-wide hive connection (dev panel only —
 * gated behind VITE_HIVE_DEBUG at the call site). Lets a tester tell apart
 * "channel connected but no data" from auth/RLS/self-filter/missing-data
 * failures. High-frequency fields (lastSentAt/lastReceivedAt) are tracked in
 * refs and snapshotted ~1×/s by the TTL timer, so this never adds a per-frame
 * re-render.
 */
export interface HiveDiagnostics {
  /** The exact Realtime topic this device subscribes to (org:{orgId}:sv:hive). */
  topic: string | null;
  /** Last channel.subscribe() status: idle | connecting | SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED. */
  connectionStatus: string;
  /** Presence track lifecycle: idle | tracking | tracked | error. */
  presenceStatus: string;
  /** Result string of the last channel.track() ("ok" | "error" | "timed out"). */
  lastTrackResult: string | null;
  /** Result string of the last channel.send() ("ok" | "error" | "timed out"). */
  lastSendResult: string | null;
  /** epoch ms of the last sv_frame we broadcast. */
  lastSentAt: number | null;
  /** epoch ms of the last sv_frame we received from a peer. */
  lastReceivedAt: number | null;
}

export interface UseSharedVisionResult {
  remotePeers: Map<string, RemotePeerState>;
  remoteRisks: Array<SvRemoteRiskMessage & { expiresAt: number }>;
  isConnected: boolean;
  sharedSessionId: string | null;
  deviceId: string;
  // Org-mates currently in the hive room (presence) — includes receive-only
  // viewers, not just devices actively broadcasting detections.
  livePeers: LivePeer[];
  /** True when the user manually left the hive (auto-join is paused). */
  hivePaused: boolean;
  // Peers whose calibration is stale/failed — in-scene projection must be
  // suppressed for these (passed to useProjectedRemotePeers as blockedPeerIds).
  invalidProjectionPeerIds: Set<string>;
  /** Connection/send/receive observability for the dev readiness panel. */
  diagnostics: HiveDiagnostics;
  leaveHive: () => void;
  rejoinHive: () => void;
}

const IDLE_DIAGNOSTICS: HiveDiagnostics = {
  topic: null,
  connectionStatus: "idle",
  presenceStatus: "idle",
  lastTrackResult: null,
  lastSendResult: null,
  lastSentAt: null,
  lastReceivedAt: null,
};

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
  // High-frequency diagnostics live in refs and are snapshotted into state by
  // the 1s TTL timer, so per-frame send/receive never triggers a re-render.
  const lastSentAtRef = useRef<number | null>(null);
  const lastReceivedAtRef = useRef<number | null>(null);
  const lastSendResultRef = useRef<string | null>(null);

  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerState>>(new Map());
  const [remoteRisks, setRemoteRisks] = useState<
    Array<SvRemoteRiskMessage & { expiresAt: number }>
  >([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sharedSessionId, setSharedSessionId] = useState<string | null>(null);
  // Peers with a stale/failed calibration. Projection for these is suppressed
  // downstream until a fresh valid calibration status arrives for the peer.
  const [invalidProjectionPeerIds, setInvalidProjectionPeerIds] = useState<Set<string>>(new Set());
  // Org-mates currently present in the hive room (Realtime presence).
  const [livePeers, setLivePeers] = useState<LivePeer[]>([]);
  // True when the user explicitly left the hive — pauses auto-join until rejoin.
  const [hivePaused, setHivePaused] = useState(false);
  // Connection/send/receive observability for the dev readiness panel.
  const [diagnostics, setDiagnostics] = useState<HiveDiagnostics>(IDLE_DIAGNOSTICS);

  // Subscribe to the ORG-WIDE hive room. One room per org: every live member of
  // the org shares this single channel and auto-merges — there is no per-session
  // channel and no join step. The Realtime RLS authorizes on the org id (the 2nd
  // topic segment), so the fixed 'hive' suffix is allowed with no policy change.
  const subscribeChannel = useCallback(() => {
    if (!orgId || !userId) return;
    if (channelRef.current) return; // already subscribed
    const topic = `org:${orgId}:sv:hive`;
    setDiagnostics((d) => ({ ...d, topic, connectionStatus: "connecting" }));

    // Set realtime auth token
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token);
    }

    const ch = supabase.channel(topic, {
      config: { broadcast: { self: false }, presence: { key: deviceId.current } },
    });

    ch.on("broadcast", { event: "sv_frame" }, ({ payload }: { payload: SvFrameMessage }) => {
      if (!payload || payload.deviceId === deviceId.current) return;
      lastReceivedAtRef.current = Date.now();
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
        const invalid = payload.status === "stale" || payload.status === "failed";
        // Maintain the projection blocklist. A stale/failed status suppresses
        // in-scene projection for the peer (handled in useProjectedRemotePeers);
        // a fresh valid status re-enables it. We do NOT clear projectedEntities
        // here because useProjectedRemotePeers recomputes them — the blocklist
        // is the durable signal that survives recompute. Raw entities/risks are
        // untouched so awareness panel + risk feed stay live.
        setInvalidProjectionPeerIds((prev) => {
          const has = prev.has(payload.deviceId);
          if (invalid && !has) {
            const next = new Set(prev);
            next.add(payload.deviceId);
            return next;
          }
          if (!invalid && has) {
            const next = new Set(prev);
            next.delete(payload.deviceId);
            return next;
          }
          return prev;
        });
      },
    );

    // Presence: who is currently in the hive room (incl. receive-only viewers).
    const syncPresence = () => {
      const state = ch.presenceState() as Record<
        string,
        Array<{ deviceId?: string; userId?: string; deviceLabel?: string | null }>
      >;
      const peers: LivePeer[] = [];
      for (const entries of Object.values(state)) {
        const e = entries[0];
        if (!e?.deviceId || e.deviceId === deviceId.current) continue;
        peers.push({
          deviceId: e.deviceId,
          userId: e.userId ?? "",
          deviceLabel: e.deviceLabel ?? null,
        });
      }
      setLivePeers(peers);
    };
    ch.on("presence", { event: "sync" }, syncPresence);
    ch.on("presence", { event: "join" }, syncPresence);
    ch.on("presence", { event: "leave" }, syncPresence);

    ch.subscribe((status: string) => {
      const connected = status === "SUBSCRIBED";
      setIsConnected(connected);
      setDiagnostics((d) => ({ ...d, connectionStatus: status }));
      if (connected) {
        setSharedSessionId(topic);
        sharedSessionIdRef.current = topic;
        // Announce presence so org-mates see us even before we broadcast a frame.
        // Capture the track result so the dev panel can prove presence succeeded
        // (vs. an RLS reject on the presence extension).
        setDiagnostics((d) => ({ ...d, presenceStatus: "tracking" }));
        Promise.resolve(ch.track({ deviceId: deviceId.current, userId, deviceLabel }))
          .then((res) =>
            setDiagnostics((d) => ({
              ...d,
              presenceStatus: res === "ok" ? "tracked" : "error",
              lastTrackResult: String(res),
            })),
          )
          .catch((err) =>
            setDiagnostics((d) => ({
              ...d,
              presenceStatus: "error",
              lastTrackResult: String(err),
            })),
          );
      }
    });

    channelRef.current = ch;
  }, [orgId, userId, session, deviceLabel]);

  const unsubscribeChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setIsConnected(false);
    setLivePeers([]);
    setDiagnostics((d) => ({
      ...d,
      connectionStatus: "CLOSED",
      presenceStatus: "idle",
    }));
  }, []);

  // Leave the hive: pause auto-join and unsubscribe. There is no session row to
  // end — org-mates drop us via Realtime presence-leave and the 5s frame TTL.
  const leaveHive = useCallback(() => {
    setHivePaused(true);
    unsubscribeChannel();
    setSharedSessionId(null);
    sharedSessionIdRef.current = null;
    setRemotePeers(new Map());
    setRemoteRisks([]);
    setInvalidProjectionPeerIds(new Set());
  }, [unsubscribeChannel]);

  const rejoinHive = useCallback(() => setHivePaused(false), []);

  // Auto-join the org hive room whenever Hive is enabled and we have an org +
  // auth, unless the user manually left. Being live in the org == being in the
  // hive; no explicit start/join. Tears down on disable, org change, or unmount.
  useEffect(() => {
    if (!enabled || !orgId || !userId || !session?.access_token || hivePaused) {
      unsubscribeChannel();
      return;
    }
    subscribeChannel();
    return () => unsubscribeChannel();
  }, [
    enabled,
    orgId,
    userId,
    session?.access_token,
    hivePaused,
    subscribeChannel,
    unsubscribeChannel,
  ]);

  // Broadcast sv_frame heartbeat while connected to the org hive room.
  useEffect(() => {
    if (!enabled || !isConnected || !channelRef.current || !orgId || !userId) return;
    const room = sharedSessionIdRef.current ?? `org:${orgId}:sv:hive`;

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
      sharedSessionId: room,
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

    lastSentAtRef.current = now;
    // Capture the send result so the dev panel can show broadcast health. Only
    // setState when the result string changes (normally stays "ok"), so the
    // 300ms heartbeat does not cause a re-render per frame.
    Promise.resolve(channelRef.current.send({ type: "broadcast", event: "sv_frame", payload: msg }))
      .then((res) => {
        if (lastSendResultRef.current !== res) {
          lastSendResultRef.current = String(res);
          setDiagnostics((d) => ({ ...d, lastSendResult: String(res) }));
        }
      })
      .catch((err) => {
        const e = String(err);
        if (lastSendResultRef.current !== e) {
          lastSendResultRef.current = e;
          setDiagnostics((d) => ({ ...d, lastSendResult: e }));
        }
      });
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
      // Snapshot the high-frequency send/receive timestamps into state ~1×/s.
      setDiagnostics((d) => {
        if (
          d.lastSentAt === lastSentAtRef.current &&
          d.lastReceivedAt === lastReceivedAtRef.current
        ) {
          return d;
        }
        return {
          ...d,
          lastSentAt: lastSentAtRef.current,
          lastReceivedAt: lastReceivedAtRef.current,
        };
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
    livePeers,
    hivePaused,
    invalidProjectionPeerIds,
    diagnostics,
    leaveHive,
    rejoinHive,
  };
}
