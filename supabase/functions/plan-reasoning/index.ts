/**
 * supabase/functions/plan-reasoning/index.ts
 *
 * SafeLens Plan Reasoner — the reasoning/planning brain for Plan Mode. Receives
 * a compact, image-free planning payload (user goal + YOLO26 labels / contours /
 * outline + selected-crop metadata, all normalized 0..1) and returns a strict
 * PlanReasoningResponse JSON: detectedIntent, suggestedGoals, nextAction,
 * safety/quality, aiNotes, planSteps, planOverlays, virtualBlueprintPoints.
 *
 * DeepSeek is the reasoning engine, NOT a spatial engine — it never invents 3D
 * geometry; it places vector points in the provided normalized 2D crop space.
 *
 * The DEEPSEEK_API_KEY secret stays server-side and is NEVER returned to the
 * browser. On any missing config / timeout / invalid model output, this returns
 * a thin `{ status: "fallback", source: "rules" }` body so the app uses its
 * local rule/template plan flow.
 *
 * Env (Supabase function secrets):
 *   DEEPSEEK_API_KEY              required to call DeepSeek (else → fallback)
 *   DEEPSEEK_BASE_URL            default https://api.deepseek.com
 *   DEEPSEEK_MODEL               default deepseek-v4-pro
 *   PLAN_REASONING_BACKEND       default "deepseek" (anything else → fallback)
 *   PLAN_REASONING_TIMEOUT_MS    default 12000
 *   PLAN_REASONING_MAX_TOKENS    default 1800
 *   PLAN_SEND_IMAGE_TO_DEEPSEEK  default "false" (images are not sent yet)
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

const SYSTEM_PROMPT = `You are SafeLens Plan Reasoner, a cautious visual planning assistant.

You receive structured vision data from a selected camera crop. You do not see reliable 3D space. You must reason only from provided labels, contours, bounding boxes, mask outlines, and the user's goal.

Your job is to create a practical virtual blueprint guide:
- Identify likely main part(s)
- Suggest what the user may be trying to do
- Ask for clarification when needed
- Produce safe, step-by-step plan guidance
- Place virtual blueprint points using normalized crop coordinates
- Create overlays: arrows, targets, ghost-position, highlights, warning-zones, callouts, step-markers

Never invent precise 3D geometry.
Never pretend you know hidden parts.
Never provide dangerous instructions for electrical, chemical, machinery, pressure, height, hot work, or sharp-tool tasks. For dangerous tasks, give safety-first inspection/isolation guidance and tell the user to involve a qualified person.

All x and y values MUST be numbers between 0 and 1 (normalized to the selected crop, origin top-left).

Return ONLY valid JSON matching this TypeScript shape (no prose, no markdown):
{
  "detectedIntent": string,
  "suggestedGoals": string[],
  "nextAction": string,
  "safetyWarning"?: string,
  "qualityCheck"?: string,
  "aiNotes": { "id": string, "type": "instruction"|"safety"|"quality"|"observation"|"next-step"|"intent", "text": string, "x": number, "y": number, "confidence"?: number }[],
  "planSteps": { "id": string, "title": string, "instruction": string, "x": number, "y": number, "status": "active"|"pending"|"completed", "safetyNote"?: string, "qualityCheck"?: string }[],
  "planOverlays": { "id": string, "type": "arrow"|"target"|"ghost-position"|"highlight"|"warning-zone"|"callout"|"step-marker", "x"?: number, "y"?: number, "from"?: {"x":number,"y":number}, "to"?: {"x":number,"y":number}, "label"?: string, "stepId"?: string }[],
  "virtualBlueprintPoints": { "id": string, "role": "anchor"|"alignment-point"|"target-position"|"connection-point"|"inspection-point"|"warning-point", "x": number, "y": number, "label"?: string, "instruction"?: string, "linkedStepId"?: string }[]
}`;

// ── server-side validation / clamp (mirrors the app validator) ──────────────
const NOTE_TYPES = new Set([
  "instruction",
  "safety",
  "quality",
  "observation",
  "next-step",
  "intent",
]);
const OVERLAY_TYPES = new Set([
  "arrow",
  "target",
  "ghost-position",
  "highlight",
  "warning-zone",
  "callout",
  "step-marker",
]);
const POINT_ROLES = new Set([
  "anchor",
  "alignment-point",
  "target-position",
  "connection-point",
  "inspection-point",
  "warning-point",
]);
const STEP_STATUS = new Set(["active", "pending", "completed", "skipped"]);

type Dict = Record<string, unknown>;
const clamp01 = (v: unknown): number =>
  Math.max(0, Math.min(1, typeof v === "number" && Number.isFinite(v) ? v : 0));
const str = (v: unknown, f = ""): string => (typeof v === "string" ? v : f);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function pt(v: unknown): { x: number; y: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Dict;
  if (typeof o.x !== "number" || typeof o.y !== "number") return undefined;
  return { x: clamp01(o.x), y: clamp01(o.y) };
}

function validate(raw: unknown): Dict | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Dict;
  const aiNotes = arr(r.aiNotes).flatMap((n, i) => {
    if (!n || typeof n !== "object") return [];
    const o = n as Dict;
    const text = str(o.text).trim();
    if (!text) return [];
    return [
      {
        id: str(o.id) || `note-${i}`,
        type: NOTE_TYPES.has(o.type as string) ? o.type : "observation",
        text,
        x: clamp01(o.x),
        y: clamp01(o.y),
        confidence: typeof o.confidence === "number" ? o.confidence : undefined,
      },
    ];
  });
  const planSteps = arr(r.planSteps).flatMap((s, i) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Dict;
    const instruction = str(o.instruction).trim();
    if (!instruction) return [];
    return [
      {
        id: str(o.id) || `plan-${i + 1}`,
        title: str(o.title) || `Step ${i + 1}`,
        instruction,
        x: clamp01(o.x),
        y: clamp01(o.y),
        status: STEP_STATUS.has(o.status as string) ? o.status : "pending",
        safetyNote: str(o.safetyNote) || undefined,
        qualityCheck: str(o.qualityCheck) || undefined,
      },
    ];
  });
  const planOverlays = arr(r.planOverlays).flatMap((ov, i) => {
    if (!ov || typeof ov !== "object") return [];
    const o = ov as Dict;
    if (!OVERLAY_TYPES.has(o.type as string)) return [];
    return [
      {
        id: str(o.id) || `ov-${i}`,
        type: o.type,
        x: o.x != null ? clamp01(o.x) : undefined,
        y: o.y != null ? clamp01(o.y) : undefined,
        from: pt(o.from),
        to: pt(o.to),
        label: str(o.label) || undefined,
        stepId: str(o.stepId) || undefined,
      },
    ];
  });
  const virtualBlueprintPoints = arr(r.virtualBlueprintPoints).flatMap((p, i) => {
    if (!p || typeof p !== "object") return [];
    const o = p as Dict;
    return [
      {
        id: str(o.id) || `vbp-${i}`,
        role: POINT_ROLES.has(o.role as string) ? o.role : "anchor",
        x: clamp01(o.x),
        y: clamp01(o.y),
        label: str(o.label) || undefined,
        instruction: str(o.instruction) || undefined,
        linkedStepId: str(o.linkedStepId) || undefined,
      },
    ];
  });
  if (planSteps.length === 0 && aiNotes.length === 0) return null; // unusable
  return {
    detectedIntent: str(r.detectedIntent),
    suggestedGoals: arr(r.suggestedGoals)
      .map((g) => str(g).trim())
      .filter(Boolean)
      .slice(0, 6),
    nextAction: str(r.nextAction),
    safetyWarning: str(r.safetyWarning) || undefined,
    qualityCheck: str(r.qualityCheck) || undefined,
    aiNotes,
    planSteps,
    planOverlays,
    virtualBlueprintPoints,
  };
}

const FALLBACK = { status: "fallback", source: "rules" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(FALLBACK, 200);

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const backend = Deno.env.get("PLAN_REASONING_BACKEND") ?? "deepseek";
  // No key or a non-DeepSeek backend → tell the app to use its local rules.
  if (!apiKey || backend !== "deepseek") return json(FALLBACK, 200);

  let payload: Dict;
  try {
    payload = (await req.json()) as Dict;
  } catch {
    return json(FALLBACK, 200);
  }

  const baseUrl = (Deno.env.get("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com").replace(
    /\/+$/,
    "",
  );
  const model = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-v4-pro";
  const timeoutMs = Number(Deno.env.get("PLAN_REASONING_TIMEOUT_MS") ?? "12000") || 12000;
  const maxTokens = Number(Deno.env.get("PLAN_REASONING_MAX_TOKENS") ?? "1800") || 1800;
  // Images are NOT sent in this first implementation (default false).
  const sendImage = (Deno.env.get("PLAN_SEND_IMAGE_TO_DEEPSEEK") ?? "false") === "true";
  if (!sendImage && "image_b64" in payload) delete payload.image_b64;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!res.ok) return json(FALLBACK, 200);
    const data = (await res.json()) as Dict;
    const content = (data?.choices as Dict[])?.[0]?.message as Dict | undefined;
    const text = str(content?.content);
    if (!text) return json(FALLBACK, 200);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json(FALLBACK, 200);
    }
    const valid = validate(parsed);
    if (!valid) return json(FALLBACK, 200);
    return json({ status: "ok", source: "deepseek", ...valid }, 200);
  } catch {
    return json(FALLBACK, 200); // timeout / network / abort → local rules
  } finally {
    clearTimeout(timer);
  }
});
