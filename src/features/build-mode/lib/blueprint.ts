import type {
  BlueprintAnchor,
  BlueprintFrame,
  BlueprintNote,
  BlueprintPlanOverlay,
  BlueprintWorkflowMode,
  BuildPhase,
  BuildUserIntent,
  PlanStage,
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

/**
 * Tasks that warrant a safety-first response: electrical, machinery, chemicals,
 * height, confined spaces, pressure, hot work. Detected from the free-text
 * intent (the worker also classifies). When dangerous, guidance becomes
 * inspection/checklist style — never risky direct operational instructions.
 */
const DANGER_PATTERN =
  /electric|wir(e|ing)|voltage|\bpower\b|mains|machin|motor|gear|chemical|acid|solvent|\bgas\b|height|ladder|roof|scaffold|confined|pressur|hydraulic|pneumatic|weld|grind|saw|blade|\bhot\b|steam|boiler/i;

export function isDangerousTask(intent?: BuildUserIntent | null): boolean {
  if (!intent) return false;
  return DANGER_PATTERN.test(intent.text ?? "");
}

/** Inspection/checklist-style steps for a dangerous task — no risky actions. */
const DANGER_STEPS: Array<Omit<PlanStep, "id" | "status">> = [
  {
    title: "Confirm it is safe",
    instruction: "Confirm power is isolated / the area is made safe",
    x: 0.5,
    y: 0.2,
    safetyNote: "Do not touch until isolation is verified",
  },
  {
    title: "Confirm qualification",
    instruction: "Confirm a qualified person is involved",
    x: 0.3,
    y: 0.5,
    safetyNote: "Stop if you are not qualified for this task",
  },
  {
    title: "Identify the component",
    instruction: "Identify the component and confirm the task goal",
    x: 0.7,
    y: 0.55,
    qualityCheck: "Component and task confirmed before any action",
  },
  {
    title: "Inspect before action",
    instruction: "Inspect for damage or hazards before proceeding",
    x: 0.5,
    y: 0.78,
    qualityCheck: "No visible damage or hazard",
  },
];

type StepTemplate = Omit<PlanStep, "id" | "status">;

/** Per-task-type guided templates (safe tasks). Keeps Plan guidance concrete. */
const TASK_STEPS: Partial<Record<NonNullable<BuildUserIntent["taskType"]>, StepTemplate[]>> = {
  identify: [
    {
      title: "Frame the item",
      instruction: "Frame the whole item in the blueprint",
      x: 0.5,
      y: 0.25,
    },
    {
      title: "Find markings",
      instruction: "Note any labels, model numbers or markings",
      x: 0.3,
      y: 0.6,
      qualityCheck: "Markings captured",
    },
    {
      title: "Confirm identity",
      instruction: "Compare shape and features to confirm what it is",
      x: 0.7,
      y: 0.6,
    },
  ],
  inspect: [
    {
      title: "Check highlighted area",
      instruction: "Check the highlighted area for wear or damage",
      x: 0.32,
      y: 0.3,
      qualityCheck: "No wear or damage",
    },
    {
      title: "Work the edges",
      instruction: "Work around the outline, edge by edge",
      x: 0.7,
      y: 0.55,
    },
    {
      title: "Confirm condition",
      instruction: "Confirm the item matches the expected condition",
      x: 0.5,
      y: 0.8,
      qualityCheck: "Condition matches expectation",
    },
  ],
  clean: [
    {
      title: "Find the area",
      instruction: "Identify the area that needs cleaning",
      x: 0.3,
      y: 0.3,
    },
    {
      title: "Clean top-down",
      instruction: "Work from the top down across the surface",
      x: 0.6,
      y: 0.5,
    },
    {
      title: "Verify clean",
      instruction: "Verify the surface is clean and dry",
      x: 0.5,
      y: 0.8,
      qualityCheck: "Surface clean and dry",
    },
  ],
  build: [
    {
      title: "Position part",
      instruction: "Position the first part on the anchor points",
      x: 0.26,
      y: 0.3,
    },
    {
      title: "Align edges",
      instruction: "Align mating edges with the blueprint ghost",
      x: 0.74,
      y: 0.45,
    },
    {
      title: "Secure & verify",
      instruction: "Secure the part, then verify alignment",
      x: 0.5,
      y: 0.78,
      qualityCheck: "Part secured and aligned",
    },
  ],
};

const GENERIC_STEPS: StepTemplate[] = [
  { title: "Frame the item", instruction: "Frame the item inside the blueprint", x: 0.5, y: 0.28 },
  { title: "Follow the guide", instruction: "Follow the highlighted area", x: 0.4, y: 0.6 },
  {
    title: "Confirm result",
    instruction: "Confirm the result matches the guide",
    x: 0.6,
    y: 0.78,
    qualityCheck: "Result matches the guide",
  },
];

/** The guided step template for a confirmed intent (safety-first if dangerous). */
export function stepTemplateForIntent(intent?: BuildUserIntent | null): StepTemplate[] {
  if (isDangerousTask(intent)) return DANGER_STEPS;
  const t = intent?.taskType;
  // "repair" / "troubleshoot" / "install-remove" without danger keywords fall
  // back to the generic safe flow; named safe tasks get their template.
  return (t && TASK_STEPS[t]) || GENERIC_STEPS;
}

/**
 * Deterministic guided steps for one Plan-mode keyframe: the template depends
 * on the confirmed intent (safety-first when dangerous); the active step
 * advances every PLAN_STEP_EVERY frames and clamps on the final step.
 */
export function mockPlanSteps(
  frameIndex: number,
  intent?: BuildUserIntent | null,
): { steps: PlanStep[]; currentIndex: number } {
  const template = stepTemplateForIntent(intent);
  const currentIndex = Math.min(
    template.length - 1,
    Math.floor(Math.max(0, frameIndex) / PLAN_STEP_EVERY),
  );
  const steps = template.map((s, i) => ({
    ...s,
    id: `plan-${i + 1}`,
    status: (i < currentIndex ? "completed" : i === currentIndex ? "active" : "pending") as
      | "completed"
      | "active"
      | "pending",
  }));
  return { steps, currentIndex };
}

/**
 * Visual guidance drawn ON the blueprint for the active step: an arrow from the
 * previous step toward the active one (movement), a target ghost outline where
 * the work should happen, a highlight for inspect-type tasks, and a warning
 * zone for dangerous tasks. Region-local 0..1.
 */
export function mockPlanOverlays(
  steps: PlanStep[],
  currentIndex: number,
  intent?: BuildUserIntent | null,
): BlueprintPlanOverlay[] {
  const active = steps[currentIndex];
  if (!active || active.x == null || active.y == null) return [];
  const overlays: BlueprintPlanOverlay[] = [];
  const prev = currentIndex > 0 ? steps[currentIndex - 1] : null;
  if (prev && prev.x != null && prev.y != null) {
    overlays.push({
      id: `ov-arrow-${currentIndex}`,
      type: "arrow",
      from: { x: prev.x, y: prev.y },
      to: { x: active.x, y: active.y },
      stepId: active.id,
      label: "next",
    });
  }
  const dangerous = isDangerousTask(intent);
  if (dangerous) {
    overlays.push({
      id: `ov-warn-${currentIndex}`,
      type: "warning-zone",
      x: active.x,
      y: active.y,
      label: "Safety check first",
      stepId: active.id,
    });
  } else if (intent?.taskType === "inspect" || intent?.taskType === "identify") {
    overlays.push({
      id: `ov-hi-${currentIndex}`,
      type: "highlight",
      x: active.x,
      y: active.y,
      label: active.title,
      stepId: active.id,
    });
  } else {
    overlays.push({
      id: `ov-target-${currentIndex}`,
      type: "target",
      x: active.x,
      y: active.y,
      label: active.title,
      stepId: active.id,
    });
  }
  return overlays;
}

/**
 * Derive the Plan-mode sub-state from the shared phase + intent. Pure so the
 * panel/overlay gating ("no generic guidance before intent is confirmed") is
 * unit-testable.
 */
export function derivePlanStage(opts: {
  phase: BuildPhase;
  hasBaseFrame: boolean;
  intentConfirmed: boolean;
  generating: boolean;
}): PlanStage {
  const { phase, hasBaseFrame, intentConfirmed, generating } = opts;
  if (phase === "review") return "plan_review";
  if (
    !hasBaseFrame ||
    phase === "idle" ||
    phase === "selecting" ||
    phase === "selected" ||
    phase === "extracting"
  ) {
    return "plan_selecting_object";
  }
  if (!intentConfirmed) return "plan_waiting_for_intent";
  if (generating) return "plan_generating_steps";
  return "plan_guiding";
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
  userIntent?: BuildUserIntent | null,
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
  const base: BlueprintFrame = {
    sessionId,
    frameId: `f-${frameIndex}`,
    timestampMs,
    outline: mockOutline(frameIndex),
    anchors: mockAnchors(frameIndex),
    stepMarkers,
    workflowMode,
    maskSource: "none",
  };

  // ── PLAN: only guide once the user CONFIRMS a goal. Before that the frame is
  //    intentionally bare — no generic steps/overlays/notes. ──
  if (workflowMode === "plan") {
    if (!userIntent?.confirmed) {
      return {
        ...base,
        aiNotes: [],
        detectedIntent: "Waiting for the user to choose a goal",
        importance: "low",
      };
    }
    const { steps, currentIndex } = mockPlanSteps(frameIndex, userIntent);
    const active = steps[currentIndex];
    const dangerous = isDangerousTask(userIntent);
    const goal = intentLabel(userIntent);
    const safety =
      active?.safetyNote ??
      (dangerous ? "Safety reminder: confirm the task is safe before any action." : undefined);
    const notes: BlueprintNote[] = [];
    if (active?.x != null && active.y != null) {
      notes.push({
        id: `note-next-${frameIndex}`,
        type: "next-step",
        text: `Possible next step: ${active.instruction}`,
        x: active.x,
        y: active.y,
        timestampMs,
        confidence: 0.7,
      });
    }
    if (safety) {
      notes.push({
        id: `note-safety-${frameIndex}`,
        type: "safety",
        text: safety,
        x: 0.5,
        y: 0.12,
        timestampMs,
      });
    }
    if (active?.qualityCheck) {
      notes.push({
        id: `note-q-${frameIndex}`,
        type: "quality",
        text: active.qualityCheck,
        x: clamp01((active.x ?? 0.5) + 0.12),
        y: clamp01((active.y ?? 0.5) + 0.2),
        timestampMs,
      });
    }
    return {
      ...base,
      aiNotes: notes,
      planSteps: steps,
      currentPlanStepIndex: currentIndex,
      planOverlays: mockPlanOverlays(steps, currentIndex, userIntent),
      activityLabel: dangerous ? "safety check" : goal,
      detectedIntent: `Confirmed goal: ${goal}${active ? ` — ${active.title.toLowerCase()}` : ""}`,
      // Dangerous tasks lead with safety/inspection guidance, never a risky
      // direct operational instruction.
      nextAction: dangerous
        ? "Possible next step: confirm it is safe, then identify the component"
        : active
          ? `Possible next step: ${active.instruction}`
          : undefined,
      safetyWarning: safety,
      qualityCheck: active?.qualityCheck,
      importance: safety ? "high" : "medium",
    };
  }

  // ── BUILD: document what appears to happen (cautious language). ──
  const aiNotes = mockAiNotes(frameIndex, "build");
  const safety = aiNotes.find((n) => n.type === "safety")?.text;
  return {
    ...base,
    instruction: `Step ${stepCount} — follow the highlighted anchors`,
    aiNotes,
    activityLabel: ACTIVITIES[frameIndex % ACTIVITIES.length],
    detectedIntent: "The user appears to be documenting work on this item",
    nextAction:
      BUILD_NEXT_ACTIONS[Math.floor(frameIndex / MOCK_STEP_EVERY) % BUILD_NEXT_ACTIONS.length],
    safetyWarning: safety,
    importance: safety ? "high" : "medium",
  };
}

/** Short human label for a confirmed intent — task type or the free text. */
export function intentLabel(intent?: BuildUserIntent | null): string {
  if (!intent) return "task";
  if (intent.taskType && intent.taskType !== "custom") return intent.taskType.replace("-", " / ");
  return intent.text?.trim() || "custom task";
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
