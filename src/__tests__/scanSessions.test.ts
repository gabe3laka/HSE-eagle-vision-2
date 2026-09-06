import { describe, expect, it, vi } from "vitest";
import {
  canEnterIngestionId,
  ingestionPatch,
  isValidAnchorId,
  isValidIngestionId,
  isValidMapCode,
} from "../features/site-scan/hooks/useScanJobs";

const row = (over: Partial<Parameters<typeof canEnterIngestionId>[0]> = {}) => ({
  type: "site" as const,
  status: "done" as const,
  mat_detected: true,
  map_code: null,
  object_anchor_id: null,
  ...over,
});

describe("ingestion id shape validation", () => {
  it("accepts MAP_ codes and rejects everything else for site scans", () => {
    expect(isValidMapCode("MAP_abc123")).toBe(true);
    expect(isValidMapCode("  MAP_X  ")).toBe(true); // trimmed before matching
    expect(isValidMapCode("MAP_")).toBe(false);
    expect(isValidMapCode("map_abc")).toBe(false);
    expect(isValidMapCode("MAP_ab c")).toBe(false);
    expect(isValidMapCode("")).toBe(false);
    expect(isValidIngestionId("site", "MAP_1")).toBe(true);
    expect(isValidIngestionId("site", "OBJ_1")).toBe(false);
  });

  it("object anchors take any non-empty trimmed string", () => {
    expect(isValidAnchorId("OBJ_9f")).toBe(true);
    expect(isValidAnchorId("   ")).toBe(false);
    expect(isValidIngestionId("object", "anything-goes")).toBe(true);
    expect(isValidIngestionId("object", " ")).toBe(false);
  });
});

describe("who may enter an id", () => {
  it("allows a finished metric scan that still lacks its id", () => {
    expect(canEnterIngestionId(row())).toBe(true);
    expect(canEnterIngestionId(row({ type: "object" }))).toBe(true);
  });

  it("blocks object-anchor entry on a NON-metric scan (no mat, no scale)", () => {
    expect(canEnterIngestionId(row({ type: "object", mat_detected: false }))).toBe(false);
    // A non-metric site scan can still be ingested — it is badged, not blocked.
    expect(canEnterIngestionId(row({ mat_detected: false }))).toBe(true);
  });

  it("blocks errored, already-ingested and already-identified rows", () => {
    expect(canEnterIngestionId(row({ status: "error" }))).toBe(false);
    expect(canEnterIngestionId(row({ status: "ingested" }))).toBe(false);
    expect(canEnterIngestionId(row({ map_code: "MAP_1" }))).toBe(false);
    expect(canEnterIngestionId(row({ type: "object", object_anchor_id: "OBJ_1" }))).toBe(false);
  });
});

describe("status transition", () => {
  it("writes the id into the mode's column and flips status to ingested", () => {
    expect(ingestionPatch("site", " MAP_9 ")).toEqual({ status: "ingested", map_code: "MAP_9" });
    expect(ingestionPatch("object", "OBJ_7")).toEqual({
      status: "ingested",
      object_anchor_id: "OBJ_7",
    });
  });
});

describe("setIngestionId — failures surface, never silently no-op", () => {
  async function withDb(update: () => Promise<{ error: { message: string } | null }>) {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/db", () => ({
      db: {
        from: () => ({ update: () => ({ eq: update }) }),
      },
    }));
    const mod = await import("../features/site-scan/hooks/useScanJobs");
    vi.doUnmock("@/integrations/supabase/db");
    return mod;
  }

  it("throws on an invalid shape before touching the database", async () => {
    const eq = vi.fn();
    const { setIngestionId } = await withDb(eq as never);
    await expect(setIngestionId("r1", "site", "not-a-code")).rejects.toThrow("invalid_map_code");
    await expect(setIngestionId("r1", "object", "  ")).rejects.toThrow("invalid_anchor_id");
    expect(eq).not.toHaveBeenCalled();
  });

  it("throws when the database write fails", async () => {
    const { setIngestionId } = await withDb(async () => ({ error: { message: "rls_denied" } }));
    await expect(setIngestionId("r1", "site", "MAP_1")).rejects.toThrow("rls_denied");
  });

  it("resolves with the patch on success", async () => {
    const { setIngestionId } = await withDb(async () => ({ error: null }));
    await expect(setIngestionId("r1", "object", "OBJ_2")).resolves.toEqual({
      status: "ingested",
      object_anchor_id: "OBJ_2",
    });
  });
});
