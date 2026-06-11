import { supabase } from "@/integrations/supabase/own-client";
import type {
  HSEAlertCandidate,
  HSERiskReasoningPayload,
  HSERiskReasoningResponse,
} from "@/lib/detection/hseTypes";
import { buildHseRulesReasoning, validateHseReasoning } from "../lib/hseRiskReasoning";

/**
 * Phase 5 — HSE risk-reasoning client. The DEEPSEEK_API_KEY lives ONLY in the
 * Supabase `hse-risk-reasoning` Edge Function; the browser invokes that function
 * through the existing Supabase client and NEVER calls DeepSeek directly.
 *
 * This never throws: on missing key / timeout / error / invalid JSON it resolves
 * the local rules reasoning (built from the candidate alerts), so real-time
 * alerts are never blocked waiting on DeepSeek.
 */

type Invoker = (
  name: string,
  opts: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

const defaultInvoke: Invoker = (name, opts) =>
  supabase.functions.invoke(name, opts) as Promise<{ data: unknown; error: unknown }>;

export async function requestHseReasoning(
  payload: HSERiskReasoningPayload,
  candidates: HSEAlertCandidate[],
  /** Injectable for tests — defaults to the Supabase Edge Function invoke. */
  invoke: Invoker = defaultInvoke,
): Promise<HSERiskReasoningResponse> {
  try {
    const { data, error } = await invoke("hse-risk-reasoning", {
      body: payload as unknown as Record<string, unknown>,
    });
    if (error || !data) return buildHseRulesReasoning(candidates);
    const valid = validateHseReasoning(data);
    if (!valid || valid.status === "fallback" || valid.alerts.length === 0) {
      return buildHseRulesReasoning(candidates);
    }
    return valid;
  } catch {
    return buildHseRulesReasoning(candidates);
  }
}
