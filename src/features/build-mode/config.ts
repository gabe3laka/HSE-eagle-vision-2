/**
 * Build Mode feature flags + tuning constants.
 *
 * Build Mode is additive: it never alters the HSE monitoring pipeline. When the
 * backend routes don't exist yet (no VITE_BUILD_MODE_API_URL), the API client
 * runs in local mock mode so the whole UI still works.
 */

/** Master switch for the Build Mode UI. */
export const ENABLE_BUILD_MODE = true;

/**
 * Finger-level hand tracking via MediaPipe Hand Landmarker (client-side).
 * Build Mode ONLY: lazy-loaded on entering Build Mode with the camera active,
 * fully torn down on leaving. When disabled or failing to load, Build Mode
 * falls back to wrist tracking and touch drag — never blocks.
 */
export const ENABLE_MEDIAPIPE_HANDS = true;

/** Hand-landmark inference cadence (~15 FPS — phones don't need 60). */
export const MEDIAPIPE_HANDS_MIN_INTERVAL_MS = 66;

/** Capture cadence while recording — ~3 FPS keyframes (spec: 2–4 FPS). */
export const BUILD_CAPTURE_INTERVAL_MS = 333;

/** Longest side of the selected-crop JPEG sent per keyframe. */
export const BUILD_CROP_MAX_SIDE = 384;

/** JPEG quality of the selected-crop keyframes. */
export const BUILD_CAPTURE_QUALITY = 0.6;

/** Hard cap on captured keyframes per session (~80s at 3 FPS) — no full video. */
export const BUILD_MAX_FRAMES = 240;

/** Smallest draggable selection accepted (normalized card units). */
export const BUILD_MIN_SELECTION = 0.08;

/**
 * Pinch must be HELD on a box this long before a blueprint is extracted — a
 * mini countdown clock fills during the hold, so accidental pinches don't
 * create mistake blueprints.
 */
export const BUILD_EXTRACT_HOLD_MS = 4000;

/**
 * Build Mode backend API base URL — the Cloudflare Worker ORIGIN only (the
 * client appends `/build/session/...` itself). Resolved in layers because the
 * frontend cannot read Supabase secrets directly at runtime:
 *
 *   1. import.meta.env.VITE_BUILD_MODE_API_URL   (Vite build-time env)
 *   2. Supabase Edge Function `get-build-mode-config` → { buildModeApiUrl }
 *      (reads the Supabase secret of the same name; the URL is NOT sensitive)
 *   3. null → local mock blueprint mode
 */

export type BuildApiSource = "env" | "supabase-config";

export interface ResolvedBuildApi {
  url: string | null;
  source: BuildApiSource | null;
}

/** Trim, drop trailing slash(es), strip an accidental `/build/...` suffix,
 *  reject empty. Returns the bare Worker base, or null. */
export function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/build(\/.*)?$/i, ""); // never let route paths leak into the base
  return v ? v : null;
}

/** Env-only read (no network). */
export function readBuildApiBaseFromEnv(): string | null {
  try {
    return normalizeBaseUrl(import.meta.env.VITE_BUILD_MODE_API_URL);
  } catch {
    return null;
  }
}

/** Back-compat alias kept for existing callers — env-only. */
export function readBuildApiBase(): string | null {
  return readBuildApiBaseFromEnv();
}

// Cache only a SUCCESSFUL resolution (env or Supabase config), so a transient
// Supabase miss retries on the next Build Mode entry rather than locking to mock.
let cachedResolved: ResolvedBuildApi | null = null;

/** Reset the resolution cache — for tests. */
export function resetBuildModeApiCache(): void {
  cachedResolved = null;
}

/** Ask the public Supabase config function for the Build Mode base URL. Browser
 *  only (SSR/tests skip it → mock); never throws; bounded by a short timeout. */
async function fetchSupabaseBuildConfig(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { supabase } = await import("@/integrations/supabase/own-client");
    const invoke = supabase.functions.invoke("get-build-mode-config", { body: {} });
    const timeout = new Promise<{ data: unknown; error: unknown }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: "timeout" }), 4000),
    );
    const { data, error } = (await Promise.race([invoke, timeout])) as {
      data: unknown;
      error: unknown;
    };
    if (error || !data) return null;
    const u = (data as { buildModeApiUrl?: unknown }).buildModeApiUrl;
    return typeof u === "string" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Build Mode API base URL through env → Supabase config → null.
 * Memoizes a successful result for the page lifetime.
 */
export async function resolveBuildModeApiUrl(): Promise<ResolvedBuildApi> {
  if (cachedResolved) return cachedResolved;
  const envUrl = readBuildApiBaseFromEnv();
  if (envUrl) {
    cachedResolved = { url: envUrl, source: "env" };
    return cachedResolved;
  }
  const supaUrl = normalizeBaseUrl(await fetchSupabaseBuildConfig());
  if (supaUrl) {
    cachedResolved = { url: supaUrl, source: "supabase-config" };
    return cachedResolved;
  }
  return { url: null, source: null }; // not cached → retry next entry
}
