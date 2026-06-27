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
  // Canonical generic reasoner flags (preferred).
  | "VITE_HSE_REASONER_CANDIDATE_LANE_ENABLED"
  | "VITE_HSE_SHOW_REASONER_CANDIDATES"
  | "VITE_HSE_REASONER_HEARTBEAT_ENABLED"
  | "VITE_HSE_REASONER_HEARTBEAT_FORCE_REASON"
  // Legacy Qwen-named aliases (still honored when the canonical is absent).
  | "VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED"
  | "VITE_HSE_SHOW_QWEN_CANDIDATES"
  | "VITE_HSE_LOCAL_ALERTS_ENABLED"
  | "VITE_HSE_QWEN_HEARTBEAT_ENABLED"
  | "VITE_HSE_QWEN_HEARTBEAT_FORCE_REASON"
  | "VITE_SHARED_VISION_ENABLED"
  // Dev-only Hive diagnostics (projection readiness panel + FOV cones). OFF by
  // default — never shown to operators unless explicitly enabled for a build.
  | "VITE_HIVE_DEBUG";

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

/**
 * PURE: read a boolean flag honoring a canonical name first, falling back to a
 * legacy alias only when the canonical is absent. The canonical value ALWAYS
 * wins when present (even when set to "false"); only when it is unset/unknown do
 * we consult the legacy alias. Used for the Qwen→Reasoner flag rename.
 */
export function readBooleanAlias(
  env: Record<string, unknown>,
  canonical: RiskFeatureFlag,
  legacy: RiskFeatureFlag,
  defaultValue: boolean,
): boolean {
  const c = env[canonical];
  if (c === "true") return true;
  if (c === "false") return false;
  return readFlag(legacy, env, defaultValue);
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
 * surface treats worker/reasoner scene risks as the visible source of truth and
 * keeps legacy on-device alerts / reasoner advisory candidates out of the way.
 */
export interface HseFeatureFlags {
  /** Surface the reasoner candidate lane in the view model (does NOT auto-render UI). */
  reasonerCandidateLaneEnabled: boolean;
  /** Render reasoner-only advisory candidates in the visible UI. */
  showReasonerCandidates: boolean;
  /** Re-enable legacy local HSE alerts (haptics, incidents, AlertFeed in HSE,
   *  "Analyze scene" local reasoning). */
  localAlertsEnabled: boolean;
}

/**
 * Resolve HSE feature flags. The canonical generic `VITE_HSE_REASONER_*` value
 * wins when present; the legacy `VITE_HSE_QWEN_*` is used only when the generic
 * is absent.
 */
export function readHseFeatureFlags(env: Record<string, unknown> = safeEnv()): HseFeatureFlags {
  return {
    reasonerCandidateLaneEnabled: readBooleanAlias(
      env,
      "VITE_HSE_REASONER_CANDIDATE_LANE_ENABLED",
      "VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED",
      false,
    ),
    showReasonerCandidates: readBooleanAlias(
      env,
      "VITE_HSE_SHOW_REASONER_CANDIDATES",
      "VITE_HSE_SHOW_QWEN_CANDIDATES",
      false,
    ),
    localAlertsEnabled: readFlag("VITE_HSE_LOCAL_ALERTS_ENABLED", env, false),
  };
}

/** Worker scene-reasoning heartbeat (low-frequency reasoner loop) configuration. */
export interface HseReasonerHeartbeatFlags {
  enabled: boolean;
  /** Effective tick interval (≥ minIntervalMs, hard floor 1000 ms). */
  intervalMs: number;
  /** Hard floor used to clamp `intervalMs` (≥1000 ms). */
  minIntervalMs: number;
  backoffMs: number;
  /** Delay after `extendedBackoffAfter` consecutive reasoner failures. */
  extendedBackoffMs: number;
  /** Number of consecutive failures before switching to `extendedBackoffMs`. */
  extendedBackoffAfter: number;
  forceReason: boolean;
  resultTtlMs: number;
}

/** @deprecated Use {@link HseReasonerHeartbeatFlags}. Kept as a legacy alias. */
export type HseQwenHeartbeatFlags = HseReasonerHeartbeatFlags;

/**
 * Read the first env key that parses to a finite number; falls back to
 * `fallback` if none are set. Clamped to `min`. Used to honor the prompt's
 * canonical flag names while keeping legacy aliases working. List the canonical
 * key FIRST so it wins over any legacy alias when both are present.
 */
function readNumberEnvAlias(
  env: Record<string, unknown>,
  keys: readonly string[],
  fallback: number,
  min: number,
): number {
  for (const key of keys) {
    const v = env[key];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return Math.max(min, n);
  }
  return Math.max(min, fallback);
}

/**
 * Resolve the reasoner scene-reasoning heartbeat config. For every knob the
 * canonical generic `VITE_HSE_REASONER_*` value wins when present; the legacy
 * `VITE_HSE_QWEN_*` value is only consulted when the generic is absent. The
 * canonical key is therefore always listed FIRST in each alias lookup.
 */
export function readHseReasonerHeartbeatFlags(
  env: Record<string, unknown> = safeEnv(),
): HseReasonerHeartbeatFlags {
  // Hard floor 1000 ms per prompt; configurable via MIN_INTERVAL_MS env.
  const minIntervalMs = readNumberEnvAlias(
    env,
    ["VITE_HSE_REASONER_HEARTBEAT_MIN_INTERVAL_MS", "VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS"],
    1000,
    1000,
  );
  // Canonical: VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS. Legacy aliases follow.
  const rawInterval = readNumberEnvAlias(
    env,
    [
      "VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS",
      "VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS",
      "VITE_HSE_QWEN_HEARTBEAT_MS",
    ],
    // Default 5000 ms: reduce Gemini spam (the worker also rate-limits and
    // triggers reasoning from live frames), while the result-latch keeps boxes
    // colored between the slower arrivals.
    5000,
    minIntervalMs,
  );
  const intervalMs = Math.max(minIntervalMs, rawInterval);
  const backoffMs = readNumberEnvAlias(
    env,
    ["VITE_HSE_REASONER_HEARTBEAT_BACKOFF_MS", "VITE_HSE_QWEN_HEARTBEAT_BACKOFF_MS"],
    10000,
    intervalMs,
  );
  return {
    enabled: readBooleanAlias(
      env,
      "VITE_HSE_REASONER_HEARTBEAT_ENABLED",
      "VITE_HSE_QWEN_HEARTBEAT_ENABLED",
      true,
    ),
    intervalMs,
    minIntervalMs,
    backoffMs,
    extendedBackoffMs: readNumberEnvAlias(
      env,
      [
        "VITE_HSE_REASONER_HEARTBEAT_EXTENDED_BACKOFF_MS",
        "VITE_HSE_QWEN_HEARTBEAT_EXTENDED_BACKOFF_MS",
      ],
      30000,
      backoffMs,
    ),
    extendedBackoffAfter: readNumberEnvAlias(
      env,
      [
        "VITE_HSE_REASONER_HEARTBEAT_EXTENDED_BACKOFF_AFTER",
        "VITE_HSE_QWEN_HEARTBEAT_EXTENDED_BACKOFF_AFTER",
      ],
      3,
      1,
    ),
    forceReason: readBooleanAlias(
      env,
      "VITE_HSE_REASONER_HEARTBEAT_FORCE_REASON",
      "VITE_HSE_QWEN_HEARTBEAT_FORCE_REASON",
      true,
    ),
    // Canonical: VITE_HSE_REASONER_RESULT_TTL_MS (default 12000). Covers Gemini
    // ~5–12s reasoner latency so the last-good latch stays fresh across slow
    // arrivals. Legacy aliases: VITE_HSE_QWEN_RESULT_TTL_MS, ..._HEARTBEAT_RESULT_TTL_MS.
    resultTtlMs: readNumberEnvAlias(
      env,
      [
        "VITE_HSE_REASONER_RESULT_TTL_MS",
        "VITE_HSE_QWEN_RESULT_TTL_MS",
        "VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS",
      ],
      12000,
      500,
    ),
  };
}

/**
 * @deprecated Use {@link readHseReasonerHeartbeatFlags}. Thin legacy-named
 * re-export kept so existing imports keep resolving.
 */
export const readHseQwenHeartbeatFlags = readHseReasonerHeartbeatFlags;

function safeEnv(): Record<string, unknown> {
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}
