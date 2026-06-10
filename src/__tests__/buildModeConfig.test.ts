import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeBaseUrl,
  readBuildApiBaseFromEnv,
  resetBuildModeApiCache,
  resolveBuildModeApiUrl,
} from "../features/build-mode/config";

describe("Build Mode API config — normalizeBaseUrl", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeBaseUrl("  https://gw.example/  ")).toBe("https://gw.example");
    expect(normalizeBaseUrl("https://gw.example///")).toBe("https://gw.example");
  });

  it("strips an accidental /build/... route suffix so only the base remains", () => {
    expect(normalizeBaseUrl("https://gw.example/build/session/start")).toBe("https://gw.example");
    expect(normalizeBaseUrl("https://gw.example/build")).toBe("https://gw.example");
    expect(normalizeBaseUrl("https://gw.example/build/")).toBe("https://gw.example");
  });

  it("rejects empty / non-string values", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
    expect(normalizeBaseUrl(123 as unknown as string)).toBeNull();
  });

  it("preserves a legit base path that is not the /build route", () => {
    expect(normalizeBaseUrl("https://gw.example/api")).toBe("https://gw.example/api");
  });
});

describe("Build Mode API config — resolution order", () => {
  beforeEach(() => resetBuildModeApiCache());

  it("reads nothing from env in the test environment (no VITE_BUILD_MODE_API_URL)", () => {
    expect(readBuildApiBaseFromEnv()).toBeNull();
  });

  it("resolves to null/mock when env is unset and Supabase is unavailable (node/SSR)", async () => {
    // In the node test env `window` is undefined, so the Supabase config fetch
    // is skipped and resolution falls through to mock.
    const r = await resolveBuildModeApiUrl();
    expect(r).toEqual({ url: null, source: null });
  });
});
