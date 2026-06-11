import { fetchDetectSession, DetectAuthError } from "@/lib/detection/backendVisionHttpDetector";
import { resolveBuildModeApiUrl } from "../config";
import { mockBlueprintFrame } from "../lib/blueprint";
import { handLandmarksToRegionLocal } from "../lib/handTracking";
import type {
  BlueprintFrame,
  BlueprintWorkflowMode,
  BuildFramePayload,
  BuildReplay,
  BuildSessionInfo,
  SelectedRegion,
} from "../types";

/**
 * Build Mode API client — HTTP only (no WebSockets), with a complete local
 * MOCK fallback so the UI always works.
 *
 * Cloudflare Worker routes (base resolved via resolveBuildModeApiUrl):
 *   POST {base}/build/session/start
 *   POST {base}/build/session/lock
 *   POST {base}/build/session/frame
 *   POST {base}/build/session/finish
 *   GET  {base}/build/session/:id/replay
 *
 * Base URL resolution (frontend can't read Supabase secrets directly):
 *   1. import.meta.env.VITE_BUILD_MODE_API_URL
 *   2. Supabase Edge Function `get-build-mode-config` → { buildModeApiUrl }
 *   3. null → local mock
 *
 * Auth: reuses the same short-lived Supabase HMAC session token as /detect
 * (`?token=` from create-stream-session). The browser never holds backend keys.
 *
 * Any individual HTTP failure degrades that session to mock so recording never
 * blocks; the resolved `configSource` is carried on the session so the panel
 * can distinguish a mock FALLBACK from a missing config.
 */

const CAMERA_ID = "browser-build";

// In-memory replay store for mock sessions — keyframes only, never video.
const mockStore = new Map<string, BlueprintFrame[]>();
let mockCounter = 0;

/** POST a `/build/...` route on the resolved base, appending the shared
 *  `?token=` (same short-lived Supabase session token as /detect). */
async function postJson(base: string, path: string, body: unknown): Promise<unknown> {
  let token: string;
  try {
    token = (await fetchDetectSession(CAMERA_ID)).token;
  } catch (e) {
    throw e instanceof DetectAuthError ? e : new Error("token_failed");
  }
  const res = await fetch(`${base}${path}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json().catch(() => ({}))) as unknown;
}

/**
 * Start a session. Resolves the base URL (env → Supabase config → null) and
 * uses the real Cloudflare `/build/*` routes when available; otherwise (or on
 * any failure) falls back to a local mock session — never blocks the UI.
 * `workflowMode` rides on the SAME routes for both Build and Plan — no /plan/*.
 */
export async function startBuildSession(
  workflowMode: BlueprintWorkflowMode = "build",
): Promise<BuildSessionInfo> {
  const cfg = await resolveBuildModeApiUrl();
  if (cfg.url) {
    try {
      const d = (await postJson(cfg.url, "/build/session/start", {
        camera_id: CAMERA_ID,
        workflowMode,
      })) as {
        session_id?: unknown;
      };
      if (typeof d.session_id === "string" && d.session_id) {
        return {
          sessionId: d.session_id,
          backendMode: "http",
          configSource: cfg.source,
          workflowMode,
        };
      }
    } catch {
      // fall through to mock — never block the UI on a backend hiccup
    }
  }
  const sessionId = `mock-${Date.now().toString(36)}-${++mockCounter}`;
  mockStore.set(sessionId, []);
  // configSource is preserved so the panel distinguishes "mock-fallback"
  // (URL configured but request failed) from "config-missing" (no URL).
  return { sessionId, backendMode: "mock", configSource: cfg.source, workflowMode };
}

/** Tell the backend which region was locked (no-op in mock mode). */
export async function lockBuildSelection(
  session: BuildSessionInfo,
  selection: SelectedRegion,
): Promise<void> {
  if (session.backendMode !== "http") return;
  const { url } = await resolveBuildModeApiUrl();
  if (!url) return;
  try {
    await postJson(url, "/build/session/lock", {
      session_id: session.sessionId,
      selection,
      workflowMode: session.workflowMode ?? "build",
    });
  } catch {
    // tolerated — the lock is advisory; frames carry the region anyway
  }
}

/**
 * Send one selected-crop keyframe; returns the blueprint frame to render. The
 * mock derives a ghost blueprint locally from the payload.
 */
export async function sendBuildFrame(
  session: BuildSessionInfo,
  payload: BuildFramePayload,
  frameIndex: number,
): Promise<BlueprintFrame> {
  if (session.backendMode === "http") {
    try {
      const { url } = await resolveBuildModeApiUrl();
      if (url) {
        const d = (await postJson(url, "/build/session/frame", payload)) as {
          blueprint_frame?: BlueprintFrame;
        };
        if (d.blueprint_frame && Array.isArray(d.blueprint_frame.outline)) {
          return d.blueprint_frame;
        }
      }
    } catch {
      // degrade this frame to mock — recording keeps flowing
    }
  }
  const frame = mockBlueprintFrame(
    payload.sessionId,
    frameIndex,
    payload.timestampMs,
    payload.selectedRegion,
    payload.workflowMode ?? session.workflowMode ?? "build",
  );
  // Carry recorded hand landmarks into the keyframe (mapped to region-local
  // coords) plus the gesture snapshot, so replay draws the finger/wrist path
  // and pinch highlights even in mock mode.
  frame.handLandmarks = handLandmarksToRegionLocal(payload.handLandmarks, payload.selectedRegion);
  frame.gesture = payload.gesture;
  const list = mockStore.get(payload.sessionId);
  if (list) list.push(frame);
  return frame;
}

/** Finish the session; returns the replay id (mock: the session id itself). */
export async function finishBuildSession(session: BuildSessionInfo): Promise<string> {
  if (session.backendMode === "http") {
    try {
      const { url } = await resolveBuildModeApiUrl();
      if (url) {
        const d = (await postJson(url, "/build/session/finish", {
          session_id: session.sessionId,
          workflowMode: session.workflowMode ?? "build",
        })) as { replay_id?: unknown };
        if (typeof d.replay_id === "string" && d.replay_id) return d.replay_id;
      }
    } catch {
      // fall through
    }
  }
  return session.sessionId;
}

/** Fetch a finished replay's ordered keyframes. */
export async function fetchBuildReplay(replayId: string): Promise<BuildReplay> {
  const { url: base } = await resolveBuildModeApiUrl();
  if (base && !replayId.startsWith("mock-")) {
    try {
      let token = "";
      try {
        token = (await fetchDetectSession(CAMERA_ID)).token;
      } catch {
        /* unauthenticated fetch attempt below will 401 and fall through */
      }
      const res = await fetch(
        `${base}/build/session/${encodeURIComponent(replayId)}/replay?token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        const d = (await res.json()) as { frames?: BlueprintFrame[] };
        if (Array.isArray(d.frames)) return { sessionId: replayId, frames: d.frames };
      }
    } catch {
      // fall through to mock store
    }
  }
  return { sessionId: replayId, frames: mockStore.get(replayId) ?? [] };
}
