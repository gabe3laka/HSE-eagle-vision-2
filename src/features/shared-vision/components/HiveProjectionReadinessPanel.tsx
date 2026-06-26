import type { ProjectionReadiness, ReadinessRow } from "../hooks/useProjectionReadiness";

/**
 * Dev-only Hive projection diagnostics — the "why is there no ghost?" explainer.
 * Render gated behind VITE_HIVE_DEBUG so it never reaches operators. Purely
 * presentational; reads a ProjectionReadiness snapshot built by
 * buildProjectionReadiness.
 */
function Row({ row }: { row: ReadinessRow }) {
  const color =
    row.ok === true
      ? "text-emerald-400"
      : row.ok === false
        ? "text-red-400"
        : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{row.label}</span>
      <span className={`font-mono ${color}`}>{row.value}</span>
    </div>
  );
}

export function HiveProjectionReadinessPanel({ readiness }: { readiness: ProjectionReadiness }) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-amber-700/50 bg-amber-950/10 p-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span className="text-sm font-semibold">Projection Readiness</span>
        <span className="ml-auto rounded bg-amber-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
          dev
        </span>
      </div>

      <div>
        {readiness.global.map((r) => (
          <Row key={r.label} row={r} />
        ))}
      </div>

      {readiness.peers.map((peer) => (
        <div key={peer.deviceId} className="rounded border border-border/60 p-2">
          <p className="mb-1 text-[11px] font-semibold">
            {peer.deviceLabel ?? peer.deviceId.slice(0, 8)}
          </p>
          {peer.rows.map((r) => (
            <Row key={r.label} row={r} />
          ))}
        </div>
      ))}

      {readiness.peers.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No peers in session.</p>
      )}
    </div>
  );
}
