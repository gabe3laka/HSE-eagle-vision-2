/**
 * Risk-aware feature flags (additive). Every flag defaults OFF and only turns
 * ON when its Vite env var is the exact string "true". When all flags are off
 * the app behaves byte-for-byte as before — the risk-aware UI is never mounted.
 *
 * Public VITE_* values only — these are build-time booleans, never secrets.
 */

export type RiskFeatureFlag =
  | "VITE_RISK_AWARE_OVERLAY"
  | "VITE_WORKER_SCENE_RISKS"
  | "VITE_RISK_DEBUG_PANEL"
  | "VITE_SHOW_CONTROL_HIERARCHY"
  | "VITE_SHOW_PROVENANCE"
  | "VITE_CAMERA_PRIVACY_NOTICE";

/** PURE: read a single boolean flag from an env bag. OFF unless the value is the
 *  string "true". Defaults to import.meta.env so callers can omit it. */
export function readFlag(name: RiskFeatureFlag, env: Record<string, unknown> = safeEnv()): boolean {
  return env[name] === "true";
}

/** Resolve every risk-aware flag at once (for convenient destructuring). */
export interface RiskFeatureFlags {
  riskAwareOverlay: boolean;
  workerSceneRisks: boolean;
  riskDebugPanel: boolean;
  showControlHierarchy: boolean;
  showProvenance: boolean;
  cameraPrivacyNotice: boolean;
}

export function readRiskFeatureFlags(env: Record<string, unknown> = safeEnv()): RiskFeatureFlags {
  return {
    riskAwareOverlay: readFlag("VITE_RISK_AWARE_OVERLAY", env),
    workerSceneRisks: readFlag("VITE_WORKER_SCENE_RISKS", env),
    riskDebugPanel: readFlag("VITE_RISK_DEBUG_PANEL", env),
    showControlHierarchy: readFlag("VITE_SHOW_CONTROL_HIERARCHY", env),
    showProvenance: readFlag("VITE_SHOW_PROVENANCE", env),
    cameraPrivacyNotice: readFlag("VITE_CAMERA_PRIVACY_NOTICE", env),
  };
}

function safeEnv(): Record<string, unknown> {
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}
