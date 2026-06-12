import type {
  BlueprintFrame,
  BlueprintNote,
  BlueprintPlanOverlay,
  BuildUserIntent,
  PlanReasoningPayload,
  PlanReasoningResponse,
  PlanStep,
  SelectedRegion,
  VirtualBlueprintPoint,
} from "../types";
import { intentLabel, isDangerousTask, mockPlanOverlays, stepTemplateForIntent } from "./blueprint";

/**
 * Pure Plan-reasoning helpers — no DOM, no network, unit-testable.
 *
 *   payload  → buildPlanReasoningPayload()  (compact, image-free context)
 *   response ← validatePlanReasoning()      (strict parse + clamp of DeepSeek)
 *   fallback ← buildRulesFallback()         (local templates when DeepSeek is out)
 *   frame    ← mergePlanReasoning()          (worker geometry + reasoning fields)
 *
 * Coordinate system is always region-local normalized 0..1 — a clean 2.5D
 * vector planning layer, never a real 3D point cloud.
 */

const NOTE_TYPES = new Set<BlueprintNote["type"]>([
  "instruction",
  "safety",
  "quality",
  "observation",
  "next-step",
  "intent",
]);
const OVERLAY_TYPES = new Set<BlueprintPlanOverlay["type"]>([
  "arrow",
  "target",
  "ghost-position",
  "highlight",
  "warning-zone",
  "callout",
  "step-marker",
]);
const POINT_ROLES = new Set<VirtualBlueprintPoint["role"]>([
  "anchor",
  "alignment-point",
  "target-position",
  "connection-point",
  "inspection-point",
  "warning-point",
]);
const STEP_STATUS = new Set<PlanStep["status"]>(["active", "pending", "completed", "skipped"]);

function clamp01(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function clampPoint(p: unknown): { x: number; y: number } | undefined {
  if (!p || typeof p !== "object") return undefined;
  const o = p as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number") return undefined;
  return { x: clamp01(o.x), y: clamp01(o.y) };
}

/**
 * Strictly validate + clamp a raw plan-reasoning result (e.g. DeepSeek JSON).
 * Every x/y is clamped to 0..1; unknown note/overlay/role/status values are
 * coerced to safe defaults; non-objects return null so the caller can fall back.
 */
export function validatePlanReasoning(raw: unknown): PlanReasoningResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const aiNotes: BlueprintNote[] = arr(r.aiNotes).flatMap((n, i) => {
    if (!n || typeof n !== "object") return [];
    const o = n as Record<string, unknown>;
    const text = str(o.text).trim();
    if (!text) return [];
    const type = NOTE_TYPES.has(o.type as BlueprintNote["type"])
      ? (o.type as BlueprintNote["type"])
      : "observation";
    return [
      {
        id: str(o.id) || `note-${i}`,
        type,
        text,
        x: clamp01(o.x),
        y: clamp01(o.y),
        timestampMs: 0,
        confidence: typeof o.confidence === "number" ? o.confidence : undefined,
      },
    ];
  });

  const planSteps: PlanStep[] = arr(r.planSteps).flatMap((s, i) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const instruction = str(o.instruction).trim();
    if (!instruction) return [];
    const status = STEP_STATUS.has(o.status as PlanStep["status"])
      ? (o.status as PlanStep["status"])
      : "pending";
    return [
      {
        id: str(o.id) || `plan-${i + 1}`,
        title: str(o.title) || `Step ${i + 1}`,
        instruction,
        x: clamp01(o.x),
        y: clamp01(o.y),
        status,
        safetyNote: str(o.safetyNote) || undefined,
        qualityCheck: str(o.qualityCheck) || undefined,
      },
    ];
  });

  const planOverlays: BlueprintPlanOverlay[] = arr(r.planOverlays).flatMap((ov, i) => {
    if (!ov || typeof ov !== "object") return [];
    const o = ov as Record<string, unknown>;
    // Unknown overlay types are dropped (the renderer also ignores them).
    if (!OVERLAY_TYPES.has(o.type as BlueprintPlanOverlay["type"])) return [];
    return [
      {
        id: str(o.id) || `ov-${i}`,
        type: o.type as BlueprintPlanOverlay["type"],
        x: o.x != null ? clamp01(o.x) : undefined,
        y: o.y != null ? clamp01(o.y) : undefined,
        from: clampPoint(o.from),
        to: clampPoint(o.to),
        label: str(o.label) || undefined,
        stepId: str(o.stepId) || undefined,
      },
    ];
  });

  const virtualBlueprintPoints: VirtualBlueprintPoint[] = arr(r.virtualBlueprintPoints).flatMap(
    (p, i) => {
      if (!p || typeof p !== "object") return [];
      const o = p as Record<string, unknown>;
      // Unknown roles are coerced to "anchor" so the data stays well-typed.
      const role = POINT_ROLES.has(o.role as VirtualBlueprintPoint["role"])
        ? (o.role as VirtualBlueprintPoint["role"])
        : "anchor";
      return [
        {
          id: str(o.id) || `vbp-${i}`,
          role,
          x: clamp01(o.x),
          y: clamp01(o.y),
          z: typeof o.z === "number" ? o.z : undefined,
          label: str(o.label) || undefined,
          instruction: str(o.instruction) || undefined,
          linkedStepId: str(o.linkedStepId) || undefined,
        },
      ];
    },
  );

  return {
    status: r.status === "ok" ? "ok" : "fallback",
    source: r.source === "deepseek" ? "deepseek" : "rules",
    detectedIntent: str(r.detectedIntent),
    suggestedGoals: arr(r.suggestedGoals)
      .map((g) => str(g).trim())
      .filter(Boolean)
      .slice(0, 6),
    nextAction: str(r.nextAction),
    safetyWarning: str(r.safetyWarning) || undefined,
    qualityCheck: str(r.qualityCheck) || undefined,
    aiNotes,
    // Hard caps — a runaway model can never flood the ghost.
    planSteps: planSteps.slice(0, 8),
    planOverlays: planOverlays.slice(0, 12),
    virtualBlueprintPoints: virtualBlueprintPoints.slice(0, 20),
  };
}

/** Default goal chips per task (used when the reasoner returns none). */
const SUGGESTED_GOALS = [
  "Identify these parts",
  "Help assemble these pieces",
  "Inspect for damage",
  "Troubleshoot this item",
];

/**
 * Local rule/template fallback — same shape as a DeepSeek response, built from
 * the confirmed intent + the existing template engine. Used whenever DeepSeek
 * is unavailable, times out, or returns invalid JSON. Always status "fallback".
 */
export function buildRulesFallback(payload: PlanReasoningPayload): PlanReasoningResponse {
  const intent: BuildUserIntent = {
    taskType: payload.taskType,
    text: payload.goalText,
    confirmed: true,
  };
  const dangerous = isDangerousTask(intent);
  const template = stepTemplateForIntent(intent);
  const planSteps: PlanStep[] = template.map((s, i) => ({
    ...s,
    id: `plan-${i + 1}`,
    status: i === 0 ? "active" : "pending",
  }));
  const planOverlays = mockPlanOverlays(planSteps, 0, intent);
  const active = planSteps[0];
  const safety =
    active?.safetyNote ??
    (dangerous ? "Safety reminder: confirm the task is safe before any action." : undefined);

  const aiNotes: BlueprintNote[] = [];
  if (active) {
    aiNotes.push({
      id: "note-next-0",
      type: "next-step",
      text: `Possible next step: ${active.instruction}`,
      x: clamp01(active.x ?? 0.5),
      y: clamp01(active.y ?? 0.5),
      timestampMs: 0,
    });
  }
  if (safety) {
    aiNotes.push({
      id: "note-safety-0",
      type: "safety",
      text: safety,
      x: 0.5,
      y: 0.12,
      timestampMs: 0,
    });
  }

  // Virtual points: an anchor per step + a target/warning on the active one.
  const virtualBlueprintPoints: VirtualBlueprintPoint[] = planSteps.flatMap((s) => {
    if (s.x == null || s.y == null) return [];
    return [
      {
        id: `vbp-${s.id}`,
        role: dangerous ? "warning-point" : s.status === "active" ? "target-position" : "anchor",
        x: clamp01(s.x),
        y: clamp01(s.y),
        label: s.title,
        instruction: s.instruction,
        linkedStepId: s.id,
      },
    ];
  });

  const goal = intentLabel(intent);
  return {
    status: "fallback",
    source: "rules",
    detectedIntent: `Goal: ${goal}${active ? ` — ${active.title.toLowerCase()}` : ""}`,
    suggestedGoals: SUGGESTED_GOALS,
    nextAction: dangerous
      ? "Possible next step: confirm it is safe, then identify the component"
      : active
        ? `Possible next step: ${active.instruction}`
        : "Frame the item and describe your goal",
    safetyWarning: safety,
    qualityCheck: active?.qualityCheck,
    aiNotes,
    planSteps,
    planOverlays,
    virtualBlueprintPoints,
  };
}

/**
 * Assemble the compact, image-free payload sent to the Supabase plan-reasoning
 * function. Only labels / contours / outlines / the user's goal — never a
 * full-size camera frame.
 */
export function buildPlanReasoningPayload(opts: {
  sessionId: string;
  intent: BuildUserIntent;
  frame: BlueprintFrame;
  region?: SelectedRegion | null;
  selectedLabel?: string;
  detectedEntities?: PlanReasoningPayload["detectedEntities"];
  segments?: PlanReasoningPayload["segments"];
  /** The latest follow-up text (when refining an existing plan). */
  followUpText?: string;
  /** Compact recent conversation (last few user/assistant turns). */
  history?: PlanReasoningPayload["history"];
}): PlanReasoningPayload {
  const { frame } = opts;
  const depthPoints = frame.depthPoints?.slice(0, 24);
  return {
    sessionId: opts.sessionId,
    workflowMode: "plan",
    goalText: opts.intent.text,
    taskType: opts.intent.taskType,
    selectedLabel: opts.selectedLabel,
    detectedEntities: opts.detectedEntities?.slice(0, 12),
    segments: opts.segments?.slice(0, 8),
    blueprintFrame: {
      outline: frame.outline,
      maskContour: frame.maskContour,
      maskSource: frame.maskSource,
    },
    ...(depthPoints?.length ? { depthPoints } : {}),
    ...(opts.followUpText ? { followUpText: opts.followUpText } : {}),
    ...(opts.history?.length ? { history: opts.history.slice(-6) } : {}),
    coordinateSystem: depthPoints?.length
      ? {
          type: "normalized-crop-2d-plus-optional-depth",
          xRange: [0, 1],
          yRange: [0, 1],
          origin: "top-left",
          zMeaning: "relative pseudo-depth, optional",
        }
      : { type: "normalized-crop-2d", xRange: [0, 1], yRange: [0, 1], origin: "top-left" },
  };
}

/**
 * Merge a plan-reasoning result onto the worker's blueprint frame. The worker
 * geometry (crop / outline / mask / anchors) is the visual base and is NEVER
 * replaced; DeepSeek/rules contribute the reasoning + instructions + virtual
 * points. Non-empty reasoning fields win; otherwise the worker's stay.
 */
export function mergePlanReasoning(
  frame: BlueprintFrame,
  resp: PlanReasoningResponse,
): BlueprintFrame {
  const active = resp.planSteps.findIndex((s) => s.status === "active");
  return {
    ...frame,
    detectedIntent: resp.detectedIntent || frame.detectedIntent,
    nextAction: resp.nextAction || frame.nextAction,
    safetyWarning: resp.safetyWarning ?? frame.safetyWarning,
    qualityCheck: resp.qualityCheck ?? frame.qualityCheck,
    aiNotes: resp.aiNotes.length ? resp.aiNotes : frame.aiNotes,
    planSteps: resp.planSteps.length ? resp.planSteps : frame.planSteps,
    currentPlanStepIndex: resp.planSteps.length
      ? active >= 0
        ? active
        : 0
      : frame.currentPlanStepIndex,
    planOverlays: resp.planOverlays.length ? resp.planOverlays : frame.planOverlays,
    virtualBlueprintPoints: resp.virtualBlueprintPoints,
    suggestedGoals: resp.suggestedGoals.length ? resp.suggestedGoals : frame.suggestedGoals,
    reasoningSource: resp.source,
    importance: resp.safetyWarning ? "high" : frame.importance,
  };
}
