import { useMemo } from "react";
import type { Database } from "@/integrations/supabase/types";

type Severity = Database["public"]["Enums"]["severity"];

interface Det {
  bbox: unknown;
  severity: Severity;
}

const COLS = 16;
const ROWS = 10;
const WEIGHT: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Spatial risk heatmap (doc §9) — bins detection bounding-box centres across the
 * camera frame and shades each cell by accumulated, severity-weighted risk.
 */
export function RiskHeatmap({ detections }: { detections: Det[] }) {
  const { cells, max, total } = useMemo(() => {
    const grid = new Array<number>(COLS * ROWS).fill(0);
    let count = 0;
    for (const d of detections) {
      const b = d.bbox as { x?: number; y?: number; w?: number; h?: number } | null;
      if (!b || typeof b.x !== "number" || typeof b.y !== "number") continue;
      const cx = Math.min(0.999, Math.max(0, b.x + (b.w ?? 0) / 2));
      const cy = Math.min(0.999, Math.max(0, b.y + (b.h ?? 0) / 2));
      const col = Math.floor(cx * COLS);
      const row = Math.floor(cy * ROWS);
      grid[row * COLS + col] += WEIGHT[d.severity] ?? 1;
      count++;
    }
    return { cells: grid, max: Math.max(1, ...grid), total: count };
  }, [detections]);

  return (
    <div>
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-black/40"
        style={{ aspectRatio: `${COLS} / ${ROWS}` }}
      >
        <div
          className="grid h-full w-full"
          style={{
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          }}
        >
          {cells.map((v, i) => {
            const intensity = v / max;
            return (
              <div
                key={i}
                className="border border-white/5"
                style={{
                  backgroundColor: v > 0 ? `rgba(239,68,68,${0.12 + intensity * 0.78})` : "transparent",
                }}
              />
            );
          })}
        </div>
        {total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            No detections yet — start monitoring to build the heatmap.
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Camera frame · {total} detection{total === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1.5">
          low
          <span
            className="inline-block h-2 w-16 rounded"
            style={{
              background: "linear-gradient(to right, rgba(239,68,68,0.15), rgba(239,68,68,0.9))",
            }}
          />
          high
        </span>
      </div>
    </div>
  );
}
