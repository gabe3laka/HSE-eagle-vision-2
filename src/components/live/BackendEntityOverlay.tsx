import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import { isPersonLabel, poseCoversBox } from "@/lib/detection/hseEntityMapper";
import { mirrorBox } from "@/lib/detection/mirror";
import type { HseOverlayMode } from "@/lib/detection/hseLiveRiskViewModel";
import { normalizeRiskLevel, riskLevelColor, riskLevelRank } from "@/lib/detection/riskTypes";

// Teal — deliberately distinct from the red/amber severity hazard boxes so the
// dry-run entities can't be mistaken for real safety detections.
const BOX_COLOR = "rgba(20,184,166,0.95)";
const SUPPRESSED_COLOR = "rgba(148,163,184,0.88)";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Pick a box color for an entity. When `riskAware` is on AND the entity carries
 *  a risk level, color GREEN/YELLOW/ORANGE/RED; otherwise the neutral teal. */
export function boxColorFor(e: BackendEntity, riskAware: boolean): string {
  if (!riskAware) return BOX_COLOR;
  if (e.correction_status === "suppress_from_hse_alerts") return SUPPRESSED_COLOR;
  const level = normalizeRiskLevel(e.risk_level, e.risk_color);
  return level ? riskLevelColor(level) : BOX_COLOR;
}

/** Pick the best human-readable item name for an entity, preferring richer
 *  semantic labels over the raw detector class. Never returns risk-status
 *  words (GREEN/YELLOW/stale/...) — those belong to the border color, not the
 *  visible label. */
export function itemNameForEntity(e: BackendEntity): string {
  const record = e as unknown as Record<string, unknown>;
  const candidates: Array<unknown> = [
    e.semantic_label,
    record.display_label,
    e.label,
    record.class_name,
  ];
  const name = candidates.find(
    (value) => typeof value === "string" && (value as string).trim().length > 0,
  ) as string | undefined;
  return name?.trim() || "detected item";
}

export function boxLabelForEntity(
  e: BackendEntity,
  riskAware: boolean,
  overlayMode: HseOverlayMode = "normal",
): string | null {
  if (overlayMode === "hse-risk-only") {
    // HSE risk-only: keep the colored border as the risk signal, but show the
    // actual detected item name (no GREEN/YELLOW/stale/resolving/score words).
    return itemNameForEntity(e);
  }
  const pct = `${Math.round((e.confidence ?? 0) * 100)}%`;
  if (!riskAware) return `${e.label} - ${pct}`;
  if (overlayMode !== "debug") {
    const semantic = e.semantic_label && e.semantic_label !== e.label ? e.semantic_label : e.label;
    return `${semantic} - ${pct}`;
  }
  const status =
    e.correction_status === "suppress_from_hse_alerts"
      ? "suppressed"
      : e.risk_resolving
        ? "resolving"
        : e.risk_stale
          ? "stale"
          : e.risk_level
            ? String(e.risk_level).toUpperCase()
            : null;
  const semantic =
    e.semantic_label && e.semantic_label !== e.label ? ` -> ${e.semantic_label}` : "";
  return status ? `${e.label}${semantic} - ${status} - ${pct}` : `${e.label}${semantic} - ${pct}`;
}

export function shouldRenderEntityBox(
  e: BackendEntity,
  poses: BackendPose[] | undefined,
  debug: boolean,
  overlayMode: HseOverlayMode = "normal",
): boolean {
  if (!e?.bbox) return false;
  if (overlayMode === "hse-risk-only") {
    if (e.correction_status === "suppress_from_hse_alerts" && !debug) return false;
    const level = normalizeRiskLevel(e.risk_level, e.risk_color);
    return riskLevelRank(level) >= riskLevelRank("YELLOW") || !!e.linked_risk_id;
  }
  return debug || !isPersonLabel(e.label) || !poseCoversBox(e.bbox, poses);
}

/**
 * Overlay for the backend dry-run: teal boxes + label/confidence drawn over the
 * live video. The parent decides when to show it (dry-run mode) — it is NOT
 * gated to dev builds. Purely informational; never enters the risk engine.
 *
 * People are shown as a pose/skeleton (BackendPoseOverlay), so a person's box +
 * "person 0.82" label is HIDDEN whenever a skeleton is available for them — the
 * box only appears in debug mode or when no pose covers that person. The
 * detection itself is still used internally by the HSE risk engine.
 *
 * Boxes use normalized 0..1 bbox coords rendered as percentages (clamped), so no
 * video pixel dimensions are required.
 */
export function BackendEntityOverlay({
  entities,
  poses,
  debug = false,
  mirrored = false,
  riskAware = true,
  overlayMode = "normal",
}: {
  entities: BackendEntity[];
  poses?: BackendPose[];
  /** Show person boxes even when a pose is available (dev/debug only). */
  debug?: boolean;
  /** Front camera: flip box geometry to match the mirrored video (labels stay readable). */
  mirrored?: boolean;
  /** Risk-aware coloring (VITE_RISK_AWARE_OVERLAY): color boxes by risk level
   *  when entities carry one. OFF → unchanged teal boxes. */
  riskAware?: boolean;
  overlayMode?: HseOverlayMode;
  videoWidth?: number;
  videoHeight?: number;
}) {
  if (!entities || entities.length === 0) return null;
  const debugOn = debug || overlayMode === "debug";
  const visible = entities.filter((e) => shouldRenderEntityBox(e, poses, debugOn, overlayMode));
  if (visible.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {visible.map((e, i) => {
        const b = e?.bbox ? mirrorBox(e.bbox, mirrored) : undefined;
        if (!b) return null;
        const color = boxColorFor(e, riskAware);
        const stale = e.risk_stale === true || e.risk_resolving === true;
        const suppressed = e.correction_status === "suppress_from_hse_alerts";
        const label = boxLabelForEntity(e, riskAware, overlayMode);
        return (
          <div
            key={`${e.label}-${i}`}
            className="absolute rounded-md border-2"
            style={{
              left: `${clamp01(b.x) * 100}%`,
              top: `${clamp01(b.y) * 100}%`,
              width: `${clamp01(b.w) * 100}%`,
              height: `${clamp01(b.h) * 100}%`,
              borderColor: color,
              borderStyle: stale || suppressed ? "dashed" : "solid",
              opacity: e.risk_resolving ? 0.48 : stale || suppressed ? 0.68 : 1,
              boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 12px ${color}`,
            }}
          >
            {label && (
              <span
                className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-black"
                style={{ backgroundColor: color }}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
