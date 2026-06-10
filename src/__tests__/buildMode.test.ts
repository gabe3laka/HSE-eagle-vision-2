import { describe, it, expect } from "vitest";
import {
  blueprintFrameAt,
  interpolateFrames,
  mockAnchors,
  mockBlueprintFrame,
  mockOutline,
  replayDurationMs,
} from "../features/build-mode/lib/blueprint";
import { mapRegionToSource, regionCaptureSize } from "../features/build-mode/lib/regionCapture";
import {
  fetchBuildReplay,
  finishBuildSession,
  lockBuildSelection,
  sendBuildFrame,
  startBuildSession,
} from "../features/build-mode/api/buildModeClient";
import { MOBILE_VISUAL_ASPECT } from "../lib/detection/coverCrop";
import type { BlueprintFrame, SelectedRegion } from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };

describe("Build Mode — mock blueprint generation", () => {
  it("outline is a closed-ish ring of normalized points", () => {
    const outline = mockOutline(0);
    expect(outline.length).toBeGreaterThanOrEqual(8);
    for (const p of outline) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("generates 4–8 anchors with the 4 corners always present", () => {
    for (const i of [0, 3, 11]) {
      const anchors = mockAnchors(i);
      expect(anchors.length).toBeGreaterThanOrEqual(4);
      expect(anchors.length).toBeLessThanOrEqual(8);
      const ids = anchors.map((a) => a.id);
      for (const c of ["a-tl", "a-tr", "a-br", "a-bl"]) expect(ids).toContain(c);
    }
  });

  it("mock frames are deterministic per index and carry step markers + instruction", () => {
    const a = mockBlueprintFrame("s", 7, 2331, REGION);
    const b = mockBlueprintFrame("s", 7, 2331, REGION);
    expect(a).toEqual(b);
    expect(a.stepMarkers!.length).toBeGreaterThanOrEqual(1);
    expect(a.instruction).toContain("Step");
  });
});

describe("Build Mode — replay timeline math", () => {
  const f = (ts: number, x: number): BlueprintFrame => ({
    sessionId: "s",
    frameId: `f${ts}`,
    timestampMs: ts,
    outline: [
      { x, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
    anchors: [{ id: "a", x, y: 0.5 }],
  });

  it("duration is the last keyframe timestamp", () => {
    expect(replayDurationMs([])).toBe(0);
    expect(replayDurationMs([f(0, 0), f(1000, 1)])).toBe(1000);
  });

  it("clamps before the first and after the last keyframe", () => {
    const frames = [f(100, 0), f(1100, 1)];
    expect(blueprintFrameAt(frames, 0)!.anchors[0].x).toBe(0);
    expect(blueprintFrameAt(frames, 99999)!.anchors[0].x).toBe(1);
  });

  it("interpolates outline + anchors linearly between keyframes", () => {
    const frames = [f(0, 0), f(1000, 1)];
    const mid = blueprintFrameAt(frames, 500)!;
    expect(mid.outline[0].x).toBeCloseTo(0.5, 5);
    expect(mid.anchors[0].x).toBeCloseTo(0.5, 5);
    const q = interpolateFrames(f(0, 0), f(1000, 1), 0.25);
    expect(q.anchors[0].x).toBeCloseTo(0.25, 5);
  });

  it("returns null with no frames", () => {
    expect(blueprintFrameAt([], 0)).toBeNull();
  });
});

describe("Build Mode — region → source-pixel mapping", () => {
  it("desktop (no crop): region maps directly into the full frame", () => {
    const r = mapRegionToSource(1280, 720, null, { x: 0.5, y: 0.5, w: 0.25, h: 0.5 })!;
    expect(r.sx).toBeCloseTo(640, 3);
    expect(r.sy).toBeCloseTo(360, 3);
    expect(r.sw).toBeCloseTo(320, 3);
    expect(r.sh).toBeCloseTo(360, 3);
  });

  it("mobile portrait: region maps inside the 3/4 cover-crop of a 1280×720 stream", () => {
    // cover crop of 1280x720 to 3/4 => sw = 720*0.75 = 540, sx = (1280-540)/2 = 370
    const r = mapRegionToSource(1280, 720, MOBILE_VISUAL_ASPECT, {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    })!;
    expect(r.sx).toBeCloseTo(370, 3);
    expect(r.sy).toBeCloseTo(0, 3);
    expect(r.sw).toBeCloseTo(540, 3);
    expect(r.sh).toBeCloseTo(720, 3);
  });

  it("rejects degenerate inputs", () => {
    expect(mapRegionToSource(0, 720, null, REGION)).toBeNull();
    expect(mapRegionToSource(1280, 720, null, { x: 0, y: 0, w: 0, h: 0.5 })).toBeNull();
  });

  it("caps the capture's longest side and preserves aspect", () => {
    const a = regionCaptureSize(1080, 540, 384);
    expect(a.cw).toBe(384);
    expect(a.ch).toBe(192);
    const b = regionCaptureSize(200, 100, 384); // already small — no upscale
    expect(b).toEqual({ cw: 200, ch: 100 });
  });
});

describe("Build Mode — API client (mock mode, no backend configured)", () => {
  it("runs the whole session lifecycle locally: start → frames → finish → replay", async () => {
    const session = await startBuildSession();
    expect(session.backendMode).toBe("mock");
    expect(session.sessionId).toMatch(/^mock-/);
    await lockBuildSelection(session, REGION); // no-op in mock mode

    const sent: BlueprintFrame[] = [];
    for (let i = 0; i < 3; i++) {
      const frame = await sendBuildFrame(
        session,
        {
          sessionId: session.sessionId,
          frameId: `f-${i}`,
          timestampMs: i * 333,
          selectedRegion: REGION,
          image_b64: "QUJD", // crop only — the mock never needs real pixels
        },
        i,
      );
      sent.push(frame);
      expect(frame.sessionId).toBe(session.sessionId);
      expect(frame.outline.length).toBeGreaterThanOrEqual(8);
      expect(frame.anchors.length).toBeGreaterThanOrEqual(4);
      expect(frame.anchors.length).toBeLessThanOrEqual(8);
    }

    const replayId = await finishBuildSession(session);
    expect(replayId).toBe(session.sessionId);

    const replay = await fetchBuildReplay(replayId);
    expect(replay.frames).toHaveLength(3);
    expect(replay.frames.map((fr) => fr.timestampMs)).toEqual([0, 333, 666]);
    expect(replay.frames).toEqual(sent);
  });
});
