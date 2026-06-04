import { POSE_THRESHOLDS, type PoseDebug } from "@/lib/detection/poseGeometry";

function Row({ label, value, score }: { label: string; value: string; score?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="w-12 text-right tabular-nums">{value}</span>
      {score !== undefined && (
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-primary"
            style={{ width: `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Dev-only tuning panel for the pose unsafe-lift detector. Rendered by Live only
 * when `import.meta.env.DEV` is set, so it never ships to production.
 */
export function PoseDebugPanel({ debug }: { debug: PoseDebug }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Pose debug · {debug.primaryPersonId ?? "—"}</span>
        <span className={debug.emitted ? "font-semibold text-red-500" : "text-muted-foreground"}>
          {debug.emitted ? "UNSAFE LIFT" : "ok"} · conf {debug.confidence.toFixed(2)} /{" "}
          {POSE_THRESHOLDS.emitThreshold}
        </span>
      </div>
      <div className="space-y-1">
        <Row label="torso °" value={debug.torsoAngle.toFixed(0)} score={debug.torsoBendScore} />
        <Row label="knee °" value={debug.kneeAngle.toFixed(0)} score={debug.kneeStraightScore} />
        <Row label="wrist low" value={debug.wristLowScore.toFixed(2)} score={debug.wristLowScore} />
        <Row label="reach" value={debug.forwardReachScore.toFixed(2)} score={debug.forwardReachScore} />
        <Row label="twist" value={debug.twistAsymmetryScore.toFixed(2)} score={debug.twistAsymmetryScore} />
        <Row label="overhead" value={debug.overheadReachScore.toFixed(2)} score={debug.overheadReachScore} />
        <Row label="visibility" value={debug.visibility.toFixed(2)} score={debug.visibility} />
        <Row label="hold ms" value={Math.round(debug.staticHoldMs).toString()} score={debug.staticScore} />
        <Row label="bends/min" value={debug.bendsPerMin.toString()} score={debug.repetitionScore} />
      </div>
      {debug.ergonomicFactors.length > 0 && (
        <p className="mt-2 text-muted-foreground">{debug.ergonomicFactors.join(" · ")}</p>
      )}

      <div className="mt-2 border-t border-border/60 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Proximity</span>
          <span
            className={
              debug.proximityEmitted ? "font-semibold text-red-500" : "text-muted-foreground"
            }
          >
            {debug.proximityEmitted ? "TOO CLOSE" : "ok"} · {debug.personCount} ppl
          </span>
        </div>
        <Row label="closest" value={debug.closestPairScore.toFixed(2)} score={debug.closestPairScore} />
        <Row label="pair" value={debug.closestPairKey ?? "—"} />
        <Row label="edge gap" value={debug.closestPairGap.toFixed(2)} />
        {debug.trackedIds.length > 0 && (
          <p className="mt-1 text-muted-foreground">ids: {debug.trackedIds.join(", ")}</p>
        )}
      </div>
    </div>
  );
}
