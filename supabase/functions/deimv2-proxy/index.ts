/**
 * supabase/functions/deimv2-proxy/index.ts
 *
 * DEIMv2 RunPod proxy. Hides the RunPod key from the browser and returns a
 * single stable contract to the frontend (always HTTP 200; `entities: []` on
 * error). Two upstream modes, chosen by which secrets are present:
 *
 *  1. LIVE server (preferred) — RunPod Load Balancer / FastAPI worker.
 *     Active when RUNPOD_DEIMV2_BASE_URL is set. Calls `POST {base}/detect`.
 *     Diagnostic passthrough modes (forward the worker's raw JSON in `result`):
 *       {mode:"health"}                  -> GET  {base}/health
 *       {mode:"ping"}                    -> GET  {base}/ping
 *       {mode:"startup", deep?:true}     -> GET  {base}/debug/startup[?deep=true]
 *       {mode:"model-load"}              -> POST {base}/debug/model-load
 *       {mode:"warmup"}                  -> POST {base}/warmup
 *  2. QUEUE fallback (legacy) — RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID -> /runsync.
 *
 * Secrets (Supabase function env; never returned to the client):
 *   RUNPOD_DEIMV2_BASE_URL   live load-balancer base URL (no trailing /detect)
 *   RUNPOD_API_KEY           RunPod API key (Bearer for both modes)
 *   RUNPOD_ENDPOINT_ID       legacy queue endpoint id (fallback only)
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
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
async function safeJson(r: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Diagnostic passthrough modes (live-server only) → worker route + HTTP method.
const DIAG_ROUTES: Record<string, { method: "GET" | "POST"; path: string }> = {
  health: { method: "GET", path: "/health" },
  ping: { method: "GET", path: "/ping" },
  startup: { method: "GET", path: "/debug/startup" },
  "model-load": { method: "POST", path: "/debug/model-load" },
  warmup: { method: "POST", path: "/warmup" },
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed", entities: [] });

  const baseUrl = Deno.env.get("RUNPOD_DEIMV2_BASE_URL");
  const apiKey = Deno.env.get("RUNPOD_API_KEY");
  const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const mode = typeof body.mode === "string" ? body.mode : undefined;
  const authHeader = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  // Diagnostic passthrough (live-server only): forward the worker's raw JSON.
  if (mode && mode in DIAG_ROUTES) {
    if (!baseUrl) {
      return json({
        error: "live_backend_not_configured",
        entities: [],
        proxy: apiKey && endpointId ? "queue" : "unconfigured",
      });
    }
    const route = DIAG_ROUTES[mode];
    let path = route.path;
    if (mode === "startup" && body.deep === true) path += "?deep=true";
    try {
      const init: RequestInit =
        route.method === "POST"
          ? { method: "POST", headers: { ...authHeader, "Content-Type": "application/json" }, body: "{}" }
          : { method: "GET", headers: authHeader };
      const r = await fetch(stripSlash(baseUrl) + path, init);
      return json({ mode, proxy: "live", upstream_status: r.status, result: await safeJson(r) });
    } catch (e) {
      return json({ error: `live_unreachable: ${errMsg(e)}`, entities: [], proxy: "live", mode });
    }
  }

  // LIVE server mode (preferred): POST /detect
  if (baseUrl) {
    const image_b64 = body.image_b64;
    if (!image_b64 || typeof image_b64 !== "string") {
      return json({ error: "missing_image_b64", entities: [], proxy: "live" });
    }
    let r: Response;
    try {
      r = await fetch(stripSlash(baseUrl) + "/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          image_b64,
          conf: body.conf ?? 0.35,
          img_size: body.img_size ?? 640,
          classes: body.classes ?? null,
        }),
      });
    } catch (e) {
      return json({ error: `live_unreachable: ${errMsg(e)}`, entities: [] });
    }

    const data = await safeJson(r);

    if (!r.ok) {
      const fromBody =
        data && typeof data.error === "string"
          ? data.error
          : data && typeof data.detail === "string"
            ? data.detail
            : null;
      const error =
        r.status === 503 ? (fromBody ?? "model_not_ready") : (fromBody ?? `upstream_${r.status}`);
      return json({
        error,
        entities: [],
        state: r.status === 503 ? "loading" : "error",
        upstream_status: r.status,
      });
    }

    if (!data) return json({ error: "unexpected_live_response", entities: [] });

    if (typeof data.error === "string") {
      return json({
        error: data.error,
        entities: Array.isArray(data.entities) ? data.entities : [],
        model: data.model,
        inference_ms: data.inference_ms,
      });
    }

    return json({
      entities: Array.isArray(data.entities) ? data.entities : [],
      model: data.model,
      inference_ms: data.inference_ms,
      img_w: data.img_w,
      img_h: data.img_h,
    });
  }

  // QUEUE fallback (legacy /runsync)
  if (!apiKey || !endpointId) {
    return json({ error: "deimv2_backend_not_configured", entities: [], state: "unconfigured" });
  }
  const image_b64 = body.image_b64;
  if (!image_b64 || typeof image_b64 !== "string") {
    return json({ error: "missing_image_b64", entities: [] });
  }
  let runpodData: Record<string, unknown> | null;
  try {
    const upstream = await fetch(`https://api.runpod.ai/v2/${endpointId}/runsync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({
        input: {
          image_b64,
          conf: body.conf ?? 0.35,
          img_size: body.img_size ?? 640,
          classes: body.classes ?? null,
        },
      }),
    });
    runpodData = await safeJson(upstream);
  } catch (e) {
    return json({ error: `runpod_unreachable: ${errMsg(e)}`, entities: [] });
  }
  if (!runpodData)
    return json({ error: "unexpected_runpod_response", entities: [], state: "unknown" });

  const status = typeof runpodData.status === "string" ? runpodData.status : undefined;
  if (status === "COMPLETED" && runpodData.output && typeof runpodData.output === "object") {
    return json({ entities: [], ...(runpodData.output as Record<string, unknown>) });
  }
  if (status === undefined && "entities" in runpodData) {
    return json(runpodData);
  }
  if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    return json({ error: "runpod_queued", entities: [], state: "pending" });
  }
  if (status === "FAILED") {
    return json({
      error: typeof runpodData.error === "string" ? runpodData.error : "runpod_failed",
      entities: [],
    });
  }
  if (typeof runpodData.error === "string") {
    return json({ error: runpodData.error, entities: [] });
  }
  return json({ error: "unexpected_runpod_response", entities: [], state: "unknown" });
});
