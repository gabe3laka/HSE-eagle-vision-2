import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import { isPersonLabel, poseCoversBox } from "@/lib/detection/hseEntityMapper";
import { mirrorBox } from "@/lib/detection/mirror";
import { normalizeRiskLevel, riskLevelColor, riskLevelRank } from "@/lib/detection/riskTypes";
import {
  boxLabelForEntity,
  itemNameForEntity,
  type HseOverlayMode,
} from "@/lib/detection/hseLiveRiskViewModel";

// Teal — neutral fallback for non-risk-aware modes.
const BOX_COLOR = "rgba(20,184,166,0.95)";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function boxColorFor(e: BackendEntity, riskAware: boolean): string {
  if (!riskAware) return BOX_COLOR;
  const level = normalizeRiskLevel(e.risk_level, e.risk_color);
  return level ? riskLevelColor(level) : BOX_COLOR;
}

/**
 * Overlay for backend entity boxes.
 *
 * overlayMode:
 *  - "normal" (default): legacy behavior — label is "<class> · <conf>%".
 *  - "hse-status": one box per detected object — GREEN by default, color
 *    upgraded to YELLOW/ORANGE/RED for risk-linked entities. Caller has
 *    already stamped risk_level/risk_color on every entity.
 *  - "hse-risk-only": only YELLOW/ORANGE/RED linked boxes (caller passes the
 *    pre-filtered `entities`); label is ITEM NAME only — no risk/level/stale
 *    words.
 *  - "debug": shows detailed labels including risk level and track id.
 */
export function BackendEntityOverlay({
  entities,
  poses,
  debug = false,
  mirrored = false,
  riskAware = false,
  overlayMode = "normal",
}: {
  entities: BackendEntity[];
  poses?: BackendPose[];
  debug?: boolean;
  mirrored?: boolean;
  riskAware?: boolean;
  overlayMode?: HseOverlayMode;
  videoWidth?: number;
  videoHeight?: number;
}) {
  if (!entities || entities.length === 0) return null;
  const isHseRiskOnly = overlayMode === "hse-risk-only";
  const isHseStatus = overlayMode === "hse-status";

  let visible = entities;
  if (isHseRiskOnly) {
    visible = entities.filter((e) => {
      const lvl = normalizeRiskLevel(e.risk_level, e.risk_color);
      return lvl && riskLevelRank(lvl) >= riskLevelRank("YELLOW");
    });
  } else if (isHseStatus) {
    // Show ALL entities (GREEN-by-default seeded by the view model). Still
    // drop person boxes covered by a pose to avoid double-drawing.
    visible = entities.filter(
      (e) => !e?.bbox || !isPersonLabel(e.label) || !poseCoversBox(e.bbox, poses),
    );
  } else {
    visible = entities.filter(
      (e) => debug || !e?.bbox || !isPersonLabel(e.label) || !poseCoversBox(e.bbox, poses),
    );
  }
  if (visible.length === 0) return null;

  const effMode: HseOverlayMode = debug ? "debug" : overlayMode;
  const riskAwareEffective = riskAware || isHseRiskOnly || isHseStatus;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {visible.map((e, i) => {
        const b = e?.bbox ? mirrorBox(e.bbox, mirrored) : undefined;
        if (!b) return null;
        const color = boxColorFor(e, riskAwareEffective);
        const label =
          boxLabelForEntity(e, riskAware, effMode) ??
          `${itemNameForEntity(e)} · ${Math.round((e.confidence ?? 0) * 100)}%`;
        const isStaleAnchor =
          (e as unknown as { __riskAnchorStale?: boolean }).__riskAnchorStale === true;
        return (
          <div
            key={`${e.label}-${i}`}
            className={`absolute rounded-md ${isStaleAnchor ? "border-2 border-dashed" : "border-2"}`}
            style={{
              left: `${clamp01(b.x) * 100}%`,
              top: `${clamp01(b.y) * 100}%`,
              width: `${clamp01(b.w) * 100}%`,
              height: `${clamp01(b.h) * 100}%`,
              borderColor: color,
              opacity: isStaleAnchor ? 0.6 : 1,
              boxShadow: isStaleAnchor
                ? `0 0 0 1px rgba(0,0,0,0.4)`
                : `0 0 0 1px rgba(0,0,0,0.4), 0 0 12px ${color}`,
            }}
          >
            {!isStaleAnchor && (
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
