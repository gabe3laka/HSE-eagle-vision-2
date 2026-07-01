/**
 * supabase/functions/multiset-token/index.ts
 *
 * MultiSet VPS auth broker. Exchanges the server-held client credentials for a
 * short-lived JWT via MultiSet's m2m/token endpoint and returns ONLY that
 * short-lived token to the browser. The MULTISET_CLIENT_SECRET never leaves the
 * server and is never included in the Vite bundle.
 *
 * The browser then calls MultiSet `/vps/map/query` directly with the returned
 * Bearer token (multipart form-data: queryImage + intrinsics + mapCode). Image
 * frames go browser → MultiSet only — never over Supabase Hive.
 *
 * Secrets (Supabase function env; never returned to the client):
 *   MULTISET_CLIENT_ID       MultiSet m2m client id
 *   MULTISET_CLIENT_SECRET   MultiSet m2m client secret
 *   MULTISET_API_BASE        optional, default https://api.multiset.ai/v1
 *
 * Stable contract: always HTTP 200; `{ error }` on any failure so the Stage-0
 * proof panel can surface the exact upstream problem without leaking secrets.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

async function safeJson(r: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" });

  const clientId = Deno.env.get("MULTISET_CLIENT_ID");
  const clientSecret = Deno.env.get("MULTISET_CLIENT_SECRET");
  const base = stripSlash(Deno.env.get("MULTISET_API_BASE") ?? "https://api.multiset.ai/v1");

  if (!clientId || !clientSecret) {
    return json({ error: "multiset_not_configured" });
  }

  let r: Response;
  try {
    r = await fetch(`${base}/m2m/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
  } catch (e) {
    return json({ error: `multiset_unreachable: ${errMsg(e)}` });
  }

  const data = await safeJson(r);
  if (!r.ok) {
    // Surface upstream status + a trimmed detail (never the secret) for debugging.
    const detail = data ? JSON.stringify(data).slice(0, 300) : null;
    return json({ error: `token_exchange_failed_${r.status}`, detail });
  }

  // MultiSet returns a short-lived JWT. Accept the common field spellings.
  const token =
    (typeof data?.token === "string" && data.token) ||
    (typeof data?.access_token === "string" && data.access_token) ||
    (typeof data?.accessToken === "string" && data.accessToken) ||
    null;

  if (!token) {
    return json({ error: "no_token_in_response", detail: data ? Object.keys(data) : null });
  }

  const expiresIn =
    (typeof data?.expiresIn === "number" && data.expiresIn) ||
    (typeof data?.expires_in === "number" && data.expires_in) ||
    null;

  // Only the short-lived token leaves the server.
  return json({ token, expiresIn });
});
