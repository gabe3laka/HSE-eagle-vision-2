/**
 * supabase/functions/deimv2-proxy/index.ts
 *
 * Supabase Edge Function — DEIMv2 RunPod proxy.
 *
 * The browser calls this function instead of calling RunPod directly.
 * This keeps the RUNPOD_API_KEY out of the browser bundle.
 *
 * Environment secrets required (set via Supabase CLI or dashboard):
 *   RUNPOD_API_KEY      Your RunPod API key
 *   RUNPOD_ENDPOINT_ID  Your RunPod serverless endpoint id
 *
 * Set secrets with:
 *   supabase secrets set RUNPOD_API_KEY=rp_...
 *   supabase secrets set RUNPOD_ENDPOINT_ID=abc123
 *
 * Deploy with:
 *   supabase functions deploy deimv2-proxy
 *
 * Request body (forwarded from BackendVisionDetector):
 *   { image_b64: string, conf?: number, img_size?: number, classes?: number[] | null }
 *
 * Response body (forwarded from RunPod worker):
 *   { entities: Entity[], inference_ms: number, model: string, img_w: number, img_h: number }
 *   | { error: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// CORS headers — allow requests from the Eagle Vision 2 app origin.
const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
// Handle CORS preflight
if (req.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}

if (req.method !== "POST") {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Read RunPod credentials from secrets ──────────────────────────────────
const apiKey = Deno.env.get("RUNPOD_API_KEY");
const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");

if (!apiKey || !endpointId) {
  return new Response(
    JSON.stringify({ error: "Missing RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID secret" }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Parse request body ────────────────────────────────────────────────────
let body: Record<string, unknown>;
try {
  body = await req.json();
} catch {
  return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const { image_b64, conf = 0.35, img_size = 640, classes = null } = body;

if (!image_b64 || typeof image_b64 !== "string") {
  return new Response(JSON.stringify({ error: "image_b64 is required" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Submit job to RunPod /runsync (synchronous, waits for result) ─────────
const runpodUrl = `https://api.runpod.ai/v2/${endpointId}/runsync`;

let runpodResp: Response;
try {
  runpodResp = await fetch(runpodUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { image_b64, conf, img_size, classes },
    }),
  });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  return new Response(JSON.stringify({ error: `RunPod fetch failed: ${msg}` }), {
    status: 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (!runpodResp.ok) {
  const text = await runpodResp.text().catch(() => "");
  return new Response(JSON.stringify({ error: `RunPod ${runpodResp.status}: ${text}` }), {
    status: 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const runpodData = await runpodResp.json() as {
  status?: string;
  output?: Record<string, unknown>;
  error?: string;
};

if (runpodData.status !== "COMPLETED" || !runpodData.output) {
  const msg = runpodData.error ?? runpodData.status ?? "unknown RunPod status";
  return new Response(JSON.stringify({ error: msg }), {
    status: 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Forward the worker output directly to the browser.
return new Response(JSON.stringify(runpodData.output), {
  status: 200,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
});
