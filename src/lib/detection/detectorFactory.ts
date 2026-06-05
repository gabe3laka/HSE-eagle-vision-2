import type { Detector, DetectionMode } from "./types";
import { SimulatedDetector } from "./simulatedDetector";
import { RealPoseDetector } from "./realPoseDetector";
import { BackendVisionDetector } from "./backendVisionDetector";

/**
 * Returns the detector for the chosen mode. Every detector implements the same
 * `Detector` contract, so the live loop, RiskEngine, alerts and persistence are
 * identical regardless of which one runs.
 */
export function createDetector(mode: DetectionMode): Detector {
  switch (mode) {
    case "pose-beta":
      return new RealPoseDetector();
    case "backend-deimv2":
      return new BackendVisionDetector();
    case "simulated":
    default:
      return new SimulatedDetector();
  }
}
