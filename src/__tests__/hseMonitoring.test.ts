import { describe, it, expect } from "vitest";
import {
  isPersonLabel,
  mapToHseObservations,
  normalizeHseLabel,
  poseBoundingBox,
  poseCoversBox,
} from "../lib/detection/hseEntityMapper";
import { HSETracker } from "../lib/detection/hseTracker";
import { runHseRules } from "../lib/detection/hseRiskRules";
import {
  applyHseRequestToBody,
  buildHseDetectRequest,
  normalizeRoi,
} from "../lib/detection/hseDetectProfile";
import type { BBox } from "../lib/detection/types";
import type { HSECategory, HSETrack } from "../lib/detection/hseTypes";

const box = (x: number, y: number, w: number, h: number): BBox => ({ x, y, w, h });

describe("HSE entity mapper", () => {
  it("normalizes common HSE labels to categories", () => {
    expect(normalizeHseLabel("forklift")).toEqual({
      category: "vehicle",
      normalizedLabel: "forklift",
    });
    expect(normalizeHseLabel("worker")).toMatchObject({ category: "person" });
    expect(normalizeHseLabel("hard hat")).toMatchObject({
      category: "ppe",
      normalizedLabel: "ppe-head",
    });
    expect(normalizeHseLabel("safety vest")).toMatchObject({ normalizedLabel: "ppe-vest" });
    expect(normalizeHseLabel("ladder")).toMatchObject({ category: "fall-hazard" });
    expect(normalizeHseLabel("spill")).toMatchObject({
      category: "trip-hazard",
      normalizedLabel: "slip-hazard",
    });
    // unknown stays unknown — never faked
    expect(normalizeHseLabel("zorblax")).toEqual({
      category: "unknown",
      normalizedLabel: "zorblax",
    });
  });

  it("maps backend entities to HSE observations", () => {
    const obs = mapToHseObservations({
      entities: [
        { label: "person", class_id: 0, confidence: 0.8, bbox: box(0.2, 0.3, 0.2, 0.4) },
        { label: "forklift", class_id: 1, confidence: 0.7, bbox: box(0.5, 0.4, 0.3, 0.3) },
      ],
      timestampMs: 1000,
    });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({
      category: "person",
      normalizedLabel: "person",
      source: "yolo26",
    });
    expect(obs[1]).toMatchObject({ category: "vehicle", normalizedLabel: "forklift" });
  });

  it("maps poses to person observations and segments without crashing", () => {
    const obs = mapToHseObservations({
      poses: [
        {
          confidence: 0.6,
          keypoints: [
            { name: "nose", x: 0.5, y: 0.2, score: 0.9 },
            { name: "left_hip", x: 0.48, y: 0.6, score: 0.8 },
          ],
        },
      ],
      segments: [
        {
          label: "pallet",
          class_id: 2,
          confidence: 0.5,
          maskContour: [
            { x: 0.1, y: 0.1 },
            { x: 0.3, y: 0.1 },
            { x: 0.3, y: 0.3 },
          ],
        },
        { label: "junk", class_id: 9, confidence: 0.1, maskContour: [] },
      ],
      timestampMs: 1000,
    });
    const person = obs.find((o) => o.category === "person");
    expect(person?.pose).toBeTruthy();
    // segment with a valid contour becomes a trip-hazard observation; empty one is dropped gracefully
    expect(obs.some((o) => o.normalizedLabel === "trip-hazard")).toBe(true);
    expect(() => obs.length).not.toThrow();
  });
});

describe("Person box hiding (pose available)", () => {
  const pose = (cx: number, cy: number) => ({
    confidence: 0.8,
    keypoints: [
      { name: "nose", x: cx, y: cy - 0.1, score: 0.9 },
      { name: "left_hip", x: cx - 0.05, y: cy + 0.1, score: 0.8 },
      { name: "right_hip", x: cx + 0.05, y: cy + 0.1, score: 0.8 },
    ],
  });

  it("identifies person/worker labels", () => {
    expect(isPersonLabel("person")).toBe(true);
    expect(isPersonLabel("Worker")).toBe(true);
    expect(isPersonLabel("forklift")).toBe(false);
    expect(isPersonLabel("")).toBe(false);
  });

  it("builds a pose bbox only when there are enough keypoints", () => {
    expect(poseBoundingBox(pose(0.5, 0.5))).toBeTruthy();
    expect(poseBoundingBox({ keypoints: [{ x: 0.5, y: 0.5, score: 0.9 }] })).toBeUndefined();
  });

  it("reports when a pose covers a person box (and not when it doesn't)", () => {
    const personBox = { x: 0.4, y: 0.3, w: 0.2, h: 0.4 };
    expect(poseCoversBox(personBox, [pose(0.5, 0.5)])).toBe(true);
    expect(poseCoversBox(personBox, [pose(0.05, 0.05)])).toBe(false);
    expect(poseCoversBox(personBox, [])).toBe(false);
    expect(poseCoversBox(personBox, undefined)).toBe(false);
  });
});

describe("HSE tracker", () => {
  const obs = (id: string, category: HSECategory, bbox: BBox, confidence = 0.8) => ({
    id,
    label: category,
    normalizedLabel: category,
    category,
    confidence,
    bbox,
    source: "yolo26",
    timestampMs: 0,
  });

  it("keeps a stable ID for the same object across frames", () => {
    const tracker = new HSETracker();
    const f1 = tracker.update([obs("o1", "person", box(0.2, 0.2, 0.2, 0.4))], 0);
    const id = f1[0].id;
    const f2 = tracker.update([obs("o1", "person", box(0.21, 0.2, 0.2, 0.4))], 300);
    expect(f2[0].id).toBe(id);
    expect(f2[0].stable).toBe(true); // 2nd sighting → stable
    expect(f2[0].seenCount).toBe(2);
  });

  it("smooths bbox jitter (does not snap fully to the noisy frame)", () => {
    const tracker = new HSETracker({ smoothing: 0.5 });
    tracker.update([obs("o1", "vehicle", box(0.2, 0.2, 0.3, 0.3))], 0);
    // a small jitter that still overlaps enough to associate the same track
    const f2 = tracker.update([obs("o1", "vehicle", box(0.28, 0.2, 0.3, 0.3))], 100);
    expect(f2).toHaveLength(1); // matched, not a new track
    // smoothed toward 0.28 but not snapped: 0.2 + (0.28-0.2)*0.5 = 0.24
    expect(f2[0].bbox.x).toBeGreaterThan(0.2);
    expect(f2[0].bbox.x).toBeLessThan(0.28);
  });
});

describe("HSE risk rules", () => {
  const mkTrack = (category: HSECategory, bbox: BBox, over: Partial<HSETrack> = {}): HSETrack => ({
    id: `t-${category}-${Math.random().toString(36).slice(2, 7)}`,
    label: category,
    category,
    normalizedLabel: over.normalizedLabel ?? category,
    bbox,
    confidence: 0.8,
    firstSeenMs: 0,
    lastSeenMs: 1000,
    ageMs: 1000,
    seenCount: 4,
    missingCount: 0,
    stable: true,
    source: "yolo26",
    ...over,
  });

  it("raises a proximity alert for a person close to a vehicle", () => {
    const person = mkTrack("person", box(0.4, 0.4, 0.15, 0.3));
    const vehicle = mkTrack("vehicle", box(0.5, 0.4, 0.2, 0.3), { normalizedLabel: "forklift" });
    const alerts = runHseRules({ tracks: [person, vehicle], observations: [] });
    const prox = alerts.find((a) => a.category === "proximity");
    expect(prox).toBeTruthy();
    expect(prox!.shortMessage.toLowerCase()).toContain("forklift");
    expect(prox!.spokenMessage.toLowerCase()).toMatch(/step back|keep clear/);
    expect(prox!.relatedTrackIds).toContain(person.id);
  });

  it("raises a zone alert when a worker is inside a restricted zone", () => {
    const person = mkTrack("person", box(0.45, 0.45, 0.1, 0.2));
    const alerts = runHseRules({
      tracks: [person],
      observations: [],
      zones: [
        {
          id: "z1",
          kind: "restricted",
          label: "Danger zone",
          points: [
            { x: 0.3, y: 0.3 },
            { x: 0.7, y: 0.3 },
            { x: 0.7, y: 0.7 },
            { x: 0.3, y: 0.7 },
          ],
        },
      ],
    });
    expect(alerts.some((a) => a.category === "zone" && a.severity === "high")).toBe(true);
  });

  it("uses cautious wording for missing PPE (never a hard 'no PPE')", () => {
    const person = mkTrack("person", box(0.4, 0.4, 0.15, 0.3));
    const alerts = runHseRules({ tracks: [person], observations: [], ppeRequired: true });
    const ppe = alerts.find((a) => a.category === "ppe");
    expect(ppe).toBeTruthy();
    expect(ppe!.title).toBe("PPE not visible");
    expect(ppe!.shortMessage.toLowerCase()).not.toContain("no ppe");
  });

  it("does NOT alert on a single unstable low-confidence frame", () => {
    const person = mkTrack("person", box(0.4, 0.4, 0.15, 0.3), {
      stable: false,
      confidence: 0.2,
      ageMs: 100,
      seenCount: 1,
    });
    const vehicle = mkTrack("vehicle", box(0.45, 0.4, 0.2, 0.3), {
      stable: false,
      confidence: 0.2,
      ageMs: 100,
      seenCount: 1,
    });
    const alerts = runHseRules({ tracks: [person, vehicle], observations: [] });
    expect(alerts).toHaveLength(0);
  });
});

describe("HSE detection profiles + ROI metadata", () => {
  it("Far Scan requests higher img size and lower confidence", () => {
    const req = buildHseDetectRequest("far-scan");
    expect(req.profile).toBe("far-scan");
    expect(req.quality.imgSize).toBeGreaterThan(buildHseDetectRequest("fast").quality.imgSize);
    expect(req.quality.conf).toBeLessThan(buildHseDetectRequest("fast").quality.conf);
  });

  it("tap-to-focus sends a normalized ROI, dropping degenerate regions", () => {
    const req = buildHseDetectRequest("inspection", { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(req.roi).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(normalizeRoi({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 })).toBeUndefined();
    // clamps out-of-range
    expect(normalizeRoi({ x: 2, y: -1, w: 0.5, h: 0.5 })).toMatchObject({ x: 1, y: 0 });
  });

  it("keeps the legacy /detect body unchanged when no profile is set (contract intact)", () => {
    const base = { image_b64: "QUJD", conf: 0.2, img_size: 640, classes: null };
    expect(applyHseRequestToBody(base, null)).toEqual(base);
    const withReq = applyHseRequestToBody(base, buildHseDetectRequest("balanced"));
    expect(withReq.image_b64).toBe("QUJD"); // image still sent
    expect(withReq.mode).toBe("hse-monitoring");
    expect(withReq.profile).toBe("balanced");
  });

  it("HSE body mirrors image_b64 as frame_b64 and attaches scene_hint + camera_context", () => {
    const base = { image_b64: "FRAME", conf: 0.2, img_size: 640, classes: null };
    const out = applyHseRequestToBody(base, buildHseDetectRequest("balanced"));
    expect(out.frame_b64).toBe("FRAME");
    expect(out.scene_hint).toBe("live_hse_monitoring");
    expect(out.camera_context).toMatchObject({
      source: "browser-live-camera",
      mode: "hse",
    });
    expect(out.site_context).toBeTruthy();
    expect(out.reasoning_preferences).toMatchObject({ return_scene_risks: true });
  });

  it("buildHseDetectRequest tasks include the canonical reasoning set", () => {
    const req = buildHseDetectRequest("balanced");
    for (const t of ["detect", "track", "risk", "scene_reasoning"]) {
      expect(req.tasks).toContain(t);
    }
  });

  it("default Live HSE request omits raw pose (VITE_HSE_REQUEST_POSE unset)", () => {
    for (const p of ["balanced", "inspection"] as const) {
      const req = buildHseDetectRequest(p);
      expect(req.tasks).not.toContain("pose");
    }
  });

  it("re-includes pose when VITE_HSE_REQUEST_POSE=true", () => {
    const prev = (import.meta as unknown as { env: Record<string, unknown> }).env
      .VITE_HSE_REQUEST_POSE;
    (import.meta as unknown as { env: Record<string, unknown> }).env.VITE_HSE_REQUEST_POSE = "true";
    try {
      const req = buildHseDetectRequest("balanced");
      expect(req.tasks).toContain("pose");
    } finally {
      (import.meta as unknown as { env: Record<string, unknown> }).env.VITE_HSE_REQUEST_POSE = prev;
    }
  });
});

