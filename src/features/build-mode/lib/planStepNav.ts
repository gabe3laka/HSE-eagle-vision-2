import type { PlanAssemblyStep, PlanSceneObject, PlanSceneBlueprint } from "../types";

/**
 * Pure, user-gated step navigation for the holographic scene canvas. NO timers,
 * NO auto-advance — exactly one step is "active", earlier ones "completed",
 * later ones "pending". The hook keeps `currentStepIndex` and calls these to
 * recompute the step statuses + object states on every nav action.
 *
 * Coordinates are untouched (region-local 0..1) — this only flips statuses.
 */

/** Clamp an index into the valid 0..n-1 range (or 0 when there are no steps). */
export function clampStepIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(index)));
}

/**
 * Re-stamp step statuses for a given active index: index → active, earlier →
 * completed, later → pending. Pure (returns a new array). When there are no
 * steps it returns the (empty) input.
 */
export function applyStepStatuses(
  steps: PlanAssemblyStep[],
  activeIndex: number,
): PlanAssemblyStep[] {
  if (steps.length === 0) return steps;
  const idx = clampStepIndex(activeIndex, steps.length);
  return steps.map((s, i) => ({
    ...s,
    status: i < idx ? "completed" : i === idx ? "active" : "pending",
  }));
}

/**
 * Object visual states for the active step: the active step's object → "moving"
 * (it animates current→target), objects from completed steps → "placed", an
 * object flagged by a step with a safetyNote → "warning", everything else stays
 * "idle". Pure.
 */
export function applyObjectStates(
  objects: PlanSceneObject[],
  steps: PlanAssemblyStep[],
  activeIndex: number,
): PlanSceneObject[] {
  if (objects.length === 0) return objects;
  const idx = clampStepIndex(activeIndex, Math.max(1, steps.length));
  const state = new Map<string, PlanSceneObject["state"]>();
  steps.forEach((step, i) => {
    if (!step.objectId) return;
    if (i < idx) state.set(step.objectId, "placed");
    else if (i === idx) state.set(step.objectId, step.safetyNote ? "warning" : "moving");
  });
  return objects.map((o) => ({ ...o, state: state.get(o.id) ?? "idle" }));
}

/**
 * Apply a new active step index to a whole scene: recompute step statuses +
 * object states + currentStepIndex. The single entry point the hook uses for
 * next/prev/complete/reset. Pure.
 */
export function setActiveStep(scene: PlanSceneBlueprint, index: number): PlanSceneBlueprint {
  const next = clampStepIndex(index, scene.assemblySteps.length);
  return {
    ...scene,
    currentStepIndex: next,
    assemblySteps: applyStepStatuses(scene.assemblySteps, next),
    objects: applyObjectStates(scene.objects, scene.assemblySteps, next),
  };
}

/** Advance to the next step (clamps on the last). No auto-advance — caller-driven. */
export function nextStep(scene: PlanSceneBlueprint): PlanSceneBlueprint {
  return setActiveStep(scene, scene.currentStepIndex + 1);
}

/** Go back to the previous step (clamps on the first). */
export function previousStep(scene: PlanSceneBlueprint): PlanSceneBlueprint {
  return setActiveStep(scene, scene.currentStepIndex - 1);
}

/** Mark the current step completed and advance; the last step stays "active". */
export function completeStep(scene: PlanSceneBlueprint): PlanSceneBlueprint {
  return nextStep(scene);
}

/** Reset back to the first step (all later pending). */
export function resetSteps(scene: PlanSceneBlueprint): PlanSceneBlueprint {
  return setActiveStep(scene, 0);
}
