import type {
  ExtractCandidate,
  PlanAnimationKeyframe,
  PlanAssemblyPlanItem,
  PlanAssemblyStep,
  PlanObjectRole,
  PlanSceneBlueprint,
  PlanSceneObject,
  SelectedRegion,
} from "../types";

/**
 * Holographic Scene Canvas — PURE builders (no DOM, no network, node-testable).
 *
 * Turns the LIVE extraction candidates on the table into a multi-object
 * `PlanSceneBlueprint`: one PlanSceneObject per candidate, an ordered assembly
 * plan, and an animation timeline. NOT real 3D, NO point clouds, NO video — a
 * clean 2D/2.5D layer. All coordinates are region-local normalized 0..1 and
 * CLAMPED, the same convention as every other BlueprintFrame field.
 *
 *   candidates → buildPlanSceneBlueprint()  (initial scene, placeholder steps)
 *   assemblyPlan → buildAssemblyStepsAndTimeline()  (DeepSeek/rules → ordered plan)
 *   label → inferPlanObjectRole()  (functional role from the detection label)
 */

const SCENE_VERSION = "plan-scene-v1" as const;

/** Cap so a busy table never floods the canvas (and matches the reasoner cap). */
export const MAX_SCENE_OBJECTS = 16;

function clamp01(v: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

/** Clamp a normalized point into 0..1 (defaults to 0 for non-finite values). */
function clampPoint(p: { x: number; y: number }): { x: number; y: number } {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/**
 * Infer a scene object's functional role from its detection label. Case
 * insensitive; rules are first-match by priority so e.g. "USB connector cable"
 * resolves to "cable" (cable is the strongest signal). Anything unrecognized
 * falls back to "unknown" — the AI can refine it later.
 */
export function inferPlanObjectRole(label: string): PlanObjectRole {
  const l = (label ?? "").toLowerCase();
  if (!l) return "unknown";
  // Cables/wires first — they often co-occur with connector words.
  if (/cable|wire|cord|lead|ribbon/.test(l)) return "cable";
  // Hazards (sharp/edged things) before tools so "blade" wins over generic tool.
  if (/knife|scissor|blade|sharp|razor|cutter|saw/.test(l)) return "hazard";
  // Fasteners — \bscrew\b so "screwdriver" falls through to the tool rule.
  if (/\bscrew\b|bolt|\bnut\b|washer|rivet/.test(l)) return "fastener";
  // Connectors/ports are primary parts with a connector role.
  if (/connector|\bport\b|\busb\b|\bjack\b|\bplug\b|socket|header/.test(l)) return "connector";
  // Primary parts — boards, modules, devices.
  if (/pcb|board|laptop|keyboard|module|sensor|chip|circuit|motherboard|component/.test(l)) {
    return "primary-part";
  }
  // Tools.
  if (/screwdriver|plier|wrench|spanner|\btool\b|hammer|drill|soldering/.test(l)) return "tool";
  // Supports / mounts.
  if (/bracket|stand|mount|holder|clamp|tripod|base/.test(l)) return "support";
  return "unknown";
}

/** bbox centre (region-local 0..1, clamped). */
function bboxCenter(bbox: SelectedRegion): { x: number; y: number } {
  return { x: clamp01(bbox.x + bbox.w / 2), y: clamp01(bbox.y + bbox.h / 2) };
}

/**
 * UPPERCASE display label for a scene object's functional role — used by the
 * Plan console's "Detected objects" list (mockup subtitles: PRIMARY PART /
 * CABLE / TOOL …). Pure, total over PlanObjectRole.
 */
const ROLE_DISPLAY_LABEL: Record<PlanObjectRole, string> = {
  "primary-part": "PRIMARY PART",
  tool: "TOOL",
  connector: "CONNECTOR",
  cable: "CABLE",
  fastener: "FASTENER",
  support: "SUPPORT",
  hazard: "HAZARD",
  unknown: "OBJECT",
};

/** Map a PlanObjectRole to its UPPERCASE display label (unknown → "OBJECT"). */
export function planRoleDisplayLabel(role: PlanObjectRole): string {
  return ROLE_DISPLAY_LABEL[role] ?? "OBJECT";
}

/**
 * Heuristic plan-confidence (0..1) for the "Plan Confidence: NN%" readout. This
 * is a PRESENTATIONAL estimate — there is NO backend confidence field. It blends
 * the reasoning source with the average detection confidence of the scene's
 * objects:
 *   - DeepSeek reasoning ("ok") → a high base (~0.9), nudged ±0.06 by how
 *     confident the detections were.
 *   - rules fallback → a modest base (~0.6), nudged the same way.
 *   - idle / no reasoning yet → ~0.5.
 * Always clamped to 0..1. Pure + deterministic (node-testable).
 */
export function estimatePlanConfidence(args: {
  reasoningStatus?: "idle" | "thinking" | "ok" | "fallback";
  objects?: Array<{ confidence?: number }>;
}): number {
  const objs = args.objects ?? [];
  const known = objs
    .map((o) => o.confidence)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  // Average detection confidence (default 0.7 when nothing carried one).
  const avg = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0.7;
  // Centre the detection signal at 0.7 so a strong scene lifts and a weak one
  // dips the base by a small, bounded amount (±0.06).
  const detectionNudge = Math.max(-0.06, Math.min(0.06, (avg - 0.7) * 0.2));
  const base =
    args.reasoningStatus === "ok"
      ? 0.9
      : args.reasoningStatus === "fallback"
        ? 0.6
        : args.reasoningStatus === "thinking"
          ? 0.55
          : 0.5;
  return clamp01(base + detectionNudge);
}

/** One detected candidate → one idle PlanSceneObject (coords clamped 0..1). */
export function candidateToSceneObject(
  candidate: ExtractCandidate,
  index: number,
): PlanSceneObject {
  const bbox = {
    x: clamp01(candidate.bbox.x),
    y: clamp01(candidate.bbox.y),
    w: clamp01(candidate.bbox.w),
    h: clamp01(candidate.bbox.h),
  };
  const center = bboxCenter(candidate.bbox);
  const maskContour = candidate.maskContour?.length
    ? candidate.maskContour.map(clampPoint)
    : undefined;
  return {
    id: `obj-${index + 1}`,
    label: candidate.label || "object",
    role: inferPlanObjectRole(candidate.label),
    confidence: candidate.confidence,
    bbox,
    center,
    ...(maskContour ? { maskContour, outline: maskContour } : {}),
    current: { x: center.x, y: center.y },
    state: "idle",
  };
}

/**
 * Build the assembly steps + animation timeline from an ordered `assemblyPlan`
 * (DeepSeek or the rules fallback). PURE. objectIds that don't exist in the
 * scene are kept on the step but produce no movement keyframe (the renderer
 * shows a callout only); x/y are clamped 0..1. The first step is "active", the
 * rest "pending" — there is NO auto-advance (the user gates progress).
 */
export function buildAssemblyStepsAndTimeline(
  plan: PlanAssemblyPlanItem[],
  objects: PlanSceneObject[],
): { assemblySteps: PlanAssemblyStep[]; animationTimeline: PlanAnimationKeyframe[] } {
  const objectIds = new Set(objects.map((o) => o.id));
  const assemblySteps: PlanAssemblyStep[] = plan.map((item, i) => {
    const objectId = item.objectId && objectIds.has(item.objectId) ? item.objectId : undefined;
    const from = item.from ? clampPoint(item.from) : undefined;
    const to = item.to ? clampPoint(item.to) : undefined;
    return {
      id: `step-${i + 1}`,
      index: i,
      title: item.title || `Step ${i + 1}`,
      instruction: item.instruction || item.title || `Step ${i + 1}`,
      objectId,
      from,
      to,
      x: to?.x,
      y: to?.y,
      status: i === 0 ? "active" : "pending",
      safetyNote: item.safetyNote || undefined,
      qualityCheck: item.qualityCheck || undefined,
    };
  });
  return { assemblySteps, animationTimeline: buildTimeline(assemblySteps, objects) };
}

/**
 * Build the animation timeline for a set of steps: per step a highlight, an
 * optional move (only when the step targets a real object AND has a `to`), an
 * arrow + target when it moves, a callout for the instruction, a warning pulse
 * for safety notes, and a complete-step marker. Pure vectors — never video.
 */
export function buildTimeline(
  steps: PlanAssemblyStep[],
  objects: PlanSceneObject[],
): PlanAnimationKeyframe[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const keyframes: PlanAnimationKeyframe[] = [];
  const STEP_MS = 1600;
  steps.forEach((step, i) => {
    const base = i * STEP_MS;
    const obj = step.objectId ? byId.get(step.objectId) : undefined;
    if (obj) {
      keyframes.push({
        id: `kf-${step.id}-hi`,
        stepId: step.id,
        type: "highlight-object",
        timeMs: base,
        objectId: obj.id,
        label: step.title,
      });
      const from = step.from ?? obj.current;
      const to = step.to;
      if (to) {
        keyframes.push({
          id: `kf-${step.id}-move`,
          stepId: step.id,
          type: "move-object",
          timeMs: base + 200,
          objectId: obj.id,
          from: { x: from.x, y: from.y },
          to,
        });
        keyframes.push({
          id: `kf-${step.id}-arrow`,
          stepId: step.id,
          type: "show-arrow",
          timeMs: base + 200,
          objectId: obj.id,
          from: { x: from.x, y: from.y },
          to,
        });
        keyframes.push({
          id: `kf-${step.id}-target`,
          stepId: step.id,
          type: "show-target",
          timeMs: base + 200,
          objectId: obj.id,
          to,
        });
      }
    }
    keyframes.push({
      id: `kf-${step.id}-callout`,
      stepId: step.id,
      type: "show-callout",
      timeMs: base + 400,
      objectId: step.objectId,
      label: step.instruction,
    });
    if (step.safetyNote) {
      keyframes.push({
        id: `kf-${step.id}-warn`,
        stepId: step.id,
        type: "warning-pulse",
        timeMs: base + 400,
        objectId: step.objectId,
        label: step.safetyNote,
      });
    }
    keyframes.push({
      id: `kf-${step.id}-done`,
      stepId: step.id,
      type: "complete-step",
      timeMs: base + STEP_MS - 100,
      objectId: step.objectId,
    });
  });
  return keyframes;
}

/** Placeholder "Review {label}" steps before the reasoner returns a real plan. */
function placeholderPlan(objects: PlanSceneObject[]): PlanAssemblyPlanItem[] {
  if (objects.length === 0) {
    return [{ title: "Scan the scene", instruction: "Point the camera at the parts on the table" }];
  }
  return objects.map((o) => ({
    objectId: o.id,
    title: `Review ${o.label}`,
    instruction: `Review ${o.label} and confirm it is the right part`,
  }));
}

/**
 * Build the initial holographic scene blueprint from the live extraction
 * candidates: one object per candidate (capped), simple placeholder review
 * steps + a timeline, and currentStepIndex 0. When the Plan reasoner returns an
 * `assemblyPlan`, `applyAssemblyPlanToScene` re-derives the steps + targets.
 */
export function buildPlanSceneBlueprint(args: {
  region: SelectedRegion;
  candidates: ExtractCandidate[];
  sourceAssetId?: string;
  goal?: string;
}): PlanSceneBlueprint {
  const objects = args.candidates.slice(0, MAX_SCENE_OBJECTS).map(candidateToSceneObject);
  const { assemblySteps, animationTimeline } = buildAssemblyStepsAndTimeline(
    placeholderPlan(objects),
    objects,
  );
  return {
    version: SCENE_VERSION,
    region: args.region,
    sourceAssetId: args.sourceAssetId,
    objects,
    assemblySteps,
    animationTimeline,
    currentStepIndex: 0,
  };
}

/**
 * Apply a reasoner `assemblyPlan` onto an existing scene: re-derive the ordered
 * steps + timeline and stamp each moved object's `target` from the step that
 * moves it (first step that references the object with a `to`). PURE — returns a
 * new scene; objectIds not in the scene are ignored for targeting. Preserves
 * the region/sourceAssetId; resets currentStepIndex to 0 (a new plan starts at
 * step 1).
 */
export function applyAssemblyPlanToScene(
  scene: PlanSceneBlueprint,
  plan: PlanAssemblyPlanItem[],
): PlanSceneBlueprint {
  if (plan.length === 0) return scene;
  const { assemblySteps, animationTimeline } = buildAssemblyStepsAndTimeline(plan, scene.objects);
  const targetByObject = new Map<string, { x: number; y: number }>();
  for (const step of assemblySteps) {
    if (step.objectId && step.to && !targetByObject.has(step.objectId)) {
      targetByObject.set(step.objectId, step.to);
    }
  }
  const objects = scene.objects.map((o) => {
    const target = targetByObject.get(o.id);
    return target ? { ...o, target: { x: target.x, y: target.y } } : { ...o, target: undefined };
  });
  return { ...scene, objects, assemblySteps, animationTimeline, currentStepIndex: 0 };
}
