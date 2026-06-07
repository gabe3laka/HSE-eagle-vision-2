import type { Detector, DetectionMode } from "./types";
import { SimulatedDetector } from "./simulatedDetector";
import { RealPoseDetector } from "./realPoseDetector";
import { BackendVisionDetector } from "./backendVisionDetector";
import { BackendVisionStreamDetector } from "./backendVisionStreamDetector";

/**
 * Returns the detector for the chosen mode. Every detector implements the same
 * `Detector` contract, so the live loop, RiskEngine, alerts and persistence are
 * identical regardless of which one runs.
 *
 * Modes:
 *  "simulated"       – SimulatedDetector (synthetic random hazards, default)
 *  "pose-beta"       – RealPoseDetector (MediaPipe Pose, in-browser)
 *  "backend-deimv2"  – BackendVisionDetector (EdgeCrafter via RunPod, HTTP dry-run)
 *  "backend-edgecrafter-stream"
 *                    – BackendVisionStreamDetector (EdgeCrafter over WebSocket, beta)
 */
export function createDetector(mode: DetectionMode): Detector {
  switch (mode) {
    case "pose-beta":
      return new RealPoseDetector();
    case "backend-deimv2":
      return new BackendVisionDetector();
    case "backend-edgecrafter-stream":
      return new BackendVisionStreamDetector();
    case "simulated":
    default:
      return new SimulatedDetector();
  }
}
