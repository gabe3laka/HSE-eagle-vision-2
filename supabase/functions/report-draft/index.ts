/**
 * supabase/functions/report-draft/index.ts
 *
 * Home composer agent (Plan 1, Phase 1). Turns a worker's free-text / voice
 * transcript (plus a count of attached photos) into a STRUCTURED safety report
 * draft the human then reviews and files. It never writes to the database and
 * never files an incident — it only returns a suggestion; the app's
 * /report/:id review screen is the approval gate.
 *
 * Backend: DeepSeek (same secret + pattern as hse-risk-reasoning). When the key
 * is absent or the call fails/times out, it returns a deterministic rules-based
 * draft (source: "rules") so the composer flow always works — honest degradation,
 * never a hard failure. The response draft is always validated against the app's
 * hazard_type / severity enums.
 *
 * Secrets (never returned to the client):
 *   DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, REPORT_DRAFT_BACKEND
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Dict = Record<string, unknown>;

const HAZARD_TYPES = [
  "unsafe_lift",
  "ppe_missing",
  "person_proximity",
  "restricted_zone",
  "blocked_exit",
  "forklift_proximity",
  "fall_risk",
] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const REPORT_TYPES = ["near_miss", "hazard", "incident"] as const;

type HazardType = (typeof HAZARD_TYPES)[number];
type Severity = (typeof SEVERITIES)[number];
type ReportType = (typeof REPORT_TYPES)[number];

interface Draft {
  report_type: ReportType;
  hazard_type: HazardType;
  severity: Severity;
  title: string;
  summary: string;
  probable_cause: string;
  corrective_action: string;
  confidence: number;
  source: "deepseek" | "rules";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(1, n));
}

/** Keyword → hazard_type, severity, report_type. The deterministic fallback and
 *  a sane default when the model omits a field. */
function ruleClassify(text: string): {
  hazard_type: HazardType;
  severity: Severity;
  report_type: ReportType;
} {
  const t = text.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  let hazard_type: HazardType = "person_proximity";
  if (has("lift", "lifting", "heavy", "back strain", "carry")) hazard_type = "unsafe_lift";
  else if (has("ppe", "helmet", "hard hat", "gloves", "goggles", "hi-vis", "vest", "mask"))
    hazard_type = "ppe_missing";
  else if (has("forklift", "fork lift", "pallet truck", "reach truck")) hazard_type = "forklift_proximity";
  else if (has("exit", "blocked", "doorway", "fire door", "egress")) hazard_type = "blocked_exit";
  else if (has("restricted", "barrier", "keep out", "cordon", "exclusion")) hazard_type = "restricted_zone";
  else if (has("fall", "height", "ladder", "scaffold", "edge", "roof", "opening")) hazard_type = "fall_risk";

  let severity: Severity = "medium";
  if (has("fatal", "death", "critical", "serious", "amputat", "crush")) severity = "critical";
  else if (has("injury", "injured", "hurt", "blood", "hospital", "fracture")) severity = "high";
  else if (has("near miss", "near-miss", "almost", "nearly", "could have")) severity = "medium";
  else if (has("minor", "small", "low risk")) severity = "low";

  let report_type: ReportType = "hazard";
  if (has("near miss", "near-miss", "almost", "nearly", "could have")) report_type = "near_miss";
  else if (has("injury", "injured", "hurt", "accident", "incident", "happened")) report_type = "incident";

  return { hazard_type, severity, report_type };
}

const HAZARD_LABEL: Record<HazardType, string> = {
  unsafe_lift: "Unsafe manual handling",
  ppe_missing: "Missing PPE",
  person_proximity: "Unsafe proximity",
  restricted_zone: "Restricted-zone entry",
  blocked_exit: "Blocked exit / egress",
  forklift_proximity: "Forklift / vehicle proximity",
  fall_risk: "Fall from height",
};

const CORRECTIVE: Record<HazardType, string> = {
  unsafe_lift: "Reassess the manual-handling task; use mechanical aids or a team lift and brief the crew.",
  ppe_missing: "Stop work until required PPE is worn; check stock and reinforce the PPE policy at the point of use.",
  person_proximity: "Establish and mark a safe separation distance; use a spotter or barriers where people and plant mix.",
  restricted_zone: "Reinstate barriers/signage and confirm only authorised, permitted persons enter the zone.",
  blocked_exit: "Clear the exit route immediately and add a daily housekeeping check to keep egress clear.",
  forklift_proximity: "Segregate pedestrians from vehicles; enforce give-way rules, lighting and audible warnings.",
  fall_risk: "Provide edge protection / guardrails or a suitable fall-arrest system and inspect access equipment.",
};

/** Deterministic draft from the raw text — the always-available fallback. */
function rulesDraft(text: string, mediaCount: number): Draft {
  const { hazard_type, severity, report_type } = ruleClassify(text);
  const trimmed = text.trim();
  const firstLine = trimmed.split(/[.\n]/)[0]?.slice(0, 80).trim() || HAZARD_LABEL[hazard_type];
  const mediaNote = mediaCount > 0 ? ` (${mediaCount} photo${mediaCount === 1 ? "" : "s"} attached)` : "";
  return {
    report_type,
    hazard_type,
    severity,
    title: firstLine,
    summary: (trimmed || "No description provided.") + mediaNote,
    probable_cause: "To be confirmed on review — described by the reporter.",
    corrective_action: CORRECTIVE[hazard_type],
    confidence: 0.5,
    source: "rules",
  };
}

/** Coerce a model object into a validated Draft, filling gaps from the rules. */
function coerceDraft(raw: unknown, text: string, mediaCount: number): Draft {
  const base = rulesDraft(text, mediaCount);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Dict;
  const hazard = str(o.hazard_type) as HazardType;
  const sev = str(o.severity) as Severity;
  const rtype = str(o.report_type) as ReportType;
  return {
    report_type: REPORT_TYPES.includes(rtype) ? rtype : base.report_type,
    hazard_type: HAZARD_TYPES.includes(hazard) ? hazard : base.hazard_type,
    severity: SEVERITIES.includes(sev) ? sev : base.severity,
    title: str(o.title).trim() || base.title,
    summary: str(o.summary).trim() || base.summary,
    probable_cause: str(o.probable_cause).trim() || base.probable_cause,
    corrective_action: str(o.corrective_action).trim() || base.corrective_action,
    confidence: clampConfidence(o.confidence),
    source: "deepseek",
  };
}

const SYSTEM_PROMPT = `You are a workplace HSE (health, safety & environment) assistant.
Turn the reporter's note into ONE structured safety report draft as strict JSON.
Return ONLY a JSON object with these fields:
- report_type: one of ["near_miss","hazard","incident"]
- hazard_type: one of ["unsafe_lift","ppe_missing","person_proximity","restricted_zone","blocked_exit","forklift_proximity","fall_risk"]
- severity: one of ["low","medium","high","critical"]
- title: short human title (<= 80 chars)
- summary: 1-3 sentence factual summary of what was reported
- probable_cause: brief likely cause
- corrective_action: a concrete corrective action
- confidence: 0..1 number for how well the note maps to the chosen category
Be conservative; if unsure choose the closest category and a lower confidence. Do not invent facts not implied by the note.`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: Dict;
  try {
    payload = (await req.json()) as Dict;
  } catch {
    payload = {};
  }
  const text = [str(payload.text), str(payload.transcript)].filter(Boolean).join("\n\n").trim();
  const mediaCount = Array.isArray(payload.media) ? payload.media.length : 0;

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const backend = Deno.env.get("REPORT_DRAFT_BACKEND") ?? "deepseek";

  // No key / disabled → deterministic rules draft (loop still works).
  if (!apiKey || backend !== "deepseek" || !text) {
    return json({ status: "ok", draft: rulesDraft(text, mediaCount) }, 200);
  }

  const baseUrl = (Deno.env.get("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const model = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-v4-flash";
  const timeoutMs = Number(Deno.env.get("REPORT_DRAFT_TIMEOUT_MS") ?? "18000") || 18000;
  const wantThinking = (Deno.env.get("DEEPSEEK_THINKING") ?? "disabled") === "enabled";

  const reqBody: Dict = {
    model,
    max_tokens: 900,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Reporter note:\n${text}\n\nAttached photos: ${mediaCount}`,
      },
    ],
  };
  if (model.startsWith("deepseek-v4")) {
    reqBody.thinking = { type: wantThinking ? "enabled" : "disabled" };
  }

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
      return json({ status: "ok", draft: rulesDraft(text, mediaCount) }, 200);
    }
    const data = (await res.json()) as Dict;
    const content = str((((data?.choices as Dict[]) ?? [])[0]?.message as Dict)?.content);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    return json({ status: "ok", draft: coerceDraft(parsed, text, mediaCount) }, 200);
  } catch {
    return json({ status: "ok", draft: rulesDraft(text, mediaCount) }, 200);
  } finally {
    clearTimeout(timer);
  }
});
