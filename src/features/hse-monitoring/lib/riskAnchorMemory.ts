/**
 * Risk-Anchor Memory — pure helpers that strengthen Qwen risk stickiness
 * beyond exact `track_id` matching.
 *
 * The pure HSE view-model builder pairs each scene risk to current YOLO
 * entities via id → spatial match. That falls apart in two cases:
 *
 *   1. YOLO re-issues a `track_id` for the same physical object → the
 *      scene risk's id link is broken even though the object is plainly
 *      visible.
 *   2. The scene risk briefly disappears from `parsedRisk` (between Qwen
 *      heartbeat ticks) → the colored box vanishes for a frame or two
 *      and flickers back.
 *
 * The risk-anchor store remembers, per Qwen-linked grouped-risk key, the
 * last YOLO entity bbox / label / ids that the risk was painted on. On
 * each frame we try to rebind the anchor to a CURRENT YOLO entity using
 * (in order): id match → same label + IoU/center proximity to lastBbox →
 * spatial match to lastBbox alone. When a rebind succeeds the overlay
 * MUST use the current entity's bbox (the box follows the object). When
 * no rebind succeeds the anchor is kept as `sticky-carried` (dashed) for
 * a per-level window, then `stale`, then dropped — and we never invent a
 * solid new box.
 *
 * Pure module: no React, no DOM, no globals.
 */

import type { BackendEntity, BBox } from "@/lib/detection/types";
import type { RiskLevel } from "@/lib/detection/riskTypes";
import { riskLevelRank } from "@/lib/detection/riskTypes";

/** Disposition of a Qwen-linked risk this frame. */
export type RiskAnchorDisposition =
  | "linked" // grouped risk has a fresh YOLO entity binding this frame
  | "sticky-carried" // no fresh link, replaying lastBbox dashed within TTL
  | "stale" // past linked window, still within outer TTL (dashed/faded)
  | "ignored" // heartbeat ignored (stale/session-mismatch/frame-mismatch)
  | "unmatched-candidate"; // Qwen-only candidate, no current entity link

/** How the anchor was rebound this frame, for diagnostics/console. */
export type RiskAnchorRebindPath =
  | "id" // matched a current entity by id (track/entity/detection)
  | "label-spatial" // same label near previous bbox (IoU or center)
  | "spatial-only" // best IoU/center match near previous bbox
  | "carried" // no current match; replaying lastBbox dashed
  | "none";

export interface RiskAnchorEntry {
  /** Stable key, mirrors `HseGroupedRisk.key`. */
  anchorKey: string;
  hazardType: string;
  level: RiskLevel;
  label?: string;
  /** Last YOLO entity bbox this risk was painted on (normalized 0..1). */
  lastBbox: BBox;
  lastTrackIds: string[];
  lastEntityIds: string[];
  /** First time we ever painted this anchor. */
  firstSeenMs: number;
  /** Last frame the anchor was freshly linked (disposition = "linked"). */
  lastLinkedMs: number;
  /** Last frame we updated the anchor (linked OR carried). */
  lastUpdatedMs: number;
  disposition: RiskAnchorDisposition;
  rebindPath: RiskAnchorRebindPath;
}

export interface AnchorCaps {
  /** Max age after lastLinkedMs to keep a YELLOW anchor dashed. */
  yellowStaleMaxMs: number;
  /** Max age after lastLinkedMs to keep ORANGE/RED anchors dashed. */
  redStaleMaxMs: number;
  /** Within this window after lastLinkedMs we tag carried entries as
   *  "sticky-carried"; past it (but inside the outer cap) → "stale". */
  stickyWindowMs: number;
}

export const DEFAULT_ANCHOR_CAPS: AnchorCaps = {
  yellowStaleMaxMs: 2500,
  redStaleMaxMs: 5000,
  stickyWindowMs: 1500,
};

// ── geometry ────────────────────────────────────────────────────────────────

function bboxIoU(a: BBox, b: BBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function centerDistance(a: BBox, b: BBox): number {
  const cax = a.x + a.w / 2;
  const cay = a.y + a.h / 2;
  const cbx = b.x + b.w / 2;
  const cby = b.y + b.h / 2;
  return Math.hypot(cax - cbx, cay - cby);
}

function entityIds(e: BackendEntity): string[] {
  const ids: string[] = [];
  if (e.track_id) ids.push(String(e.track_id));
  const rec = e as unknown as Record<string, unknown>;
  for (const k of ["id", "entity_id", "detection_id"]) {
    const v = rec[k];
    if (typeof v === "string" && v) ids.push(v);
  }
  return ids;
}

function labelsCompatible(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Permit partial label drift between detector variants (e.g. "person" vs
  // "worker"). Only compatible when one contains the other.
  return na.includes(nb) || nb.includes(na);
}

// ── rebind ──────────────────────────────────────────────────────────────────

export interface RebindResult {
  entity: BackendEntity | null;
  path: RiskAnchorRebindPath;
}

/** Try to find the current YOLO entity that should keep painting this anchor. */
export function rebindAnchor(
  entry: RiskAnchorEntry,
  currentEntities: BackendEntity[],
): RebindResult {
  // 1. exact id match against any current entity
  for (const e of currentEntities) {
    const ids = entityIds(e);
    if (
      ids.some(
        (id) => entry.lastTrackIds.includes(id) || entry.lastEntityIds.includes(id),
      )
    ) {
      return { entity: e, path: "id" };
    }
  }

  // 2. same-label + spatial proximity to lastBbox
  let best: { e: BackendEntity; score: number } | null = null;
  for (const e of currentEntities) {
    if (!e.bbox) continue;
    if (!labelsCompatible(entry.label, e.label)) continue;
    const iou = bboxIoU(entry.lastBbox, e.bbox);
    const d = centerDistance(entry.lastBbox, e.bbox);
    if (iou < 0.2 && d > 0.12) continue;
    const score = iou + (1 - Math.min(1, d / 0.12)) * 0.25;
    if (!best || score > best.score) best = { e, score };
  }
  if (best) return { entity: best.e, path: "label-spatial" };

  // 3. spatial-only fallback (any label) — last resort
  let any: { e: BackendEntity; score: number } | null = null;
  for (const e of currentEntities) {
    if (!e.bbox) continue;
    const iou = bboxIoU(entry.lastBbox, e.bbox);
    const d = centerDistance(entry.lastBbox, e.bbox);
    if (iou < 0.2 && d > 0.08) continue; // tighter than (2) since label is unknown
    const score = iou + (1 - Math.min(1, d / 0.08)) * 0.2;
    if (!any || score > any.score) any = { e, score };
  }
  if (any) return { entity: any.e, path: "spatial-only" };

  return { entity: null, path: "carried" };
}

// ── store operations ────────────────────────────────────────────────────────

/**
 * Update or insert an anchor when a grouped risk is freshly linked to a
 * current YOLO entity this frame. Returns the new entry.
 */
export function upsertAnchorOnLink(args: {
  prev: RiskAnchorEntry | undefined;
  anchorKey: string;
  hazardType: string;
  level: RiskLevel;
  currentEntity: BackendEntity;
  nowMs: number;
  rebindPath?: RiskAnchorRebindPath;
}): RiskAnchorEntry | null {
  const { prev, anchorKey, hazardType, level, currentEntity, nowMs, rebindPath } = args;
  if (!currentEntity.bbox) return prev ?? null;
  const ids = entityIds(currentEntity);
  return {
    anchorKey,
    hazardType,
    level,
    label: currentEntity.label,
    lastBbox: currentEntity.bbox,
    lastTrackIds: ids,
    lastEntityIds: ids,
    firstSeenMs: prev?.firstSeenMs ?? nowMs,
    lastLinkedMs: nowMs,
    lastUpdatedMs: nowMs,
    disposition: "linked",
    rebindPath: rebindPath ?? (prev ? "id" : "id"),
  };
}

/**
 * Advance a carried anchor: try to rebind to a current entity; otherwise
 * mark sticky-carried/stale; or signal `expired` (caller drops it).
 */
export function advanceAnchor(args: {
  entry: RiskAnchorEntry;
  currentEntities: BackendEntity[];
  nowMs: number;
  caps?: AnchorCaps;
}): { entry: RiskAnchorEntry; expired: boolean; rebound: BackendEntity | null } {
  const { entry, currentEntities, nowMs, caps = DEFAULT_ANCHOR_CAPS } = args;
  const sinceLinked = nowMs - entry.lastLinkedMs;
  const isRedish = riskLevelRank(entry.level) >= riskLevelRank("ORANGE");
  const outerCap = isRedish ? caps.redStaleMaxMs : caps.yellowStaleMaxMs;
  if (sinceLinked > outerCap) {
    return { entry, expired: true, rebound: null };
  }

  const r = rebindAnchor(entry, currentEntities);
  if (r.entity && r.entity.bbox) {
    const ids = entityIds(r.entity);
    const next: RiskAnchorEntry = {
      ...entry,
      label: r.entity.label,
      lastBbox: r.entity.bbox,
      lastTrackIds: ids,
      lastEntityIds: ids,
      lastLinkedMs: nowMs,
      lastUpdatedMs: nowMs,
      disposition: "linked",
      rebindPath: r.path,
    };
    return { entry: next, expired: false, rebound: r.entity };
  }

  const disposition: RiskAnchorDisposition =
    sinceLinked <= caps.stickyWindowMs ? "sticky-carried" : "stale";
  const next: RiskAnchorEntry = {
    ...entry,
    lastUpdatedMs: nowMs,
    disposition,
    rebindPath: "carried",
  };
  return { entry: next, expired: false, rebound: null };
}

/** Build a synthetic stale BackendEntity to render the carried (dashed) box. */
export function staleOverlayEntityFor(entry: RiskAnchorEntry): BackendEntity {
  return {
    label: entry.label ?? entry.hazardType,
    class_id: -1,
    confidence: 0,
    bbox: entry.lastBbox,
    risk_level: entry.level,
    // marker consumed by BackendEntityOverlay to render dashed/faded
    ...({ __riskAnchorStale: true, __anchorKey: entry.anchorKey } as Record<string, unknown>),
  } as BackendEntity;
}

/** Human-readable diagnostic line for a disposition / rebind. */
export function anchorReasonFor(entry: RiskAnchorEntry): string {
  switch (entry.disposition) {
    case "linked":
      if (entry.rebindPath === "id") return "linked by id";
      if (entry.rebindPath === "label-spatial") return "rebound by label+proximity";
      if (entry.rebindPath === "spatial-only") return "rebound by proximity";
      return "linked";
    case "sticky-carried":
      return "no current match — holding last bbox";
    case "stale":
      return "past sticky window — fading out";
    case "ignored":
      return "Qwen heartbeat ignored";
    case "unmatched-candidate":
      return "Qwen candidate, no current entity";
  }
}
