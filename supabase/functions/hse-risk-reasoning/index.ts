/**
 * supabase/functions/hse-risk-reasoning/index.ts
 *
 * SafeLens Eagle Vision — HSE wearable safety reasoning. Receives a compact,
 * image-free scene summary (tracked objects + poses + zones + the local risk
 * engine's candidate alerts) and returns a strict HSERiskReasoningResponse:
 * prioritized, short, action-oriented wearable alerts with overlay hints.
 *
 * DeepSeek is the reasoning engine. The DEEPSEEK_API_KEY secret stays
 * server-side and is NEVER returned to the browser. On any missing config /
 * timeout / invalid output, this returns `{ status:"fallback", source:"rules" }`
 * so the app uses its local risk-engine alerts (never blocking real-time).
 *
 * Env (Supabase function secrets):
 *   DEEPSEEK_API_KEY               required (else → fallback)
 *   DEEPSEEK_BASE_URL             default https://api.deepseek.com
 *   DEEPSEEK_MODEL                default deepseek-v4-flash (fast model)
 *   DEEPSEEK_THINKING             default "disabled" — v4 models default to slow
 *                                  chain-of-thought "thinking" mode, which blows
 *                                  the latency budget and forces the rules
 *                                  fallback. Disabled here for fast non-thinking
 *                                  JSON; set "enabled" to opt back into reasoning.
 *   HSE_REASONING_BACKEND         default "deepseek" (else → fallback)
 *   HSE_REASONING_TIMEOUT_MS      default 16000
 *   HSE_REASONING_MAX_TOKENS      default 1400
 *   HSE_REASONING_SEND_THUMBNAIL  default "false" (no images sent)
 */

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

const SYSTEM_PROMPT = `You are SafeLens Eagle Vision, an HSE wearable safety reasoning assistant.

You receive structured detections from a camera or wearable safety system. You do not control the camera. You do not invent detections. You must reason only from the provided objects, poses, zones, tracks, and candidate alerts.

Your job:
- Prioritize safety risks
- Explain what appears unsafe
- Recommend clear immediate action
- Produce short wearable-friendly alerts
- Avoid alarm spam
- Be cautious when confidence is low
- Never claim certainty when detections are weak
- Never provide unsafe operational instructions

Return only valid JSON matching the schema.

For high-risk conditions:
- Keep messages short
- Use action language
- Example: "Step back from vehicle path."
- Example: "Check PPE before entering zone."
- Example: "Stop and inspect blocked walkway."

If evidence is insufficient:
- mark uncertainty
- recommend review
- do not invent labels or hazards.

Return ONLY a valid json object matching this shape (no prose, no markdown):
{
  "sceneCaption": string,
  "highestSeverity": "info"|"low"|"medium"|"high"|"critical",
  "alerts": { "id": string, "severity": "info"|"low"|"medium"|"high"|"critical", "category": "proximity"|"ppe"|"zone"|"ergonomics"|"trip-slip"|"fire-safety"|"blocked-access"|"unknown-review", "title": string, "shortMessage": string, "spokenMessage": string, "recommendedAction": string, "confidence": number, "relatedTrackIds": string[], "overlay"?: { "type": "box"|"arrow"|"zone"|"ring"|"label", "x"?: number, "y"?: number, "w"?: number, "h"?: number, "from"?: {"x":number,"y":number}, "to"?: {"x":number,"y":number}, "label"?: string }, "wearablePattern": "none"|"soft-tap"|"double-tap"|"urgent-pulse"|"continuous-critical" }[],
  "supervisorSummary": string,
  "uncertainty": string[]
}`;

// ── server-side validation / clamp (mirrors the app validator) ──
const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const CATEGORIES = new Set([
  "proximity",
  "ppe",
  "zone",
  "ergonomics",
  "trip-slip",
  "fire-safety",
  "blocked-access",
  "unknown-review",
]);
const OVERLAY_TYPES = new Set(["box", "arrow", "zone", "ring", "label"]);
const WEARABLE = new Set(["none", "soft-tap", "double-tap", "urgent-pulse", "continuous-critical"]);

type Dict = Record<string, unknown>;
const clamp01 = (v: unknown): number =>
  Math.max(0, Math.min(1, typeof v === "number" && Number.isFinite(v) ? v : 0));
const str = (v: unknown, f = ""): string => (typeof v === "string" ? v : f);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function ptOf(v: unknown): { x: number; y: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Dict;
  if (typeof o.x !== "number" || typeof o.y !== "number") return undefined;
  return { x: clamp01(o.x), y: clamp01(o.y) };
}
function overlayOf(v: unknown): Dict | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Dict;
  if (!OVERLAY_TYPES.has(o.type as string)) return undefined;
  return {
    type: o.type,
    x: o.x != null ? clamp01(o.x) : undefined,
    y: o.y != null ? clamp01(o.y) : undefined,
    w: o.w != null ? clamp01(o.w) : undefined,
    h: o.h != null ? clamp01(o.h) : undefined,
    from: ptOf(o.from),
    to: ptOf(o.to),
    label: str(o.label) || undefined,
  };
}

function validate(raw: unknown): Dict | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Dict;
  const alerts = arr(r.alerts).flatMap((a, i) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Dict;
    const shortMessage = str(o.shortMessage).trim() || str(o.title).trim();
    if (!shortMessage) return [];
    return [
      {
        id: str(o.id) || `r-${i}`,
        severity: SEVERITIES.has(o.severity as string) ? o.severity : "info",
        category: CATEGORIES.has(o.category as string) ? o.category : "unknown-review",
        title: str(o.title) || shortMessage,
        shortMessage,
        spokenMessage: str(o.spokenMessage) || shortMessage,
        recommendedAction: str(o.recommendedAction),
        confidence: clamp01(o.confidence),
        relatedTrackIds: arr(o.relatedTrackIds)
          .map((t) => str(t))
          .filter(Boolean),
        overlay: overlayOf(o.overlay),
        wearablePattern: WEARABLE.has(o.wearablePattern as string) ? o.wearablePattern : "none",
      },
    ];
  });
  if (alerts.length === 0) return null;
  return {
    sceneCaption: str(r.sceneCaption),
    highestSeverity: SEVERITIES.has(r.highestSeverity as string) ? r.highestSeverity : "info",
    alerts: alerts.slice(0, 5),
    supervisorSummary: str(r.supervisorSummary),
    uncertainty: arr(r.uncertainty)
      .map((u) => str(u).trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}

const FALLBACK = { status: "fallback", source: "rules" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(FALLBACK, 200);

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const backend = Deno.env.get("HSE_REASONING_BACKEND") ?? "deepseek";
  if (!apiKey || backend !== "deepseek") return json(FALLBACK, 200);

  let payload: Dict;
  try {
    payload = (await req.json()) as Dict;
  } catch {
    return json(FALLBACK, 200);
  }
  // Images are not sent in this implementation (default false).
  const sendThumb = (Deno.env.get("HSE_REASONING_SEND_THUMBNAIL") ?? "false") === "true";
  if (!sendThumb && "thumbnail" in payload) delete payload.thumbnail;

  const baseUrl = (Deno.env.get("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com").replace(
    /\/+$/,
    "",
  );
  const model = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-v4-flash";
  const timeoutMs = Number(Deno.env.get("HSE_REASONING_TIMEOUT_MS") ?? "16000") || 16000;
  const maxTokens = Number(Deno.env.get("HSE_REASONING_MAX_TOKENS") ?? "1400") || 1400;

  // v4 models default to slow chain-of-thought "thinking" mode; disable it for
  // fast non-thinking JSON unless explicitly opted back in. Only v4 models
  // accept the param, so guard it (legacy aliases would reject an unknown field).
  const wantThinking = (Deno.env.get("DEEPSEEK_THINKING") ?? "disabled") === "enabled";
  const reqBody: Dict = {
    model,
    max_tokens: maxTokens,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };
  if (model.startsWith("deepseek-v4")) {
    reqBody.thinking = { type: wantThinking ? "enabled" : "disabled" };
  }

  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.log("hse-risk-reasoning: deepseek non-ok", res.status, errText.slice(0, 300));
      return json(FALLBACK, 200);
    }
    const data = (await res.json()) as Dict;
    const message = (data?.choices as Dict[])?.[0]?.message as Dict | undefined;
    const text = str(message?.content);
    if (!text) {
      console.log("hse-risk-reasoning: deepseek empty content");
      return json(FALLBACK, 200);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log("hse-risk-reasoning: deepseek non-json content");
      return json(FALLBACK, 200);
    }
    const valid = validate(parsed);
    if (!valid) {
      console.log("hse-risk-reasoning: deepseek output failed validation");
      return json(FALLBACK, 200);
    }
    console.log("hse-risk-reasoning: ok", JSON.stringify({ ms: Date.now() - startedAt, model }));
    return json({ status: "ok", source: "deepseek", ...valid }, 200);
  } catch (e) {
    console.log(
      "hse-risk-reasoning: exception",
      (e as Error)?.name ?? "error",
      `${Date.now() - startedAt}ms`,
    );
    return json(FALLBACK, 200);
  } finally {
    clearTimeout(timer);
  }
});
