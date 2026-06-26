/**
 * Scaffold — Phase 3+ only.
 *
 * Do NOT activate until ALL of:
 *   1. Worker pose is intentionally enabled (YOLO26_POSE_ENABLED=true)
 *   2. /detect consistently returns poses (sv_frame.backend.tasks includes 'pose')
 *   3. Person-box projection is already reliable (Phase 1B/2 confirmed working)
 *   4. Calibration confidence is high (marker calibration, confidence ≥ 0.85)
 *
 * This component projects full remote skeletons into the local camera view.
 * It is intentionally inert until the above conditions hold.
 */
export function ProjectedRemotePoseOverlay() {
  return null;
}
