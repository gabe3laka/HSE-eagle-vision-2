import { POSE_THRESHOLDS, type PoseDebug } from "@/lib/detection/poseGeometry";
import type { PerfMetrics } from "@/hooks/useDetectionSession";

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

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded bg-muted/50 py-1">
      <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Dev-only tuning panel for the pose detector. Rendered by Live only when
 * `import.meta.env.DEV` is set, so it never ships to production. Shows the raw →
 * accepted → rejected pipeline, ergonomics, proximity, and frame/throughput metrics.
 */
export function PoseDebugPanel({ debug, perf }: { debug: PoseDebug; perf: PerfMetrics }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">
          Pose · {debug.primaryPersonId ?? "—"} · {debug.status}
        </span>
        <span className={debug.emitted ? "font-semibold text-red-500" : "text-muted-foreground"}>
          {debug.emitted ? "UNSAFE LIFT" : "ok"} · conf {debug.confidence.toFixed(2)} /{" "}
          {POSE_THRESHOLDS.emitThreshold}
        </span>
      </div>

      {/* pipeline: raw → accepted → rejected */}
      <div className="mb-2 grid grid-cols-3 gap-1 text-center">
        <Count label="raw" value={debug.rawPoseCount} tone="text-foreground" />
        <Count label="accepted" value={debug.acceptedPoseCount} tone="text-green-500" />
        <Count label="rejected" value={debug.rejectedPoseCount} tone="text-red-500" />
      </div>
      {debug.rejectionReasons.length > 0 && (
        <p className="mb-2 text-muted-foreground">reject: {debug.rejectionReasons.join(", ")}</p>
      )}

      <div className="space-y-1">
        <Row label="quality" value={debug.qualityScore.toFixed(2)} score={debug.qualityScore} />
        <Row label="visible lm" value={`${debug.visibleLandmarkCount}/33`} />
        <Row label="core lm" value={`${debug.visibleCoreCount}/6`} />
        <Row label="frames seen" value={debug.framesSeen.toString()} />
        <Row label="torso °" value={debug.torsoAngle.toFixed(0)} score={debug.torsoBendScore} />
        <Row label="knee °" value={debug.kneeAngle.toFixed(0)} score={debug.kneeStraightScore} />
        <Row label="wrist low" value={debug.wristLowScore.toFixed(2)} score={debug.wristLowScore} />
        <Row
          label="reach"
          value={debug.forwardReachScore.toFixed(2)}
          score={debug.forwardReachScore}
        />
        <Row
          label="twist"
          value={debug.twistAsymmetryScore.toFixed(2)}
          score={debug.twistAsymmetryScore}
        />
        <Row
          label="overhead"
          value={debug.overheadReachScore.toFixed(2)}
          score={debug.overheadReachScore}
        />
        <Row label="visibility" value={debug.visibility.toFixed(2)} score={debug.visibility} />
        <Row
          label="hold ms"
          value={Math.round(debug.staticHoldMs).toString()}
          score={debug.staticScore}
        />
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
        <Row
          label="closest"
          value={debug.closestPairScore.toFixed(2)}
          score={debug.closestPairScore}
        />
        <Row label="pair" value={debug.closestPairKey ?? "—"} />
        <Row label="edge gap" value={debug.closestPairGap.toFixed(2)} />
        {debug.trackedIds.length > 0 && (
          <p className="mt-1 text-muted-foreground">ids: {debug.trackedIds.join(", ")}</p>
        )}
      </div>

      <div className="mt-2 border-t border-border/60 pt-2">
        <div className="mb-1 font-semibold">Throughput · {perf.mode}</div>
        <Row label="fps" value={perf.fps.toString()} />
        <Row label="det avg ms" value={perf.avgDetectionMs.toFixed(1)} />
        <Row label="det max ms" value={perf.maxDetectionMs.toFixed(1)} />
        <Row label="skipped" value={perf.skippedFrames.toString()} />
        <Row label="stale" value={perf.staleFrames.toString()} />
        <Row label="presented" value={perf.presentedFrames.toString()} />
        <Row label="mediaTime" value={perf.mediaTime.toFixed(2)} />
        <p className="mt-1 text-muted-foreground">
          conf det {debug.thresholds.detection} · pres {debug.thresholds.presence} · trk{" "}
          {debug.thresholds.tracking} · maxPoses {debug.thresholds.maxPoses}
        </p>
      </div>
    </div>
  );
}
