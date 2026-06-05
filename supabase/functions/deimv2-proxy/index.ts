// DEIMv2 proxy — forwards a base64 frame to the RunPod DEIMv2 worker and holds
// the backend secret so it never reaches the client. It normalizes the several
// RunPod response shapes into one stable contract:
//   { entities: Entity[], model?: string, state?: string, error?: string }
//
// It ALWAYS responds with HTTP 200 (even "not configured" / errors) so the
// frontend can render a clear state instead of treating it as a transport
// failure.
//
// Secrets (set with `supabase secrets set`):
//   DEIMV2_RUNPOD_URL      — RunPod endpoint, e.g. https://api.runpod.ai/v2/<id>/runsync
//   DEIMV2_RUNPOD_API_KEY  — RunPod API key

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed", entities: [] });

  // Missing secrets → clear, non-error state the UI can show.
  const RUNPOD_URL = Deno.env.get("DEIMV2_RUNPOD_URL");
  const RUNPOD_API_KEY = Deno.env.get("DEIMV2_RUNPOD_API_KEY");
  if (!RUNPOD_URL || !RUNPOD_API_KEY) {
    return json({ error: "deimv2_backend_not_configured", entities: [], state: "unconfigured" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json_body", entities: [] });
  }

  const image_b64 = payload.image_b64;
  if (typeof image_b64 !== "string" || !image_b64) {
    return json({ error: "missing_image_b64", entities: [] });
  }

  let runpodData: Record<string, unknown>;
  try {
    const upstream = await fetch(RUNPOD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          image_b64,
          conf: payload.conf ?? 0.35,
          img_size: payload.img_size ?? 640,
          classes: payload.classes ?? null,
        },
      }),
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
