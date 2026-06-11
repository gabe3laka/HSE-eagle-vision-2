/**
 * Debug labels (mask source, anchor names like A1/A2) only ever appear in dev
 * builds AND when explicitly opted in — never on the holographic ghost by
 * default. Kept in its own module so the renderer can stay a pure component.
 */
export function shouldShowBlueprintDebugLabels(show?: boolean): boolean {
  return !!show && import.meta.env.DEV;
}
