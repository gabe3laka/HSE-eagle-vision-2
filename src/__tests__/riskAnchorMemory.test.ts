import { describe, it, expect } from "vitest";
import {
  advanceAnchor,
  rebindAnchor,
  upsertAnchorOnLink,
  staleOverlayEntityFor,
  DEFAULT_ANCHOR_CAPS,
  anchorReasonFor,
  type RiskAnchorEntry,
} from "@/features/hse-monitoring/lib/riskAnchorMemory";
import type { BackendEntity } from "@/lib/detection/types";

function entity(opts: Partial<BackendEntity> & { bbox: BackendEntity["bbox"] }): BackendEntity {
  return {
    label: "person",
    class_id: 0,
    confidence: 0.9,
    ...opts,
  } as BackendEntity;
}

function baseAnchor(overrides: Partial<RiskAnchorEntry> = {}): RiskAnchorEntry {
  return {
    anchorKey: "k1",
    hazardType: "object_near_edge",
    level: "YELLOW",
    label: "person",
    lastBbox: { x: 0.4, y: 0.4, w: 0.1, h: 0.2 },
    lastTrackIds: ["t-old"],
    lastEntityIds: ["t-old"],
    firstSeenMs: 0,
    lastLinkedMs: 0,
    lastUpdatedMs: 0,
    disposition: "linked",
    rebindPath: "id",
    ...overrides,
  };
}

describe("riskAnchorMemory.rebindAnchor", () => {
  it("rebinds by id when a current entity shares an id", () => {
    const anchor = baseAnchor({ lastTrackIds: ["t-7"], lastEntityIds: ["t-7"] });
    const cur = entity({
      track_id: "t-7",
      bbox: { x: 0, y: 0, w: 0.05, h: 0.05 },
    });
    const r = rebindAnchor(anchor, [cur]);
    expect(r.path).toBe("id");
    expect(r.entity).toBe(cur);
  });

  it("rebinds across a track_id change via same label + IoU/proximity", () => {
    const anchor = baseAnchor();
    const cur = entity({
      track_id: "t-NEW",
      label: "person",
      // Slight shift from lastBbox — IoU > 0.2.
      bbox: { x: 0.42, y: 0.42, w: 0.1, h: 0.2 },
    });
    const r = rebindAnchor(anchor, [cur]);
    expect(r.path).toBe("label-spatial");
    expect(r.entity).toBe(cur);
  });

  it("rebinds by center distance when IoU is 0 but centers are close", () => {
    const anchor = baseAnchor({
      lastBbox: { x: 0.4, y: 0.4, w: 0.05, h: 0.05 },
    });
    const cur = entity({
      track_id: "t-NEW",
      label: "person",
      // No overlap, but center is within 0.12.
      bbox: { x: 0.46, y: 0.46, w: 0.05, h: 0.05 },
    });
    const r = rebindAnchor(anchor, [cur]);
    expect(r.path).toBe("label-spatial");
    expect(r.entity).toBe(cur);
  });

  it("rebinds via spatial-only fallback when label differs but bbox is close", () => {
    // An old linked risk (captured against a "person" track) re-binds to the
    // current YOLO entity even after its track id changed AND its label differs,
    // as long as the box is in the same place — keeps risk painted on the
    // moving box while the camera runs.
    const anchor = baseAnchor({
      label: "person",
      lastBbox: { x: 0.4, y: 0.4, w: 0.05, h: 0.05 },
    });
    const cur = entity({
      track_id: "t-NEW",
      label: "worker",
      // Different label, no IoU, but center within the tighter 0.08 threshold.
      bbox: { x: 0.44, y: 0.44, w: 0.05, h: 0.05 },
    });
    const r = rebindAnchor(anchor, [cur]);
    expect(r.path).toBe("spatial-only");
    expect(r.entity).toBe(cur);
  });

  it("returns carried when no match is close enough", () => {
    const anchor = baseAnchor();
    const cur = entity({
      track_id: "t-NEW",
      label: "person",
      bbox: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 },
    });
    const r = rebindAnchor(anchor, [cur]);
    expect(r.path).toBe("carried");
    expect(r.entity).toBeNull();
  });
});

describe("riskAnchorMemory.advanceAnchor", () => {
  it("expires YELLOW anchors past 2500ms after last link", () => {
    const anchor = baseAnchor({ level: "YELLOW", lastLinkedMs: 0 });
    const res = advanceAnchor({
      entry: anchor,
      currentEntities: [],
      nowMs: 2600,
    });
    expect(res.expired).toBe(true);
  });

  it("expires RED anchors past 5000ms after last link", () => {
    const anchor = baseAnchor({ level: "RED", lastLinkedMs: 0 });
    const res = advanceAnchor({
      entry: anchor,
      currentEntities: [],
      nowMs: 5100,
    });
    expect(res.expired).toBe(true);
  });

  it("marks sticky-carried inside the sticky window when no rebind", () => {
    const anchor = baseAnchor({ lastLinkedMs: 0 });
    const res = advanceAnchor({
      entry: anchor,
      currentEntities: [],
      nowMs: DEFAULT_ANCHOR_CAPS.stickyWindowMs - 1,
    });
    expect(res.expired).toBe(false);
    expect(res.entry.disposition).toBe("sticky-carried");
    expect(res.entry.rebindPath).toBe("carried");
    expect(res.rebound).toBeNull();
  });

  it("marks stale past sticky window but inside outer cap", () => {
    const anchor = baseAnchor({ level: "YELLOW", lastLinkedMs: 0 });
    const res = advanceAnchor({
      entry: anchor,
      currentEntities: [],
      nowMs: DEFAULT_ANCHOR_CAPS.stickyWindowMs + 200,
    });
    expect(res.expired).toBe(false);
    expect(res.entry.disposition).toBe("stale");
  });

  it("uses the CURRENT YOLO bbox (not the cached one) when rebound", () => {
    const anchor = baseAnchor();
    const newBbox = { x: 0.42, y: 0.42, w: 0.1, h: 0.2 };
    const cur = entity({ track_id: "t-NEW", label: "person", bbox: newBbox });
    const res = advanceAnchor({
      entry: anchor,
      currentEntities: [cur],
      nowMs: 1000,
    });
    expect(res.rebound).toBe(cur);
    expect(res.entry.lastBbox).toEqual(newBbox);
    expect(res.entry.disposition).toBe("linked");
    expect(res.entry.lastLinkedMs).toBe(1000);
  });
});

describe("riskAnchorMemory.upsertAnchorOnLink", () => {
  it("creates a new anchor with current entity data", () => {
    const cur = entity({
      track_id: "t-1",
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    });
    const next = upsertAnchorOnLink({
      prev: undefined,
      anchorKey: "k",
      hazardType: "object_near_edge",
      level: "YELLOW",
      currentEntity: cur,
      nowMs: 42,
    });
    expect(next).not.toBeNull();
    expect(next!.firstSeenMs).toBe(42);
    expect(next!.lastLinkedMs).toBe(42);
    expect(next!.lastBbox).toEqual(cur.bbox);
    expect(next!.lastTrackIds).toContain("t-1");
    expect(next!.disposition).toBe("linked");
  });

  it("preserves firstSeenMs across re-link", () => {
    const cur = entity({
      track_id: "t-2",
      bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
    });
    const prev = baseAnchor({ firstSeenMs: 10, lastLinkedMs: 10 });
    const next = upsertAnchorOnLink({
      prev,
      anchorKey: "k",
      hazardType: "object_near_edge",
      level: "YELLOW",
      currentEntity: cur,
      nowMs: 999,
    });
    expect(next!.firstSeenMs).toBe(10);
    expect(next!.lastLinkedMs).toBe(999);
  });
});

describe("riskAnchorMemory.staleOverlayEntityFor", () => {
  it("emits a marker BackendEntity carrying the lastBbox", () => {
    const anchor = baseAnchor({ disposition: "sticky-carried" });
    const e = staleOverlayEntityFor(anchor) as BackendEntity & {
      __riskAnchorStale?: boolean;
      __anchorKey?: string;
    };
    expect(e.bbox).toEqual(anchor.lastBbox);
    expect(e.risk_level).toBe("YELLOW");
    expect(e.__riskAnchorStale).toBe(true);
    expect(e.__anchorKey).toBe(anchor.anchorKey);
  });
});

describe("riskAnchorMemory.anchorReasonFor", () => {
  it("describes each disposition", () => {
    expect(anchorReasonFor(baseAnchor({ disposition: "linked", rebindPath: "id" }))).toMatch(
      /linked/,
    );
    expect(
      anchorReasonFor(baseAnchor({ disposition: "linked", rebindPath: "label-spatial" })),
    ).toMatch(/proximity/);
    expect(anchorReasonFor(baseAnchor({ disposition: "sticky-carried" }))).toMatch(/holding/);
    expect(anchorReasonFor(baseAnchor({ disposition: "stale" }))).toMatch(/fading/);
  });
});
