import { describe, it, expect } from "vitest";
import {
  derivePlanSafetyNotes,
  planAssistantSummary,
  planConnectionState,
} from "../features/build-mode/lib/planConsole";
import {
  buildPlanSceneBlueprint,
  applyAssemblyPlanToScene,
} from "../features/build-mode/lib/sceneBlueprint";
import type { ExtractCandidate, SelectedRegion } from "../features/build-mode/types";

const REGION: SelectedRegion = { x: 0, y: 0, w: 1, h: 1 };

function candidate(id: string, label: string, bbox: SelectedRegion): ExtractCandidate {
  return { id, label, bbox, source: "yolo26-entity", confidence: 0.8 };
}

const electronicScene = applyAssemblyPlanToScene(
  buildPlanSceneBlueprint({
    region: REGION,
    candidates: [
      candidate("c1", "PCB board", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
      candidate("c2", "USB cable", { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }),
    ],
  }),
  [
    {
      objectId: "obj-1",
      title: "Seat the board",
      instruction: "place it",
      safetyNote: "Power off before seating the board.",
    },
    { objectId: "obj-2", title: "Route the cable", instruction: "route it" },
  ],
);

const genericScene = buildPlanSceneBlueprint({
  region: REGION,
  candidates: [candidate("c1", "mug", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 })],
});

describe("planConsole — derivePlanSafetyNotes", () => {
  it("leads with the active step's safetyNote, then fills electronics defaults", () => {
    const notes = derivePlanSafetyNotes(electronicScene);
    expect(notes[0]).toBe("Power off before seating the board.");
    expect(notes.length).toBe(3);
    // electronics-aware default present (ESD / power)
    expect(notes.some((n) => /static|power|ESD|edges/i.test(n))).toBe(true);
  });

  it("uses a provided fallback safety warning when the step has none", () => {
    const notes = derivePlanSafetyNotes(genericScene, {
      fallbackSafety: "Mind the hot surface.",
    });
    expect(notes[0]).toBe("Mind the hot surface.");
  });

  it("de-duplicates and respects the max cap", () => {
    const notes = derivePlanSafetyNotes(electronicScene, {
      fallbackSafety: "Power off before seating the board.", // dup of the step note
      max: 2,
    });
    expect(notes.length).toBe(2);
    expect(new Set(notes).size).toBe(notes.length); // no dups
  });

  it("falls back to generic defaults for a non-electronics scene", () => {
    const notes = derivePlanSafetyNotes(genericScene);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => /static|ESD|PCB/i.test(n))).toBe(false);
  });

  it("returns generic defaults (no crash) for a null scene", () => {
    const notes = derivePlanSafetyNotes(null);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("planConsole — planAssistantSummary", () => {
  it("says Thinking… while generating or status thinking", () => {
    expect(planAssistantSummary({ generating: true })).toBe("Thinking…");
    expect(planAssistantSummary({ reasoningStatus: "thinking" })).toBe("Thinking…");
  });

  it("prompts to capture/set a goal when there is no plan yet", () => {
    expect(planAssistantSummary({ hasPlan: false })).toMatch(/capture/i);
  });

  it("differs between an AI (ok) plan and a fallback (rules) plan", () => {
    const ok = planAssistantSummary({ reasoningStatus: "ok", hasPlan: true });
    const fallback = planAssistantSummary({ reasoningStatus: "fallback", hasPlan: true });
    expect(ok).not.toBe(fallback);
    expect(ok).toMatch(/safest|analyzed/i);
    expect(fallback).toMatch(/basic/i);
  });
});

describe("planConsole — planConnectionState", () => {
  it("is thinking while generating", () => {
    expect(planConnectionState({ generating: true })).toBe("thinking");
    expect(planConnectionState({ reasoningStatus: "thinking" })).toBe("thinking");
  });

  it("is connected once reasoning returns ok or fallback", () => {
    expect(planConnectionState({ reasoningStatus: "ok" })).toBe("connected");
    expect(planConnectionState({ reasoningStatus: "fallback" })).toBe("connected");
  });

  it("is idle otherwise", () => {
    expect(planConnectionState({})).toBe("idle");
    expect(planConnectionState({ reasoningStatus: "idle" })).toBe("idle");
  });
});
