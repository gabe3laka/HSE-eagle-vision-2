/**
 * mapHazards.ts — PURE collection of live hazard dots for the site map.
 *
 * A projected remote entity that carries a recovered worldPoint (map meters —
 * from the homography tiers, or the vps_map tier when the site map is the
 * scanned space) becomes a dot: coloured by risk_level, sized by confidence,
 * decaying to nothing after MAP_HAZARD_TTL_MS. Read-only over existing data —
 * the map editor and the stored site_maps schema are untouched.
 */

import type { RemotePeerState } from "../types";

export const MAP_HAZARD_TTL_MS = 20_000;

export interface MapHazard {
  id: string;
  x_m: number;
  y_m: number;
  riskLevel: string | null;
  confidence: number;
  /** 0 fresh → 1 at TTL (drop). */
  age01: number;
}

/** Collect decaying hazard dots from every peer's projected entities. */
export function collectMapHazards(
  peers: Iterable<RemotePeerState>,
  nowMs: number,
  ttlMs: number = MAP_HAZARD_TTL_MS,
): MapHazard[] {
  const out: MapHazard[] = [];
  for (const peer of peers) {
    for (const e of peer.projectedEntities) {
      if (!e.worldPoint) continue;
      const age = nowMs - e.projectedAt;
      if (age < 0 || age >= ttlMs) continue;
      out.push({
        id: `${peer.deviceId}:${e.id ?? e.label}:${Math.round(e.worldPoint.x_m * 10)}:${Math.round(e.worldPoint.y_m * 10)}`,
        x_m: e.worldPoint.x_m,
        y_m: e.worldPoint.y_m,
        riskLevel: e.risk_level ?? null,
        confidence: e.projectedLocal.confidence,
        age01: age / ttlMs,
      });
    }
  }
  return out;
}
