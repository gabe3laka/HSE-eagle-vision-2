import type { BackendPose } from "@/lib/detection/types";

// Fuchsia — distinct from the teal entity boxes AND the green/amber MediaPipe
// SkeletonOverlay (pose-beta), so EdgeCrafter poses are unmistakable.
const POSE_COLOR = "rgba(217,70,239,0.95)";
const MIN_KP_SCORE = 0.3;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Dry-run overlay for backend pose keypoints + skeleton. This is NOT the
 * MediaPipe SkeletonOverlay — it draws the backend worker's pose output. The
 * parent decides when to show it (backend dry-run mode). Normalized 0..1 coords
 * are drawn in a 0..100 viewBox, so no video pixel dimensions are needed. Purely
 * informational — never enters the risk engine. `mirrored` (front camera) flips
 * the whole skeleton geometry to match the mirrored video — there is no text in
 * this layer, so a group transform is safe.
 */
export function BackendPoseOverlay({
  poses,
  mirrored = false,
}: {
  poses: BackendPose[];
  mirrored?: boolean;
}) {
  if (!poses || poses.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <g transform={mirrored ? "translate(100,0) scale(-1,1)" : undefined}>
        {poses.map((pose, pi) => {
          const kps = pose.keypoints ?? [];
          const edges = pose.skeleton ?? [];
          return (
            <g key={pi}>
              {edges.map(([a, b], ei) => {
                const ka = kps[a];
                const kb = kps[b];
                if (!ka || !kb || ka.score < MIN_KP_SCORE || kb.score < MIN_KP_SCORE) return null;
                return (
                  <line
                    key={`e${ei}`}
                    x1={clamp01(ka.x) * 100}
                    y1={clamp01(ka.y) * 100}
                    x2={clamp01(kb.x) * 100}
                    y2={clamp01(kb.y) * 100}
                    stroke={POSE_COLOR}
                    strokeWidth={0.6}
                    strokeLinecap="round"
                  />
                );
              })}
              {kps.map((k, ki) =>
                k.score >= MIN_KP_SCORE ? (
                  <circle
                    key={`k${ki}`}
                    cx={clamp01(k.x) * 100}
                    cy={clamp01(k.y) * 100}
                    r={0.9}
                    fill={POSE_COLOR}
                  />
                ) : null,
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
