import type { PlanObjectRole, PlanSceneBlueprint } from "../types";

/**
 * PURE presentational helpers for the Plan console (no DOM, no network,
 * node-testable). They derive small bits of display copy from the scene state —
 * never inventing backend fields, only arranging what the session already has.
 */

/** Sensible electronics/PCB safety defaults shown when the scene clearly
 *  involves boards/connectors and the reasoner didn't supply enough notes. */
const ELECTRONICS_DEFAULTS = [
  "Power down and unplug before handling boards.",
  "Discharge static — touch a grounded surface or wear an ESD strap.",
  "Handle PCBs by the edges; avoid touching the contacts.",
];

/** Generic workspace safety defaults for non-electronics scenes. */
const GENERIC_DEFAULTS = [
  "Keep the work area clear and well lit.",
  "Handle sharp or heavy parts with care.",
];

/** True when the scene's object roles suggest electronics work. */
function looksElectronic(roles: PlanObjectRole[]): boolean {
  return roles.some(
    (r) => r === "primary-part" || r === "connector" || r === "cable" || r === "fastener",
  );
}

/**
 * Derive the "SAFETY NOTES" bullet list for the Plan console. Priority:
 *   1. the active step's safetyNote (when present),
 *   2. a provided fallback safety warning (e.g. the frame-level one),
 *   3. sensible defaults (electronics-aware) to fill the list.
 * De-duplicated, trimmed, and capped. Pure.
 */
export function derivePlanSafetyNotes(
  scene: PlanSceneBlueprint | null | undefined,
  opts?: { fallbackSafety?: string; max?: number },
): string[] {
  const max = opts?.max ?? 3;
  const notes: string[] = [];
  const push = (s?: string | null) => {
    const t = s?.trim();
    if (t && !notes.includes(t)) notes.push(t);
  };

  if (scene) {
    const active = scene.assemblySteps[scene.currentStepIndex];
    push(active?.safetyNote);
  }
  push(opts?.fallbackSafety);

  const electronic = scene ? looksElectronic(scene.objects.map((o) => o.role)) : false;
  const defaults = electronic ? ELECTRONICS_DEFAULTS : GENERIC_DEFAULTS;
  for (const d of defaults) {
    if (notes.length >= max) break;
    push(d);
  }
  return notes.slice(0, max);
}

/**
 * Short assistant summary line for the "AI ASSISTANT" panel. While generating it
 * reads "Thinking…"; otherwise a one-liner that reflects whether a real (AI) or
 * fallback (rules) plan is in play. Pure.
 */
export function planAssistantSummary(args: {
  generating?: boolean;
  reasoningStatus?: "idle" | "thinking" | "ok" | "fallback";
  hasPlan?: boolean;
}): string {
  if (args.generating || args.reasoningStatus === "thinking") return "Thinking…";
  if (!args.hasPlan) return "Capture the parts and set a goal — I'll plan the safest sequence.";
  if (args.reasoningStatus === "fallback") {
    return "I've laid out a basic step-by-step sequence for these parts.";
  }
  return "I've analyzed the workspace and created the safest assembly sequence.";
}

/**
 * Connection state for the header "AI Connected" indicator (mockup):
 *   - "thinking" while a plan is generating (amber "Thinking…"),
 *   - "connected" when the latest reasoning came back ok/fallback (green dot),
 *   - "idle" otherwise (grey). Pure.
 */
export function planConnectionState(args: {
  generating?: boolean;
  reasoningStatus?: "idle" | "thinking" | "ok" | "fallback";
}): "thinking" | "connected" | "idle" {
  if (args.generating || args.reasoningStatus === "thinking") return "thinking";
  if (args.reasoningStatus === "ok" || args.reasoningStatus === "fallback") return "connected";
  return "idle";
}
