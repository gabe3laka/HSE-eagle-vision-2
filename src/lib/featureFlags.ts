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
  | "VITE_CAMERA_PRIVACY_NOTICE"
  | "VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED"
  | "VITE_HSE_SHOW_QWEN_CANDIDATES"
  | "VITE_HSE_LOCAL_ALERTS_ENABLED"
  | "VITE_HSE_QWEN_HEARTBEAT_ENABLED"
  | "VITE_HSE_QWEN_HEARTBEAT_FORCE_REASON";

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

/**
 * HSE Live monitoring feature flags. All default OFF — the cleaned-up Live HSE
 * surface treats worker/Qwen scene risks as the visible source of truth and
 * keeps legacy on-device alerts / Qwen advisory candidates out of the way.
 */
export interface HseFeatureFlags {
  /** Surface Qwen candidate lane in the view model (does NOT auto-render UI). */
  qwenCandidateLaneEnabled: boolean;
  /** Render Qwen-only advisory candidates in the visible UI. */
  showQwenCandidates: boolean;
  /** Re-enable legacy local HSE alerts (haptics, incidents, AlertFeed in HSE,
   *  "Analyze scene" local reasoning). */
  localAlertsEnabled: boolean;
}

export function readHseFeatureFlags(env: Record<string, unknown> = safeEnv()): HseFeatureFlags {
  return {
    qwenCandidateLaneEnabled: readFlag("VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED", env, false),
    showQwenCandidates: readFlag("VITE_HSE_SHOW_QWEN_CANDIDATES", env, false),
    localAlertsEnabled: readFlag("VITE_HSE_LOCAL_ALERTS_ENABLED", env, false),
  };
}

/** Qwen scene-reasoning heartbeat (low-frequency Qwen loop) configuration. */
export interface HseQwenHeartbeatFlags {
  enabled: boolean;
  intervalMs: number;
  backoffMs: number;
  /** Delay after `extendedBackoffAfter` consecutive Qwen failures. */
  extendedBackoffMs: number;
  /** Number of consecutive failures before switching to `extendedBackoffMs`. */
  extendedBackoffAfter: number;
  forceReason: boolean;
  resultTtlMs: number;
}

function readNumberEnv(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
): number {
  const v = env[key];
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

export function readHseQwenHeartbeatFlags(
  env: Record<string, unknown> = safeEnv(),
): HseQwenHeartbeatFlags {
  const intervalMs = readNumberEnv(env, "VITE_HSE_QWEN_HEARTBEAT_MS", 2000, 1000);
  const backoffMs = readNumberEnv(
    env,
    "VITE_HSE_QWEN_HEARTBEAT_BACKOFF_MS",
    10000,
    intervalMs,
  );
  return {
    enabled: readFlag("VITE_HSE_QWEN_HEARTBEAT_ENABLED", env, true),
    intervalMs,
    backoffMs,
    extendedBackoffMs: readNumberEnv(
      env,
      "VITE_HSE_QWEN_HEARTBEAT_EXTENDED_BACKOFF_MS",
      30000,
      backoffMs,
    ),
    extendedBackoffAfter: readNumberEnv(
      env,
      "VITE_HSE_QWEN_HEARTBEAT_EXTENDED_BACKOFF_AFTER",
      3,
      1,
    ),
    forceReason: readFlag("VITE_HSE_QWEN_HEARTBEAT_FORCE_REASON", env, true),
    resultTtlMs: readNumberEnv(env, "VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS", 3000, 500),
  };
}

function safeEnv(): Record<string, unknown> {
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}
