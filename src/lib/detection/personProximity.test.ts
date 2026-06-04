import { describe, it, expect } from "vitest";
import {
  boxIoU,
  edgeGap,
  makePairKey,
  scorePersonProximity,
  unionBox,
  PersonTracker,
  PROXIMITY_EMIT_THRESHOLD,
  PROXIMITY_STRONG_THRESHOLD,
} from "./personProximity";
import type { BBox } from "./types";

const box = (x: number, y: number, w = 0.18, h = 0.5): BBox => ({ x, y, w, h });

describe("box geometry", () => {
  it("boxIoU is 1 for identical, 0 for disjoint", () => {
    const b = box(0.3, 0.4);
    expect(boxIoU(b, b)).toBeCloseTo(1, 5);
    expect(boxIoU(box(0.0, 0.4), box(0.8, 0.4))).toBe(0);
  });

  it("edgeGap is 0 when overlapping, positive when apart", () => {
    expect(edgeGap(box(0.4, 0.4), box(0.45, 0.4))).toBe(0);
    expect(edgeGap(box(0.05, 0.4), box(0.75, 0.4))).toBeGreaterThan(0);
  });

  it("unionBox covers both boxes", () => {
    const u = unionBox(box(0.1, 0.2, 0.2, 0.3), box(0.5, 0.4, 0.2, 0.3));
    expect(u.x).toBeCloseTo(0.1, 5);
    expect(u.y).toBeCloseTo(0.2, 5);
    expect(u.x + u.w).toBeCloseTo(0.7, 5);
    expect(u.y + u.h).toBeCloseTo(0.7, 5);
  });

  it("makePairKey is sorted and order-independent", () => {
    expect(makePairKey("p2", "p1")).toBe("p1-p2");
    expect(makePairKey("p1", "p2")).toBe(makePairKey("p2", "p1"));
  });
});

describe("scorePersonProximity", () => {
  it("two people far apart → below the emit threshold", () => {
    const r = scorePersonProximity(box(0.05, 0.4), box(0.75, 0.4));
    expect(r.score).toBeLessThan(PROXIMITY_EMIT_THRESHOLD);
  });

  it("two people close → emits, strongly", () => {
    const r = scorePersonProximity(box(0.35, 0.4), box(0.48, 0.4));
    expect(r.score).toBeGreaterThanOrEqual(PROXIMITY_EMIT_THRESHOLD);
    expect(r.score).toBeGreaterThanOrEqual(PROXIMITY_STRONG_THRESHOLD);
  });

  it("overlapping boxes → high confidence", () => {
    const r = scorePersonProximity(box(0.4, 0.4, 0.2, 0.5), box(0.45, 0.4, 0.2, 0.5));
    expect(r.score).toBeGreaterThan(PROXIMITY_STRONG_THRESHOLD);
  });

  it("different floor level → lower score than the same-floor pair", () => {
    const same = scorePersonProximity(box(0.4, 0.4, 0.18, 0.4), box(0.5, 0.4, 0.18, 0.4));
    const diff = scorePersonProximity(box(0.4, 0.4, 0.18, 0.4), box(0.5, 0.55, 0.18, 0.4));
    expect(diff.sameFloor).toBeLessThan(0.5);
    expect(diff.score).toBeLessThan(same.score);
  });
});

describe("PersonTracker", () => {
  it("keeps a stable id while a person moves slightly", () => {
    const tr = new PersonTracker(900);
    let id = "";
    for (let t = 0; t <= 500; t += 100) {
      const r = tr.update([box(0.3 + t * 0.0001, 0.4)], t);
      if (t === 0) id = r[0].id;
      else expect(r[0].id).toBe(id);
    }
  });

  it("assigns a new id to a second person", () => {
    const tr = new PersonTracker(900);
    tr.update([box(0.3, 0.4)], 0);
    const r = tr.update([box(0.31, 0.4), box(0.7, 0.4)], 100);
    const ids = r.map((t) => t.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(new Set(ids).size).toBe(2);
  });

  it("expires a track after the gap and re-ids", () => {
    const tr = new PersonTracker(900);
    const first = tr.update([box(0.3, 0.4)], 0)[0].id;
    const after = tr.update([box(0.3, 0.4)], 5000)[0].id; // long gap → expired
    expect(after).not.toBe(first);
  });
});
