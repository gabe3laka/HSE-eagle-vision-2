import { supabase } from "@/integrations/supabase/own-client";
import { buildRulesFallback, validatePlanReasoning } from "../lib/planReasoning";
import type { PlanReasoningPayload, PlanReasoningResponse } from "../types";

/**
 * Plan-reasoning client. The DeepSeek key lives ONLY in the Supabase
 * `plan-reasoning` Edge Function — the browser never sees it and never calls
 * DeepSeek directly. We invoke the function through the existing Supabase
 * client/auth flow and re-validate the result defensively.
 *
 * This NEVER throws or rejects: on any error (missing key, timeout, invalid
 * JSON, network, unauthenticated) it resolves a local rule/template fallback so
 * Plan mode always produces guidance and the extracted blueprint stays visible.
 */

type Invoker = (
  name: string,
  opts: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

const defaultInvoke: Invoker = (name, opts) =>
  supabase.functions.invoke(name, opts) as Promise<{ data: unknown; error: unknown }>;

export async function requestPlanReasoning(
  payload: PlanReasoningPayload,
  /** Injectable for tests — defaults to the Supabase Edge Function invoke. */
  invoke: Invoker = defaultInvoke,
): Promise<PlanReasoningResponse> {
  try {
    const { data, error } = await invoke("plan-reasoning", {
      body: payload as unknown as Record<string, unknown>,
    });
    if (error || !data) return buildRulesFallback(payload);
    const valid = validatePlanReasoning(data);
    // A fallback marker, an invalid body, or an empty plan → use local rules so
    // the user still gets a step-by-step guide.
    if (!valid || valid.status === "fallback" || valid.planSteps.length === 0) {
      return buildRulesFallback(payload);
    }
    return valid;
  } catch {
    return buildRulesFallback(payload);
  }
}
