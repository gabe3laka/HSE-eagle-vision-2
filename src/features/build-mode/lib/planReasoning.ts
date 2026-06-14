import type {
  BlueprintFrame,
  BlueprintNote,
  BlueprintPlanOverlay,
  BuildUserIntent,
  PlanAssemblyPlanItem,
  PlanReasoningPayload,
  PlanReasoningResponse,
  PlanSceneBlueprint,
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
 * Parse + clamp the optional multi-object `assemblyPlan` the Plan reasoner MAY
 * return for the holographic scene canvas. Each item needs an instruction (or a
 * title); from/to are clamped 0..1; objectId is kept as-is here (the scene
 * builder ignores ids it doesn't recognize). Capped so a runaway model can't
 * produce an endless plan. Returns undefined when there's nothing usable so the
 * caller can fall back to the single-object planSteps path.
 */
export function validateAssemblyPlan(raw: unknown): PlanAssemblyPlanItem[] | undefined {
  const items: PlanAssemblyPlanItem[] = arr(raw).flatMap((s, i) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const instruction = str(o.instruction).trim();
    const title = str(o.title).trim();
    if (!instruction && !title) return [];
    return [
      {
        objectId: str(o.objectId) || undefined,
        title: title || `Step ${i + 1}`,
        instruction: instruction || title,
        from: clampPoint(o.from),
        to: clampPoint(o.to),
        safetyNote: str(o.safetyNote) || undefined,
        qualityCheck: str(o.qualityCheck) || undefined,
      },
    ];
  });
  return items.length ? items.slice(0, 16) : undefined;
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
    // Optional multi-object plan for the holographic scene canvas (additive —
    // existing single-object consumers ignore it).
    ...(validateAssemblyPlan(r.assemblyPlan)
      ? { assemblyPlan: validateAssemblyPlan(r.assemblyPlan) }
      : {}),
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
  /** Holographic scene objects (Plan multi-object canvas) so the reasoner can
   *  arrange them by id. Region-local 0..1; capped ~16. */
  sceneObjects?: PlanSceneBlueprint["objects"];
  /** The latest follow-up text (when refining an existing plan). */
  followUpText?: string;
  /** Compact recent conversation (last few user/assistant turns). */
  history?: PlanReasoningPayload["history"];
}): PlanReasoningPayload {
  const { frame } = opts;
  const depthPoints = frame.depthPoints?.slice(0, 24);
  const objects = opts.sceneObjects?.slice(0, 16).map((o) => ({
    id: o.id,
    label: o.label,
    role: o.role,
    bbox: o.bbox,
    center: o.center,
  }));
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
    ...(objects?.length
      ? {
          objects,
          scene: { mode: "table-layout", coordinateSystem: "normalized 0..1 crop-local" },
        }
      : {}),
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

/**
 * Map a plan-reasoning result to an ordered `PlanAssemblyPlanItem[]` for the
 * holographic scene canvas. If the reasoner returned a dedicated `assemblyPlan`
 * it wins (it carries object ids + from/to). Otherwise the existing single-
 * object `planSteps` are mapped 1:1, pulling a step's `to` from the matching
 * arrow/target overlay (by stepId) when one exists. PURE — never throws; an
 * empty plan returns []. This is what bridges the (unchanged) single-object
 * reasoning shape into the multi-object scene without breaking either path.
 */
export function resolveAssemblyPlan(resp: PlanReasoningResponse): PlanAssemblyPlanItem[] {
  if (resp.assemblyPlan?.length) return resp.assemblyPlan;
  const overlays = resp.planOverlays ?? [];
  return (resp.planSteps ?? []).map((step) => {
    // Movement hints from an arrow overlay linked to this step (from/to), or a
    // target/ghost-position overlay (to only).
    const arrow = overlays.find(
      (o) => o.stepId === step.id && o.type === "arrow" && o.from && o.to,
    );
    const target = overlays.find(
      (o) =>
        o.stepId === step.id &&
        (o.type === "target" || o.type === "ghost-position") &&
        o.x != null &&
        o.y != null,
    );
    const to = arrow?.to ?? (target ? { x: target.x as number, y: target.y as number } : undefined);
    const from = arrow?.from;
    return {
      title: step.title,
      instruction: step.instruction,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      safetyNote: step.safetyNote,
      qualityCheck: step.qualityCheck,
    };
  });
}
