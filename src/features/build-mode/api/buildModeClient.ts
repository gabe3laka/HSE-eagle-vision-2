import { fetchDetectSession, DetectAuthError } from "@/lib/detection/backendVisionHttpDetector";
import { readBuildApiBase } from "../config";
import { mockBlueprintFrame } from "../lib/blueprint";
import type {
  BlueprintFrame,
  BuildFramePayload,
  BuildReplay,
  BuildSessionInfo,
  SelectedRegion,
} from "../types";

/**
 * Build Mode API client — HTTP only (no WebSockets), with a complete local
 * MOCK fallback so the UI works before the backend routes exist.
 *
 * Real routes (once the gateway grows them):
 *   POST {base}/build/session/start
 *   POST {base}/build/session/lock
 *   POST {base}/build/session/frame
 *   POST {base}/build/session/finish
 *   GET  {base}/build/session/:id/replay
 *
 * Auth: reuses the same short-lived Supabase HMAC session token as /detect
 * (`?token=` from create-stream-session). The browser never holds backend keys.
 *
 * Mock mode triggers when VITE_BUILD_MODE_API_URL is unset, and any individual
 * HTTP failure also degrades that session to mock so recording never blocks.
 */

const CAMERA_ID = "browser-build";

// In-memory replay store for mock sessions — keyframes only, never video.
const mockStore = new Map<string, BlueprintFrame[]>();
let mockCounter = 0;

function isHttpConfigured(): boolean {
  return readBuildApiBase() != null;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const base = readBuildApiBase();
  if (!base) throw new Error("build_api_not_configured");
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

/** Start a session. Falls back to a local mock session when no backend is set. */
export async function startBuildSession(): Promise<BuildSessionInfo> {
  if (isHttpConfigured()) {
    try {
      const d = (await postJson("/build/session/start", { camera_id: CAMERA_ID })) as {
        session_id?: unknown;
      };
      if (typeof d.session_id === "string" && d.session_id) {
        return { sessionId: d.session_id, backendMode: "http" };
      }
    } catch {
      // fall through to mock — never block the UI on a missing backend
    }
  }
  const sessionId = `mock-${Date.now().toString(36)}-${++mockCounter}`;
  mockStore.set(sessionId, []);
  return { sessionId, backendMode: "mock" };
}

/** Tell the backend which region was locked (no-op in mock mode). */
export async function lockBuildSelection(
  session: BuildSessionInfo,
  selection: SelectedRegion,
): Promise<void> {
  if (session.backendMode !== "http") return;
  try {
    await postJson("/build/session/lock", { session_id: session.sessionId, selection });
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
      const d = (await postJson("/build/session/frame", payload)) as {
        blueprint_frame?: BlueprintFrame;
      };
      if (d.blueprint_frame && Array.isArray(d.blueprint_frame.outline)) {
        return d.blueprint_frame;
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
  );
  const list = mockStore.get(payload.sessionId);
  if (list) list.push(frame);
  return frame;
}

/** Finish the session; returns the replay id (mock: the session id itself). */
export async function finishBuildSession(session: BuildSessionInfo): Promise<string> {
  if (session.backendMode === "http") {
    try {
      const d = (await postJson("/build/session/finish", { session_id: session.sessionId })) as {
        replay_id?: unknown;
      };
      if (typeof d.replay_id === "string" && d.replay_id) return d.replay_id;
    } catch {
      // fall through
    }
  }
  return session.sessionId;
}

/** Fetch a finished replay's ordered keyframes. */
export async function fetchBuildReplay(replayId: string): Promise<BuildReplay> {
  const base = readBuildApiBase();
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
