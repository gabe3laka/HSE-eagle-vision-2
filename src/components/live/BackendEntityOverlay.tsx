import type { BackendEntity } from "@/lib/detection/types";

// Teal — deliberately distinct from the red/amber severity hazard boxes so the
// dry-run entities can't be mistaken for real safety detections.
const BOX_COLOR = "rgba(20,184,166,0.95)";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Overlay for the DEIMv2 backend dry-run: teal boxes + label/confidence drawn
 * over the live video. The parent decides when to show it (dry-run mode) — it is
 * NOT gated to dev builds. Purely informational; never enters the risk engine.
 *
 * Boxes use normalized 0..1 bbox coords rendered as percentages (clamped), so no
 * video pixel dimensions are required.
 */
export function BackendEntityOverlay({
  entities,
}: {
  entities: BackendEntity[];
  videoWidth?: number;
  videoHeight?: number;
}) {
  if (!entities || entities.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {entities.map((e, i) => {
        const b = e?.bbox;
        if (!b) return null;
        return (
          <div
            key={`${e.label}-${i}`}
            className="absolute rounded-md border-2"
            style={{
              left: `${clamp01(b.x) * 100}%`,
              top: `${clamp01(b.y) * 100}%`,
              width: `${clamp01(b.w) * 100}%`,
              height: `${clamp01(b.h) * 100}%`,
              borderColor: BOX_COLOR,
              boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 12px ${BOX_COLOR}`,
            }}
          >
            <span
              className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-black"
              style={{ backgroundColor: BOX_COLOR }}
            >
              {e.label} · {Math.round((e.confidence ?? 0) * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
