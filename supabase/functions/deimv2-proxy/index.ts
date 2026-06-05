/**
 * supabase/functions/deimv2-proxy/index.ts
 *
 * Supabase Edge Function — DEIMv2 RunPod proxy (hardened in Sprint 4A.1).
 *
 * The browser calls this function instead of RunPod directly, so the
 * RUNPOD_API_KEY never reaches the client bundle.
 *
 * Environment secrets required (set via Supabase CLI or dashboard):
 *   RUNPOD_API_KEY      Your RunPod API key
 *   RUNPOD_ENDPOINT_ID  Your RunPod serverless endpoint id
 *
 *   supabase secrets set RUNPOD_API_KEY=rp_...
 *   supabase secrets set RUNPOD_ENDPOINT_ID=abc123
 *   supabase functions deploy deimv2-proxy
 *
 * Request body (from BackendVisionDetector):
 *   { image_b64: string, conf?: number, img_size?: number, classes?: number[] | null }
 *
 * Response — one stable contract, ALWAYS HTTP 200 so the frontend can render a
 * clear state instead of treating it as a transport failure:
 *   { entities: Entity[], model?, inference_ms?, ... } | { error: string, entities: [], state? }
 *
 * Every RunPod response shape is normalized here: COMPLETED/output, a direct
 * worker output, IN_QUEUE/IN_PROGRESS (pending), FAILED, and bare errors.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// CORS — allow requests from the app origin.
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed", entities: [] });

  // Missing secrets → clear, non-error state the UI can show (HTTP 200, not 500).
  const apiKey = Deno.env.get("RUNPOD_API_KEY");
  const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");
  if (!apiKey || !endpointId) {
    return json({ error: "deimv2_backend_not_configured", entities: [], state: "unconfigured" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body", entities: [] });
  }

  const { image_b64, conf = 0.35, img_size = 640, classes = null } = body;
  if (!image_b64 || typeof image_b64 !== "string") {
    return json({ error: "missing_image_b64", entities: [] });
  }

  // Submit to RunPod /runsync (synchronous, waits for the result).
  const runpodUrl = `https://api.runpod.ai/v2/${endpointId}/runsync`;
  let runpodData: Record<string, unknown>;
  try {
    const upstream = await fetch(runpodUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: { image_b64, conf, img_size, classes } }),
    });
    runpodData = (await upstream.json()) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `runpod_unreachable: ${msg}`, entities: [] });
  }

  const status = typeof runpodData.status === "string" ? runpodData.status : undefined;

  // a) RunPod sync/async COMPLETED → forward the worker output (always with entities).
  if (status === "COMPLETED" && runpodData.output && typeof runpodData.output === "object") {
    return json({ entities: [], ...(runpodData.output as Record<string, unknown>) });
  }

  // b) Direct worker output (has "entities", no RunPod "status" envelope) → forward as-is.
  if (status === undefined && "entities" in runpodData) {
    return json(runpodData);
  }

  // c) Still queued / running.
  if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    return json({ error: "runpod_queued", entities: [], state: "pending" });
  }

  // d) Failed.
  if (status === "FAILED") {
    const err = runpodData.error;
    return json({ error: typeof err === "string" ? err : "runpod_failed", entities: [] });
  }

  // e) Bare error passthrough.
  if (typeof runpodData.error === "string") {
    return json({ error: runpodData.error, entities: [] });
  }

  // Unknown shape — surface it without crashing the client.
  return json({ error: "unexpected_runpod_response", entities: [], state: "unknown" });
});
