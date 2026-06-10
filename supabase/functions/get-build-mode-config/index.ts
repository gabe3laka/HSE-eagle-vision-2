/**
 * supabase/functions/get-build-mode-config/index.ts
 *
 * Public, NON-sensitive runtime config for Build Mode. The frontend cannot read
 * Supabase secrets directly, so this returns ONLY the Build Mode API base URL
 * (the Cloudflare Worker origin) from the secret of the same name:
 *
 *   { "buildModeApiUrl": "https://eagle-vision-stream-gateway.<...>.workers.dev" }
 *
 * Returns { buildModeApiUrl: null } when the secret is unset. NEVER returns
 * RunPod keys, signing secrets, the service-role key, or any other env var —
 * only this single, non-secret URL.
 *
 * Env (Supabase function env):
 *   VITE_BUILD_MODE_API_URL   Cloudflare Worker base URL (origin only)
 *
 * Deploy with verify_jwt = false (public, harmless config).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Trim, drop trailing slash(es) and any accidental `/build/...` route suffix. */
function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/build(\/.*)?$/i, "");
  return v ? v : null;
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const buildModeApiUrl = normalizeBaseUrl(Deno.env.get("VITE_BUILD_MODE_API_URL"));
  return json({ buildModeApiUrl });
});
