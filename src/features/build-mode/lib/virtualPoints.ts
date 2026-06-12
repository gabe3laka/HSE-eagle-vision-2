import type { VirtualBlueprintPoint } from "../types";

/**
 * Visibility policy for the Jarvis-style virtual blueprint points: points
 * linked to the ACTIVE step come first (emphasized); unlinked points next;
 * points linked to other steps last (faded). At most MAX_VISIBLE_POINTS render
 * at once so the ghost never clutters.
 */

export const MAX_VISIBLE_POINTS = 6;

export interface VisiblePoint {
  point: VirtualBlueprintPoint;
  /** Emphasized (active-step-linked or unlinked); false → faded. */
  active: boolean;
}

export function selectVisiblePoints(
  points: VirtualBlueprintPoint[] | undefined,
  activeStepId: string | undefined,
  max = MAX_VISIBLE_POINTS,
): VisiblePoint[] {
  if (!points || points.length === 0) return [];
  const rank = (p: VirtualBlueprintPoint): number => {
    if (activeStepId && p.linkedStepId === activeStepId) return 0;
    if (!p.linkedStepId) return 1;
    return 2;
  };
  return [...points]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, max)
    .map((point) => ({
      point,
      active: !activeStepId || !point.linkedStepId || point.linkedStepId === activeStepId,
    }));
}
