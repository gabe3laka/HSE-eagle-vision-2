import { POSE_CONNECTIONS, type PoseDebug, type PoseLandmark } from "@/lib/detection/poseGeometry";
import { mirrorBox } from "@/lib/detection/mirror";

const VIS = 0.5; // only draw landmarks/edges the model is reasonably sure about

function visible(p?: PoseLandmark) {
  return (p?.visibility ?? 0) >= VIS;
}

/**
 * Dev-only skeleton/stickman overlay. Draws MediaPipe landmarks + connections for
 * accepted poses (green when stable, amber while locking) and the rejected raw
 * pose boxes with their first rejection reason. Purely presentational — it reads
 * the detector's debug snapshot and never affects detection output. `mirrored`
 * (front camera) flips the GEOMETRY via a group transform; the debug texts are
 * rendered OUTSIDE the flip group at mathematically mirrored positions so they
 * stay readable.
 */
export function SkeletonOverlay({
  debug,
  mirrored = false,
}: {
  debug: PoseDebug;
  mirrored?: boolean;
}) {
  const { acceptedPoses, rejectedBoxes } = debug;
  if (!acceptedPoses.length && !rejectedBoxes.length) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* GEOMETRY — flipped as a group when mirrored (no text inside). */}
      <g transform={mirrored ? "translate(100,0) scale(-1,1)" : undefined}>
        {rejectedBoxes.map((r, i) =>
          r.bbox ? (
            <rect
              key={`rej-${i}`}
              x={r.bbox.x * 100}
              y={r.bbox.y * 100}
              width={r.bbox.w * 100}
              height={r.bbox.h * 100}
              fill="none"
              stroke="rgba(239,68,68,0.55)"
              strokeWidth={0.4}
              strokeDasharray="2 1.5"
            />
          ) : null,
        )}
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
            </g>
          );
        })}
      </g>

      {/* TEXT — outside the flip group, positioned at the mirrored box, readable. */}
      {rejectedBoxes.map((r, i) => {
        if (!r.bbox) return null;
        const b = mirrorBox(r.bbox, mirrored);
        return (
          <text
            key={`rejt-${i}`}
            x={b.x * 100 + 0.6}
            y={b.y * 100 + 2.6}
            fontSize={2.3}
            fill="rgba(239,68,68,0.9)"
          >
            {r.reasons[0] ?? "rejected"}
          </text>
        );
      })}
      {acceptedPoses.map((pose, pi) => {
        const color = pose.stable ? "rgba(34,197,94,0.95)" : "rgba(234,179,8,0.95)";
        const b = mirrorBox(pose.bbox, mirrored);
        return (
          <text
            key={`poset-${pi}`}
            x={b.x * 100}
            y={Math.max(2.6, b.y * 100 - 1)}
            fontSize={3}
            fontWeight={700}
            fill={color}
          >
            {pose.id ?? "?"}
            {pose.stable ? "" : " …"}
          </text>
        );
      })}
    </svg>
  );
}
