/**
 * Risk-aware feature flags (additive). These six flags default **ON** — the
 * operator has enabled the risk-aware UI. Each can still be turned OFF for a
 * specific build by setting its Vite env var to the exact string "false".
 * `readFlag` itself remains OFF-by-default for any unknown/other key (callers
 * opt into ON via the explicit `defaultValue` argument).
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

/** PURE: read a single boolean flag from an env bag. Returns `true` for the
 *  string "true", `false` for the string "false", and `defaultValue` otherwise
 *  (default `false`). This lets a flag default ON while still allowing an
 *  explicit per-build "false" opt-out. */
export function readFlag(
  name: RiskFeatureFlag,
  env: Record<string, unknown> = safeEnv(),
  defaultValue = false,
): boolean {
  const v = env[name];
  if (v === "true") return true;
  if (v === "false") return false;
  return defaultValue;
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

/** The risk-aware UI is enabled by default; set the matching VITE_* var to
 *  "false" to disable a piece for a specific build. */
export function readRiskFeatureFlags(env: Record<string, unknown> = safeEnv()): RiskFeatureFlags {
  return {
    riskAwareOverlay: readFlag("VITE_RISK_AWARE_OVERLAY", env, true),
    workerSceneRisks: readFlag("VITE_WORKER_SCENE_RISKS", env, true),
    riskDebugPanel: readFlag("VITE_RISK_DEBUG_PANEL", env, true),
    showControlHierarchy: readFlag("VITE_SHOW_CONTROL_HIERARCHY", env, true),
    showProvenance: readFlag("VITE_SHOW_PROVENANCE", env, true),
    cameraPrivacyNotice: readFlag("VITE_CAMERA_PRIVACY_NOTICE", env, true),
  };
}

function safeEnv(): Record<string, unknown> {
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}
