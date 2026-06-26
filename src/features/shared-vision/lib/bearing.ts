import type { PortalPlacement } from "../types";

export const PORTAL_HALF_FOV_DEG = 33;

/** Wrap angle to [-180, 180): 180 maps to -180, -180 stays -180. */
export function normalize180(deg: number): number {
  let r = deg % 360;
  if (r >= 180) r -= 360;
  else if (r < -180) r += 360;
  return r;
}

/** Circular EMA that handles the 0/360 seam correctly. */
export function circularEma(prev: number, next: number, alpha: number): number {
  const diff = normalize180(next - prev);
  let result = prev + alpha * diff;
  if (result < 0) result += 360;
  if (result >= 360) result -= 360;
  return result;
}

/** Compute portal placement from a peer bearing and current device heading. */
export function computePlacement(
  bearingDeg: number,
  headingDeg: number,
  halfFovDeg = PORTAL_HALF_FOV_DEG,
): PortalPlacement {
  const relativeDeg = normalize180(bearingDeg - headingDeg);
  const onScreen = Math.abs(relativeDeg) <= halfFovDeg;
  const screenX = onScreen ? 0.5 + relativeDeg / (2 * halfFovDeg) : relativeDeg < 0 ? 0 : 1;
  const edge: "left" | "right" | null = onScreen ? null : relativeDeg < 0 ? "left" : "right";
  return { peerDeviceId: "", relativeDeg, onScreen, screenX, edge };
}
