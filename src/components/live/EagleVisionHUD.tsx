import { AlertTriangle, HardHat, ScanLine, ShieldCheck, Truck } from "lucide-react";
import { poseCoversBox } from "@/lib/detection/hseEntityMapper";
import { mirrorBox } from "@/lib/detection/mirror";
import type { BackendPose } from "@/lib/detection/types";
import type { HSEActiveAlert, HSESeverity, HSETrack } from "@/lib/detection/hseTypes";

/**
 * Phase 6 — Eagle Vision HUD. A wearable/glasses-style overlay drawn over the
 * camera card: stable tracked object boxes, a focus ring on the highest risk, a
 * direction arrow when the hazard is off-centre, a top status chip and a single
 * bottom action line. Technical labels (model names etc.) stay in the debug
 * panel — the HUD shows only what a wearer needs.
 */

function severityColor(sev: HSESeverity): string {
  switch (sev) {
    case "critical":
      return "rgba(239,68,68,1)";
    case "high":
      return "rgba(249,115,22,1)";
    case "medium":
    case "low":
      return "rgba(251,191,36,1)";
    default:
      return "rgba(34,211,238,1)";
  }
}

const CATEGORY_TINT: Record<string, string> = {
  person: "rgba(34,211,238,0.9)",
  vehicle: "rgba(251,191,36,0.95)",
  ppe: "rgba(52,211,153,0.9)",
  "fall-hazard": "rgba(249,115,22,0.9)",
  "trip-hazard": "rgba(251,191,36,0.85)",
  "fire-safety": "rgba(248,113,113,0.9)",
  "access-egress": "rgba(125,211,252,0.9)",
};
const trackTint = (cat: string) => CATEGORY_TINT[cat] ?? "rgba(125,211,252,0.6)";

const STATUS_META: Record<
  "monitoring" | "scanning" | "risk" | "critical",
  { label: string; color: string; bg: string }
> = {
  monitoring: { label: "MONITORING", color: "rgb(165,243,252)", bg: "rgba(8,47,73,0.8)" },
  scanning: { label: "SCANNING", color: "rgb(165,243,252)", bg: "rgba(8,47,73,0.8)" },
  risk: { label: "RISK", color: "rgb(253,230,138)", bg: "rgba(69,46,5,0.85)" },
  critical: { label: "CRITICAL", color: "rgb(254,202,202)", bg: "rgba(69,10,10,0.9)" },
};

interface Props {
  tracks: HSETrack[];
  /** Live poses — a person's box is hidden when a skeleton covers them. */
  poses?: BackendPose[];
  topAlert: HSEActiveAlert | null;
  status: "monitoring" | "scanning" | "risk" | "critical";
  objectCount: number;
  stableCount: number;
  reasoningSource: "deepseek" | "rules" | null;
  /** Front camera: flip box/ring/arrow geometry to match the mirrored video
   *  (text chips and the action line are never flipped). */
  mirrored?: boolean;
}

export function EagleVisionHUD({
  tracks,
  poses,
  topAlert,
  status,
  objectCount,
  stableCount,
  reasoningSource,
  mirrored = false,
}: Props) {
  const sm = STATUS_META[status];
  const rawFocus = topAlert?.bbox ?? topAlert?.overlay;
  // Geometry in VISUAL space: flipped on the mirrored selfie preview.
  const focus = rawFocus
    ? mirrorBox(
        { x: rawFocus.x ?? 0, y: rawFocus.y ?? 0, w: rawFocus.w ?? 0.1, h: rawFocus.h ?? 0.1 },
        mirrored,
      )
    : undefined;
  const focusColor = topAlert ? severityColor(topAlert.severity) : "rgba(34,211,238,1)";
  // Direction arrow when the hazard centre is outside the central focus band.
  const cx = focus ? (focus.x ?? 0) + (focus.w ?? 0) / 2 : 0.5;
  const cy = focus ? (focus.y ?? 0) + (focus.h ?? 0) / 2 : 0.5;
  const dir =
    !focus || (cx > 0.18 && cx < 0.82 && cy > 0.18 && cy < 0.82)
      ? null
      : cx <= 0.18
        ? "left"
        : cx >= 0.82
          ? "right"
          : cy <= 0.18
            ? "up"
            : "down";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* stable tracked object boxes */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {tracks
          .filter((t) => t.stable)
          // People are drawn as a skeleton — hide their box when a pose covers
          // them (the track stays for proximity/zone/PPE logic).
          .filter((t) => t.category !== "person" || !poseCoversBox(t.bbox, poses))
          .map((t) => {
            const b = mirrorBox(t.bbox, mirrored);
            return (
              <rect
                key={t.id}
                x={b.x * 100}
                y={b.y * 100}
                width={b.w * 100}
                height={b.h * 100}
                rx={1}
                fill="none"
                stroke={trackTint(t.category)}
                strokeWidth={0.5}
                opacity={0.8}
              />
            );
          })}
        {/* focus ring on the highest-risk hazard */}
        {focus && (
          <g className={status === "critical" ? "animate-pulse" : ""}>
            <rect
              x={(focus.x ?? 0) * 100}
              y={(focus.y ?? 0) * 100}
              width={(focus.w ?? 0.1) * 100}
              height={(focus.h ?? 0.1) * 100}
              rx={1.5}
              fill="none"
              stroke={focusColor}
              strokeWidth={1.2}
            />
            <rect
              x={(focus.x ?? 0) * 100 - 1.5}
              y={(focus.y ?? 0) * 100 - 1.5}
              width={(focus.w ?? 0.1) * 100 + 3}
              height={(focus.h ?? 0.1) * 100 + 3}
              rx={2}
              fill="none"
              stroke={focusColor}
              strokeWidth={0.4}
              opacity={0.5}
            />
          </g>
        )}
      </svg>

      {/* direction arrow toward an off-centre hazard */}
      {dir && (
        <div
          className="absolute text-2xl font-bold"
          style={{
            color: focusColor,
            ...(dir === "left"
              ? { left: "3%", top: "50%", transform: "translateY(-50%)" }
              : dir === "right"
                ? { right: "3%", top: "50%", transform: "translateY(-50%)" }
                : dir === "up"
                  ? { top: "8%", left: "50%", transform: "translateX(-50%)" }
                  : { bottom: "14%", left: "50%", transform: "translateX(-50%)" }),
          }}
        >
          {dir === "left" ? "◀" : dir === "right" ? "▶" : dir === "up" ? "▲" : "▼"}
        </div>
      )}

      {/* top status chip */}
      <div className="absolute left-2 top-2 flex items-center gap-1.5">
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${
            status === "critical" ? "animate-pulse" : ""
          }`}
          style={{ color: sm.color, background: sm.bg }}
        >
          {status === "critical" || status === "risk" ? (
            <AlertTriangle className="h-3 w-3" />
          ) : status === "scanning" ? (
            <ScanLine className="h-3 w-3" />
          ) : (
            <ShieldCheck className="h-3 w-3" />
          )}
          {sm.label}
        </span>
        <span className="rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium text-cyan-100/80 backdrop-blur">
          {stableCount}/{objectCount} tracked
        </span>
      </div>

      {/* tiny category legend (wearable icons, no model names) */}
      <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-0.5 backdrop-blur">
        <HardHat className="h-3 w-3 text-emerald-300/80" />
        <Truck className="h-3 w-3 text-amber-300/80" />
        {reasoningSource && (
          <span className="text-[8px] font-semibold uppercase text-cyan-200/70">
            {reasoningSource === "deepseek" ? "AI" : "local"}
          </span>
        )}
      </div>

      {/* bottom action line — one short instruction */}
      {topAlert && (
        <div className="absolute inset-x-2 bottom-2">
          <div
            className="rounded-lg px-2.5 py-1.5 backdrop-blur"
            style={{ background: "rgba(2,6,23,0.78)", borderLeft: `3px solid ${focusColor}` }}
          >
            <div className="text-[11px] font-semibold" style={{ color: focusColor }}>
              {topAlert.title}
            </div>
            <div className="text-[11px] leading-snug text-white/90">{topAlert.spokenMessage}</div>
          </div>
        </div>
      )}
    </div>
  );
}
