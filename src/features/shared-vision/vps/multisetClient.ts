/**
 * MultiSet VPS REST client (browser side).
 *
 * Provider-abstracted so it can later be swapped for a SafeLens VPS worker
 * without touching projection/broadcast code.
 *
 *   getToken()  → short-lived JWT via the `multiset-token` Supabase Edge
 *                 Function (the CLIENT SECRET stays server-side; the browser
 *                 only ever receives the short-lived token).
 *   queryPose() → direct multipart POST to MultiSet `/vps/map/query-form` with
 *                 the Bearer token (binary queryImage + intrinsics + mapCode).
 *                 `/vps/map/query-form` is the multipart/form-data endpoint;
 *                 `/vps/map/query` is the application/json + base64 variant — the
 *                 endpoint MUST match the body content type. The image goes
 *                 browser → MultiSet only, never over Supabase Hive.
 *
 * Response shape is normalized defensively: `poseFound === false` → pose null;
 * quaternion accepted as {x,y,z,w} or {qx,qy,qz,qw}; low confidence surfaced for
 * the caller's gate. On any non-OK upstream, the raw body is returned in `error`
 * so the Stage-0 proof panel pinpoints schema/CORS/auth problems.
 */

import { supabase } from "@/integrations/supabase/own-client";
import type { VpsIntrinsics, VpsPose, VpsQueryResult } from "./types";

const MULTISET_API_BASE = (
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_MULTISET_API_BASE as string | undefined)) ||
  "https://api.multiset.ai/v1"
).replace(/\/+$/, "");

// Multipart/form-data endpoint (binary queryImage). The JSON+base64 variant is
// `/vps/map/query` — do not use it with a FormData body.
const MAP_QUERY_URL = `${MULTISET_API_BASE}/vps/map/query-form`;

export interface MultisetToken {
  token: string;
  expiresIn: number | null;
}

/** Fetch a short-lived MultiSet token from the server-side broker. */
export async function getToken(): Promise<MultisetToken> {
  const { data, error } = await supabase.functions.invoke("multiset-token", { body: {} });
  if (error) throw new Error(`multiset_token_fn_error: ${error.message}`);
  const rec = (data ?? {}) as Record<string, unknown>;
  if (typeof rec.error === "string") throw new Error(`multiset_token_error: ${rec.error}`);
  if (typeof rec.token !== "string" || !rec.token) {
    throw new Error(`multiset_token_missing: ${JSON.stringify(rec).slice(0, 200)}`);
  }
  return { token: rec.token, expiresIn: typeof rec.expiresIn === "number" ? rec.expiresIn : null };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readVec3(v: unknown): { x: number; y: number; z: number } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const x = num(o.x);
  const y = num(o.y);
  const z = num(o.z);
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

/** Accept {x,y,z,w} or {qx,qy,qz,qw}. */
function readQuat(v: unknown): { x: number; y: number; z: number; w: number } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const x = num(o.x) ?? num(o.qx);
  const y = num(o.y) ?? num(o.qy);
  const z = num(o.z) ?? num(o.qz);
  const w = num(o.w) ?? num(o.qw);
  if (x == null || y == null || z == null || w == null) return null;
  return { x, y, z, w };
}

function normalize(
  raw: Record<string, unknown>,
  mapCode: string,
  responseTimeMs: number,
): VpsQueryResult {
  const poseFound = raw.poseFound === true || raw.pose_found === true || raw.found === true;
  const position = readVec3(raw.position);
  const rotation = readQuat(raw.rotation);
  const confidence = num(raw.confidence);
  const mapId =
    (typeof raw.mapId === "string" && raw.mapId) ||
    (typeof raw.map_id === "string" && raw.map_id) ||
    null;
  const mapCodes = Array.isArray(raw.mapCodes)
    ? (raw.mapCodes.filter((c) => typeof c === "string") as string[])
    : null;

  let pose: VpsPose | null = null;
  if (poseFound && position && rotation) {
    pose = {
      provider: "multiset",
      mapId: mapId ?? mapCode,
      mapCode,
      mapSetId: typeof raw.mapSetId === "string" ? raw.mapSetId : null,
      position,
      rotation,
      confidence: confidence ?? 0,
      timestampMs: Date.now(),
      trackingState: "localized",
    };
  }

  return {
    poseFound,
    pose,
    confidence,
    position,
    rotation,
    mapId,
    mapCodes,
    responseTimeMs,
    error: null,
    raw,
  };
}

/**
 * Localize a single frame against a MultiSet map. `isRightHanded` is sent as a
 * form-data string per the MultiSet REST contract.
 */
export async function queryPose(params: {
  blob: Blob;
  intrinsics: VpsIntrinsics;
  mapCode: string;
  isRightHanded?: boolean;
  token?: string;
}): Promise<VpsQueryResult> {
  const { blob, intrinsics, mapCode, isRightHanded = true } = params;
  const token = params.token ?? (await getToken()).token;

  const form = new FormData();
  form.append("mapCode", mapCode);
  form.append("isRightHanded", String(isRightHanded));
  form.append("fx", String(intrinsics.fx));
  form.append("fy", String(intrinsics.fy));
  form.append("px", String(intrinsics.px));
  form.append("py", String(intrinsics.py));
  form.append("width", String(intrinsics.width));
  form.append("height", String(intrinsics.height));
  form.append("queryImage", blob, "frame.jpg");

  const t0 = performance.now();
  let r: Response;
  try {
    r = await fetch(MAP_QUERY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (e) {
    // Most likely CORS or network on a mobile browser — a Stage-0 finding.
    const responseTimeMs = Math.round(performance.now() - t0);
    return {
      poseFound: false,
      pose: null,
      confidence: null,
      position: null,
      rotation: null,
      mapId: null,
      mapCodes: null,
      responseTimeMs,
      error: `query_unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const responseTimeMs = Math.round(performance.now() - t0);
  const raw = (await r.json().catch(() => null)) as Record<string, unknown> | null;

  if (!r.ok) {
    return {
      poseFound: false,
      pose: null,
      confidence: null,
      position: null,
      rotation: null,
      mapId: null,
      mapCodes: null,
      responseTimeMs,
      error: `upstream_${r.status}: ${raw ? JSON.stringify(raw).slice(0, 300) : "no_body"}`,
      raw,
    };
  }

  if (!raw) {
    return {
      poseFound: false,
      pose: null,
      confidence: null,
      position: null,
      rotation: null,
      mapId: null,
      mapCodes: null,
      responseTimeMs,
      error: "unparseable_response",
    };
  }

  return normalize(raw, mapCode, responseTimeMs);
}
