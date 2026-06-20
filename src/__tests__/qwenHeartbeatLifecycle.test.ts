import { describe, expect, it } from "vitest";
import {
  classifyQwenLifecycle,
  QWEN_PENDING_HARD_MAX_MS,
  QWEN_PENDING_STATES,
  QWEN_TERMINAL_FAILURE_STATES,
  QWEN_TERMINAL_SUCCESS_STATES,
} from "@/features/hse-monitoring/hooks/useQwenHeartbeat";

describe("classifyQwenLifecycle", () => {
  it("classifies pending states", () => {
    for (const s of QWEN_PENDING_STATES) {
      expect(
        classifyQwenLifecycle({
          rawReasonerStatus: s,
          normalizedReasonerStatus: null,
          warnings: [],
        }),
      ).toBe("pending");
    }
  });

  it("classifies terminal-success states", () => {
    for (const s of QWEN_TERMINAL_SUCCESS_STATES) {
      expect(
        classifyQwenLifecycle({
          rawReasonerStatus: null,
          normalizedReasonerStatus: s,
          warnings: [],
        }),
      ).toBe("terminal-success");
    }
  });

  it("classifies terminal-failure states (including qwen_unavailable warning)", () => {
    for (const s of QWEN_TERMINAL_FAILURE_STATES) {
      expect(
        classifyQwenLifecycle({
          rawReasonerStatus: s,
          normalizedReasonerStatus: null,
          warnings: [],
        }),
      ).toBe("terminal-failure");
    }
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: "ready",
        normalizedReasonerStatus: "ready",
        warnings: ["qwen_unavailable"],
      }),
    ).toBe("terminal-failure");
  });

  it("falls back to terminal-success when status missing but sceneContext/risks/corrections present", () => {
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
        hasSceneContext: true,
      }),
    ).toBe("terminal-success");
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
        hasSceneRisks: true,
      }),
    ).toBe("terminal-success");
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
        hasSemanticCorrections: true,
      }),
    ).toBe("terminal-success");
  });

  it("returns unknown for empty/unclassifiable responses", () => {
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("unknown");
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: "weird-future-state",
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("unknown");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: "  QUEUED_LATEST  ",
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("pending");
    expect(
      classifyQwenLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: "READY",
        warnings: [],
      }),
    ).toBe("terminal-success");
  });

  it("exposes a sane hard-max constant", () => {
    expect(QWEN_PENDING_HARD_MAX_MS).toBeGreaterThan(10_000);
    expect(QWEN_PENDING_HARD_MAX_MS).toBeLessThanOrEqual(120_000);
  });
});
