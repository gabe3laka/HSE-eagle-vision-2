import type {
  BlueprintAnchor,
  BlueprintFrame,
  BlueprintNote,
  BlueprintWorkflowMode,
  BuildUserIntent,
  PlanStep,
  SelectedRegion,
} from "../types";

/**
 * Pure blueprint helpers: the local mock generator (used when the backend
 * /build/* routes don't exist yet) and the replay interpolation math. No DOM,
 * no network — unit-testable in the node test env.
 *
 * All geometry is normalized 0..1 LOCAL to the selected region box.
 */

const TAU = Math.PI * 2;

/** Deterministic pseudo-random in [0,1) from a seed — keeps mocks stable per frame. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32 — tiny, deterministic, good enough for jittered mock geometry
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Build the ghost outline for a mock frame: an inset rounded-rectangle ring of
 * 12 points with a subtle per-frame "breathing" jitter so replay visibly moves.
 */
export function mockOutline(frameIndex: number): Array<{ x: number; y: number }> {
  const rand = seeded(97 + frameIndex * 13);
  const inset = 0.08;
  const cx = 0.5;
  const cy = 0.5;
  const rx = 0.5 - inset;
  const ry = 0.5 - inset;
  const pts: Array<{ x: number; y: number }> = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    // squarish superellipse so it reads as a panel/part outline, not a circle
    const sx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.6);
    const sy = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.6);
    const jitter = (rand() - 0.5) * 0.02;
    pts.push({
      x: clamp01(cx + sx * (rx + jitter)),
      y: clamp01(cy + sy * (ry + jitter)),
    });
  }
  return pts;
}

/** 4–8 sparse anchors: 4 corners plus up to 4 jittered interior points. */
export function mockAnchors(frameIndex: number): BlueprintAnchor[] {
  const rand = seeded(31 + frameIndex * 7);
  const corner = 0.12;
  const anchors: BlueprintAnchor[] = [
    { id: "a-tl", x: corner, y: corner, label: "A1" },
    { id: "a-tr", x: 1 - corner, y: corner, label: "A2" },
    { id: "a-br", x: 1 - corner, y: 1 - corner, label: "A3" },
    { id: "a-bl", x: corner, y: 1 - corner, label: "A4" },
  ];
  const extras = 2 + Math.floor(rand() * 3); // 2..4 extras -> 6..8 total
  for (let i = 0; i < extras; i++) {
    anchors.push({
      id: `a-x${i}`,
      x: clamp01(0.25 + rand() * 0.5),
      y: clamp01(0.25 + rand() * 0.5),
      confidence: 0.5 + rand() * 0.5,
    });
  }
  return anchors;
}

/** Step marker roughly every ~2s of capture, walking across the region. */
const MOCK_STEP_EVERY = 6; // every 6th keyframe (~2s at 3 FPS)

/** Advance the guided Plan step every ~3s of capture (at 3 FPS keyframes). */
const PLAN_STEP_EVERY = 9;

const ACTIVITIES = ["positioning", "aligning", "fastening", "adjusting", "inspecting"];

// Rule-based notes use CAUTIOUS language — the AI documents what APPEARS to
// happen and suggests POSSIBLE next steps; it never overclaims. This matters
// for safety and trust.
const BUILD_NOTE_TEXTS = [
  "The user appears to be working near this point",
  "Possible inspection point",
  "Check this area before finishing",
];

const BUILD_NEXT_ACTIONS = [
  "Possible next action: check the highlighted area",
  "Possible next action: keep the part aligned with the blueprint ghost",
  "Possible next action: check this area before finishing",
];

const BUILD_SAFETY = "Safety reminder: verify the area is safe before continuing.";
const PLAN_SAFETY = "Before continuing, verify the item is safe to handle.";

/** Fixed guided-procedure template the Plan mock walks through. */
const PLAN_TEMPLATE: Array<Omit<PlanStep, "id" | "status">> = [
  {
    title: "Position the part",
    instruction: "Align the part with the anchor corners",
    x: 0.26,
    y: 0.3,
    qualityCheck: "Edges flush with A1–A2",
  },
  {
    title: "Fasten left side",
    instruction: "Drive the two left fasteners snug",
    x: 0.2,
    y: 0.62,
    safetyNote: "Keep fingers clear of the driver",
  },
  {
    title: "Fasten right side",
    instruction: "Drive the two right fasteners snug",
    x: 0.78,
    y: 0.62,
    qualityCheck: "No gap along the right edge",
  },
  {
    title: "Verify alignment",
    instruction: "Check the part matches the blueprint ghost",
    x: 0.5,
    y: 0.45,
    qualityCheck: "Outline within the cyan guide",
  },
];

/**
 * Deterministic guided steps for one Plan-mode keyframe: the active step
 * advances every PLAN_STEP_EVERY frames and clamps on the final step.
 */
export function mockPlanSteps(frameIndex: number): { steps: PlanStep[]; currentIndex: number } {
  const currentIndex = Math.min(
    PLAN_TEMPLATE.length - 1,
    Math.floor(Math.max(0, frameIndex) / PLAN_STEP_EVERY),
  );
  const steps = PLAN_TEMPLATE.map((s, i) => ({
    ...s,
    id: `plan-${i + 1}`,
    status: (i < currentIndex ? "completed" : i === currentIndex ? "active" : "pending") as
      | "completed"
      | "active"
      | "pending",
  }));
  return { steps, currentIndex };
}

/** 2–3 deterministic AI notes per keyframe (instruction/observation + occasional safety). */
export function mockAiNotes(
  frameIndex: number,
  workflowMode: BlueprintWorkflowMode,
): BlueprintNote[] {
  const rand = seeded(53 + frameIndex * 17);
  const notes: BlueprintNote[] = [
    {
      id: `note-i-${frameIndex}`,
      type: workflowMode === "plan" ? "next-step" : "instruction",
      text:
        workflowMode === "plan"
          ? "Possible next step: check the highlighted area"
          : BUILD_NOTE_TEXTS[Math.floor(frameIndex / MOCK_STEP_EVERY) % BUILD_NOTE_TEXTS.length],
      x: clamp01(0.2 + rand() * 0.3),
      y: clamp01(0.12 + rand() * 0.12),
      timestampMs: frameIndex * 333,
      confidence: 0.6 + rand() * 0.4,
    },
    {
      id: `note-o-${frameIndex}`,
      type: "observation",
      text: `The user appears to be ${ACTIVITIES[frameIndex % ACTIVITIES.length]}`,
      x: clamp01(0.55 + rand() * 0.3),
      y: clamp01(0.72 + rand() * 0.18),
      timestampMs: frameIndex * 333,
      confidence: 0.4 + rand() * 0.3,
    },
  ];
  if (frameIndex % 10 === 5) {
    notes.push({
      id: `note-s-${frameIndex}`,
      type: "safety",
      text: workflowMode === "plan" ? PLAN_SAFETY : BUILD_SAFETY,
      x: 0.5,
      y: 0.5,
      timestampMs: frameIndex * 333,
    });
  }
  return notes;
}

/**
 * Local mock of what the backend's blueprint extraction would return for one
 * selected-crop keyframe. Geometry is region-local (0..1). Also fills the AI
 * work-instruction fields (notes / next action / guided plan steps) so Build
 * and Plan are fully usable before the Worker returns them; the mock never
 * produces a mask (maskSource "none" → the overlay's crop fallback).
 *
 * Language is deliberately cautious ("appears to", "may be", "possible next
 * step") until the user CONFIRMS their goal — then guidance names it.
 */
export function mockBlueprintFrame(
  sessionId: string,
  frameIndex: number,
  timestampMs: number,
  _region: SelectedRegion,
  workflowMode: BlueprintWorkflowMode = "build",
  userIntent?: BuildUserIntent,
): BlueprintFrame {
  const stepCount = Math.floor(frameIndex / MOCK_STEP_EVERY) + 1;
  const stepMarkers = Array.from({ length: stepCount }, (_, i) => {
    const rand = seeded(7 + i * 101);
    return {
      id: `step-${i + 1}`,
      label: `${i + 1}`,
      x: clamp01(0.18 + rand() * 0.64),
      y: clamp01(0.18 + rand() * 0.64),
      timestampMs: i * MOCK_STEP_EVERY * 333,
    };
  });
  const isPlan = workflowMode === "plan";
  const plan = isPlan ? mockPlanSteps(frameIndex) : null;
  const active = plan ? plan.steps[plan.currentIndex] : null;
  const aiNotes = mockAiNotes(frameIndex, workflowMode);
  if (isPlan && userIntent) {
    aiNotes.unshift({
      id: `note-g-${frameIndex}`,
      type: "intent",
      text: `Confirmed goal: ${userIntent}`,
      x: 0.55,
      y: 0.08,
      timestampMs: frameIndex * 333,
      confidence: 1,
    });
  }
  const safety = active?.safetyNote ?? aiNotes.find((n) => n.type === "safety")?.text;
  return {
    sessionId,
    frameId: `f-${frameIndex}`,
    timestampMs,
    outline: mockOutline(frameIndex),
    anchors: mockAnchors(frameIndex),
    stepMarkers,
    instruction: `Step ${stepCount} — follow the highlighted anchors`,
    workflowMode,
    maskSource: "none",
    aiNotes,
    activityLabel: ACTIVITIES[frameIndex % ACTIVITIES.length],
    detectedIntent: active
      ? userIntent
        ? `Confirmed goal: ${userIntent} — ${active.title.toLowerCase()}`
        : `The user may be trying to: ${active.title.toLowerCase()}`
      : "The user appears to be documenting work on this item",
    nextAction: active
      ? `Possible next step: ${active.instruction}`
      : BUILD_NEXT_ACTIONS[Math.floor(frameIndex / MOCK_STEP_EVERY) % BUILD_NEXT_ACTIONS.length],
    safetyWarning: safety,
    qualityCheck: active?.qualityCheck,
    // Confidence honesty: hedged guidance stays low-importance-aware; a safety
    // note always escalates.
    importance: safety ? "high" : isPlan && !userIntent ? "low" : "medium",
    ...(plan ? { planSteps: plan.steps, currentPlanStepIndex: plan.currentIndex } : {}),
  };
}

/** Linear interpolation between two frames' geometry (same-index mapping). */
export function interpolateFrames(a: BlueprintFrame, b: BlueprintFrame, t: number): BlueprintFrame {
  const k = Math.max(0, Math.min(1, t));
  const lerp = (p: number, q: number) => p + (q - p) * k;
  const outline =
    a.outline.length === b.outline.length
      ? a.outline.map((p, i) => ({ x: lerp(p.x, b.outline[i].x), y: lerp(p.y, b.outline[i].y) }))
      : (k < 0.5 ? a : b).outline;
  const byId = new Map(b.anchors.map((an) => [an.id, an]));
  const anchors = a.anchors.map((an) => {
    const bn = byId.get(an.id);
    return bn ? { ...an, x: lerp(an.x, bn.x), y: lerp(an.y, bn.y) } : an;
  });
  const base = k < 0.5 ? a : b;
  return { ...base, outline, anchors };
}

/**
 * Resolve the (possibly interpolated) frame at `tMs` on the replay timeline.
 * Outside the recorded range it clamps to the first/last keyframe.
 */
export function blueprintFrameAt(frames: BlueprintFrame[], tMs: number): BlueprintFrame | null {
  if (frames.length === 0) return null;
  if (tMs <= frames[0].timestampMs) return frames[0];
  const last = frames[frames.length - 1];
  if (tMs >= last.timestampMs) return last;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (tMs >= a.timestampMs && tMs <= b.timestampMs) {
      const span = b.timestampMs - a.timestampMs;
      const t = span > 0 ? (tMs - a.timestampMs) / span : 0;
      return interpolateFrames(a, b, t);
    }
  }
  return last;
}

/** Total replay duration in ms (timestamp of the last keyframe). */
export function replayDurationMs(frames: BlueprintFrame[]): number {
  return frames.length ? frames[frames.length - 1].timestampMs : 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
