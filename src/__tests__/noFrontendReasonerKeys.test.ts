import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard: the frontend stays model-agnostic. The worker (behind Cloudflare
 * `/detect` → RunPod) owns the live scene reasoner model (e.g. Gemini). NO
 * Gemini/Google/RunPod/worker secret may ever appear in the browser bundle —
 * only public VITE_* build-time booleans/URLs.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");

const FORBIDDEN_KEY_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_API_KEY",
  "RUNPOD_API_KEY",
  "WORKER_SHARED_SECRET",
  "WORKER_AUTH_HEADER",
  "SESSION_SIGNING_SECRET",
];

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("frontend stays free of reasoner / worker secrets", () => {
  it("build-env.d.ts declares the canonical VITE_HSE_REASONER_* vars (and keeps legacy QWEN aliases)", () => {
    const src = read("src/build-env.d.ts");
    expect(src).toContain("VITE_HSE_REASONER_HEARTBEAT_ENABLED");
    expect(src).toContain("VITE_HSE_REASONER_HEARTBEAT_INTERVAL_MS");
    expect(src).toContain("VITE_HSE_REASONER_RESULT_TTL_MS");
    expect(src).toContain("VITE_HSE_REASONER_CANDIDATE_LANE_ENABLED");
    expect(src).toContain("VITE_HSE_SHOW_REASONER_CANDIDATES");
    // Legacy aliases preserved for back-compat.
    expect(src).toContain("VITE_HSE_QWEN_HEARTBEAT_ENABLED");
    expect(src).toContain("VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED");
  });

  it("build-env.d.ts contains NO Gemini/Google/RunPod/worker key var", () => {
    const src = read("src/build-env.d.ts");
    for (const key of FORBIDDEN_KEY_VARS) {
      expect(src).not.toContain(key);
    }
  });

  it(".env.example contains canonical VITE_HSE_REASONER_* vars and NO forbidden secret", () => {
    const src = read(".env.example");
    expect(src).toContain("VITE_HSE_REASONER_HEARTBEAT_ENABLED");
    expect(src).toContain("VITE_HSE_REASONER_RESULT_TTL_MS");
    for (const key of FORBIDDEN_KEY_VARS) {
      expect(src).not.toContain(key);
    }
  });
});
