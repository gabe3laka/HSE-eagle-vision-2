import { POSE_CONNECTIONS, type PoseDebug, type PoseLandmark } from "@/lib/detection/poseGeometry";

const VIS = 0.5; // only draw landmarks/edges the model is reasonably sure about

function visible(p?: PoseLandmark) {
  return (p?.visibility ?? 0) >= VIS;
}

/**
 * Dev-only skeleton/stickman overlay. Draws MediaPipe landmarks + connections for
 * accepted poses (green when stable, amber while locking) and the rejected raw
 * pose boxes with their first rejection reason. Purely presentational — it reads
 * the detector's debug snapshot and never affects detection output.
 */
export function SkeletonOverlay({ debug }: { debug: PoseDebug }) {
  const { acceptedPoses, rejectedBoxes } = debug;
  if (!acceptedPoses.length && !rejectedBoxes.length) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* rejected raw poses — debug only, with reason */}
      {rejectedBoxes.map((r, i) =>
        r.bbox ? (
          <g key={`rej-${i}`}>
            <rect
              x={r.bbox.x * 100}
              y={r.bbox.y * 100}
              width={r.bbox.w * 100}
              height={r.bbox.h * 100}
              fill="none"
              stroke="rgba(239,68,68,0.55)"
              strokeWidth={0.4}
              strokeDasharray="2 1.5"
            />
            <text
              x={r.bbox.x * 100 + 0.6}
              y={r.bbox.y * 100 + 2.6}
              fontSize={2.3}
              fill="rgba(239,68,68,0.9)"
            >
              {r.reasons[0] ?? "rejected"}
            </text>
          </g>
        ) : null,
      )}

      {/* accepted skeletons */}
      {acceptedPoses.map((pose, pi) => {
        const color = pose.stable ? "rgba(34,197,94,0.95)" : "rgba(234,179,8,0.95)";
        const lm = pose.landmarks;
        return (
          <g key={`pose-${pi}`}>
            {POSE_CONNECTIONS.map(([a, b], ci) => {
              const pa = lm[a];
              const pb = lm[b];
              if (!visible(pa) || !visible(pb)) return null;
              return (
                <line
                  key={ci}
                  x1={pa.x * 100}
                  y1={pa.y * 100}
                  x2={pb.x * 100}
                  y2={pb.y * 100}
                  stroke={color}
                  strokeWidth={0.5}
                  strokeLinecap="round"
                />
              );
            })}
            {lm.map((p, li) =>
              visible(p) ? (
                <circle key={li} cx={p.x * 100} cy={p.y * 100} r={0.7} fill={color} />
              ) : null,
            )}
            <text
              x={pose.bbox.x * 100}
              y={Math.max(2.6, pose.bbox.y * 100 - 1)}
              fontSize={3}
              fontWeight={700}
              fill={color}
            >
              {pose.id ?? "?"}
              {pose.stable ? "" : " …"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
