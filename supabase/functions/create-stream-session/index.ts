/**
 * supabase/functions/create-stream-session/index.ts
 *
 * Mints a short-lived, HMAC-signed session token so the browser can authenticate
 * to the EdgeCrafter stream gateway (Cloudflare Worker) WITHOUT ever holding the
 * RunPod API key or the signing secret. Also returns the gateway URL so the
 * frontend doesn't need it baked in at build time. Flow:
 *   browser (Supabase session) -> this function -> { token, expires_at, ws_url }
 *   browser -> ${ws_url}?token=<token>
 *
 * Token format (must match the Cloudflare gateway EXACTLY):
 *   payloadB64 = base64url(JSON.stringify(payload))            // no padding
 *   sig        = base64url(HMAC_SHA256(payloadB64, SECRET))    // HMAC over the
 *                                                              //   payloadB64 STRING
 *   token      = payloadB64 + "." + sig
 *   payload    = { scope:"edgecrafter-stream", iat, exp, camera_id }
 *
 * Env (Supabase function env; the SIGNING_SECRET is NEVER returned or logged):
 *   STREAM_SESSION_SIGNING_SECRET   shared HMAC secret (also set on the gateway)
 *   STREAM_SESSION_TTL_SECONDS      optional, default 300
 *   EDGECRAFT_STREAM_WS_URL         gateway WS URL returned to the client (null if unset)
 *   SUPABASE_URL / SUPABASE_ANON_KEY  auto-provided; used to verify the caller
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** base64url without padding. */
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** token = base64url(payload) + "." + base64url(HMAC_SHA256(payloadB64, secret)). */
async function signSessionToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const payloadB64 = base64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );
  return `${payloadB64}.${base64url(sigBytes)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("STREAM_SESSION_SIGNING_SECRET");
  if (!secret) return json({ error: "stream_session_not_configured" }, 500);

  // Require an authenticated Supabase user — verify the JWT from Authorization.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";
  let userId: string | null = null;
  if (supabaseUrl && anonKey && authHeader) {
    try {
      const sb = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await sb.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch {
      userId = null;
    }
  }
  if (!userId) return json({ error: "not_authenticated" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const cameraId =
    typeof body.camera_id === "string" && body.camera_id.trim() ? body.camera_id : "browser-test";

  const ttl = Number(Deno.env.get("STREAM_SESSION_TTL_SECONDS") ?? "300") || 300;
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + ttl;
  const token = await signSessionToken(
    { scope: "edgecrafter-stream", iat: nowSec, exp, camera_id: cameraId },
    secret,
  );

  // Gateway URL comes from env (no hardcoded fallback); null when unset.
  const wsUrl = Deno.env.get("EDGECRAFT_STREAM_WS_URL") ?? null;

  // Never return/log the signing secret or any RunPod key.
  return json({ token, expires_at: new Date(exp * 1000).toISOString(), ws_url: wsUrl });
});
