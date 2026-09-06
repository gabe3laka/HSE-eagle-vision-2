/**
 * scanClient.ts — HTTP client for the worker's `/capture/*` routes, with a
 * complete in-memory STUB so Part 1 works before Part 2 is deployed.
 *
 *   POST {base}/capture/session/start   {type}              → {session_id, max_frames}
 *   POST {base}/capture/session/frame   multipart           → {ok, frame_count}
 *   POST {base}/capture/session/finish  {session_id}        → {job_id}
 *   GET  {base}/capture/jobs/{job_id}                       → {job_id, status, result?, error?}
 *
 * Base URL: VITE_SCAN_API_URL (worker origin — "reuse the vision worker
 * origin"). Absent → stub. Auth: the same short-lived Supabase session token
 * the Build Mode client sends as `?token=` (the gateway translates it into the
 * worker's shared-secret header). The browser never holds a worker secret.
 */

import { readScanApiUrl, type ScanMode, maxFramesFor } from "../config";
import type { KeptFrame, ScanJob, ScanJobResult, ScanSessionInfo } from "../types";

const CAMERA_ID = "browser-scan";

// -- token (best-effort; the gateway may not require it in dev) ---------------

async function tokenQuery(): Promise<string> {
  try {
    const mod = await import("@/lib/detection/backendVisionHttpDetector");
    const { token } = await mod.fetchDetectSession(CAMERA_ID);
    return `?token=${encodeURIComponent(token)}`;
  } catch {
    return "";
  }
}

async function postJson(base: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}${await tokenQuery()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ? `${err.error}` : `http_${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as unknown;
}

// -- stub worker (canned results) ---------------------------------------------

interface StubSession {
  mode: ScanMode;
  frames: number;
}
const stubSessions = new Map<string, StubSession>();
const stubJobs = new Map<string, { polls: number; mode: ScanMode; frames: number }>();
let stubCounter = 0;

/** Test/preview hook: how many polls the stub job stays "running". */
export const STUB_JOB_POLLS_UNTIL_DONE = 3;

export function stubJobResult(mode: ScanMode, frames: number): ScanJobResult {
  return {
    status: "done",
    metric: true,
    artifact_url: `stub://scan/${mode}/artifact.${mode === "site" ? "ply" : "glb"}`,
    map_code: mode === "site" ? "MAP_STUB0000" : null,
    object_anchor_id: mode === "object" ? "OBJ_STUB0000" : null,
    mat_frames: Math.min(frames, 24),
    reproj_error: 0.42,
    frame_count: frames,
  };
}

export function resetScanStub(): void {
  stubSessions.clear();
  stubJobs.clear();
  stubCounter = 0;
}

// -- public API ---------------------------------------------------------------

export async function startScanSession(mode: ScanMode): Promise<ScanSessionInfo> {
  const base = readScanApiUrl();
  if (base) {
    const d = (await postJson(base, "/capture/session/start", { type: mode })) as {
      session_id?: unknown;
      max_frames?: unknown;
    };
    if (typeof d.session_id !== "string" || !d.session_id) throw new Error("bad_session");
    return {
      sessionId: d.session_id,
      mode,
      backendMode: "http",
      maxFrames: typeof d.max_frames === "number" ? d.max_frames : maxFramesFor(mode),
    };
  }
  const sessionId = `stub-${(++stubCounter).toString(36)}`;
  stubSessions.set(sessionId, { mode, frames: 0 });
  return { sessionId, mode, backendMode: "stub", maxFrames: maxFramesFor(mode) };
}

export async function uploadScanFrame(
  session: ScanSessionInfo,
  frame: KeptFrame,
  jpeg: Blob,
): Promise<{ frameCount: number }> {
  if (session.backendMode === "stub") {
    const s = stubSessions.get(session.sessionId);
    if (!s) throw new Error("unknown_session");
    s.frames++;
    return { frameCount: s.frames };
  }
  const base = readScanApiUrl();
  if (!base) throw new Error("no_scan_api");
  const form = new FormData();
  form.set("session_id", session.sessionId);
  form.set("seq", String(frame.seq));
  form.set("ts", String(frame.ts));
  if (frame.headingDeg !== undefined) form.set("heading_deg", String(frame.headingDeg));
  if (frame.pitchDeg !== undefined) form.set("pitch_deg", String(frame.pitchDeg));
  form.set("frame", jpeg, `frame_${String(frame.seq).padStart(5, "0")}.jpg`);
  const res = await fetch(`${base}/capture/session/frame${await tokenQuery()}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `http_${res.status}`);
  }
  const d = (await res.json().catch(() => ({}))) as { frame_count?: unknown };
  return { frameCount: typeof d.frame_count === "number" ? d.frame_count : frame.seq + 1 };
}

export async function finishScanSession(session: ScanSessionInfo): Promise<{ jobId: string }> {
  if (session.backendMode === "stub") {
    const s = stubSessions.get(session.sessionId);
    if (!s) throw new Error("unknown_session");
    const jobId = `job-stub-${session.sessionId}`;
    stubJobs.set(jobId, { polls: 0, mode: s.mode, frames: s.frames });
    return { jobId };
  }
  const base = readScanApiUrl();
  if (!base) throw new Error("no_scan_api");
  const d = (await postJson(base, "/capture/session/finish", {
    session_id: session.sessionId,
  })) as { job_id?: unknown };
  if (typeof d.job_id !== "string" || !d.job_id) throw new Error("bad_job");
  return { jobId: d.job_id };
}

export async function getScanJob(session: ScanSessionInfo, jobId: string): Promise<ScanJob> {
  if (session.backendMode === "stub") {
    const j = stubJobs.get(jobId);
    if (!j) return { job_id: jobId, status: "error", result: null, error: "unknown_job" };
    j.polls++;
    if (j.polls < STUB_JOB_POLLS_UNTIL_DONE) {
      return {
        job_id: jobId,
        status: j.polls === 1 ? "queued" : "running",
        result: null,
        error: null,
      };
    }
    return { job_id: jobId, status: "done", result: stubJobResult(j.mode, j.frames), error: null };
  }
  const base = readScanApiUrl();
  if (!base) throw new Error("no_scan_api");
  const res = await fetch(`${base}/capture/jobs/${encodeURIComponent(jobId)}${await tokenQuery()}`);
  if (!res.ok) throw new Error(`http_${res.status}`);
  const d = (await res.json()) as Partial<ScanJob>;
  return {
    job_id: jobId,
    status: (d.status as ScanJob["status"]) ?? "error",
    result: (d.result as ScanJobResult | undefined) ?? null,
    error: typeof d.error === "string" ? d.error : null,
  };
}
