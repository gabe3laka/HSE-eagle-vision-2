import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

/** Minimal .env reader so the spec can reach Supabase with the same public
 *  values the app uses (no dotenv dependency; env vars win over the file). */
function publicEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    try {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1).trim();
    } catch {
      /* file absent — fine */
    }
  }
  return undefined;
}

async function seedPendingIncident(sb: SupabaseClient, ownerId: string): Promise<string> {
  const { data, error } = await sb
    .from("incidents")
    .insert({
      owner_id: ownerId,
      hazard_type: "blocked_exit",
      severity: "high",
      confidence: 0.91,
      message: "E2E smoke: pending detection awaiting approval",
      // review_status intentionally omitted — the DB default 'pending' IS the
      // gate (same as the live detection writers).
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seed failed");
  return data.id as string;
}

/** Smoke (c): a detection-style row lands in "Pending approval", a human
 *  approves it, and it moves to the incident log. Skips without credentials. */
test("pending detection → human approve → incident log", async ({ page }) => {
  const url = publicEnv("VITE_SUPABASE_URL");
  const key = publicEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");
  test.skip(!url || !key, "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not set");

  // Seed one pending row as the test user (own-row RLS — same rules as the app).
  const sb = createClient(url!, key!, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
    email: email!,
    password: password!,
  });
  expect(authErr).toBeNull();
  const incidentId = await seedPendingIncident(sb, auth!.user!.id);

  try {
    await signIn(page, email!, password!);
    await page.goto("/incidents");

    const pendingLane = page.locator("section", { hasText: "Pending approval" });
    const card = pendingLane.locator("div", { hasText: "E2E smoke: pending detection" }).last();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: /approve/i }).click();

    // The row leaves the pending lane and appears in the confirmed log.
    const logLane = page.locator("section", { hasText: "Incident log" });
    await expect(
      logLane.locator("div", { hasText: "E2E smoke: pending detection" }).last(),
    ).toBeVisible({ timeout: 15_000 });

    const { data: row } = await sb
      .from("incidents")
      .select("review_status")
      .eq("id", incidentId)
      .single();
    expect(row?.review_status).toBe("approved");
  } finally {
    await sb.from("incidents").delete().eq("id", incidentId); // clean up seed
    await sb.auth.signOut();
  }
});
