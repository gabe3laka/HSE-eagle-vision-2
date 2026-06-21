import { describe, expect, it } from "vitest";
import {
  classifyReasonerLifecycle,
  REASONER_PENDING_HARD_MAX_MS,
  REASONER_PENDING_STATES,
  REASONER_TERMINAL_FAILURE_STATES,
  REASONER_TERMINAL_SUCCESS_STATES,
} from "@/features/hse-monitoring/hooks/useReasonerHeartbeat";

describe("classifyReasonerLifecycle", () => {
  it("classifies pending states", () => {
    for (const s of REASONER_PENDING_STATES) {
      expect(
        classifyReasonerLifecycle({
          rawReasonerStatus: s,
          normalizedReasonerStatus: null,
          warnings: [],
        }),
      ).toBe("pending");
    }
  });

  it("classifies terminal-success states", () => {
    for (const s of REASONER_TERMINAL_SUCCESS_STATES) {
      expect(
        classifyReasonerLifecycle({
          rawReasonerStatus: null,
          normalizedReasonerStatus: s,
          warnings: [],
        }),
      ).toBe("terminal-success");
    }
  });

  it("classifies terminal-failure states (including json_parse_error and warnings)", () => {
    for (const s of REASONER_TERMINAL_FAILURE_STATES) {
      expect(
        classifyReasonerLifecycle({
          rawReasonerStatus: s,
          normalizedReasonerStatus: null,
          warnings: [],
        }),
      ).toBe("terminal-failure");
    }
    // Bug fix: json_parse_error MUST be terminal failure.
    expect(REASONER_TERMINAL_FAILURE_STATES.has("json_parse_error")).toBe(true);
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: "json_parse_error",
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("terminal-failure");
    // New generic warning token.
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: "ready",
        normalizedReasonerStatus: "ready",
        warnings: ["reasoner_unavailable"],
      }),
    ).toBe("terminal-failure");
    // Legacy warning token still accepted.
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: "ready",
        normalizedReasonerStatus: "ready",
        warnings: ["qwen_unavailable"],
      }),
    ).toBe("terminal-failure");
  });

  it("falls back to terminal-success when status missing but sceneContext/risks/corrections present", () => {
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
        hasSceneContext: true,
      }),
    ).toBe("terminal-success");
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
        hasSceneRisks: true,
      }),
    ).toBe("terminal-success");
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
        hasSemanticCorrections: true,
      }),
    ).toBe("terminal-success");
  });

  it("returns unknown for empty/unclassifiable responses", () => {
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("unknown");
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: "weird-future-state",
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("unknown");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: "  QUEUED_LATEST  ",
        normalizedReasonerStatus: null,
        warnings: [],
      }),
    ).toBe("pending");
    expect(
      classifyReasonerLifecycle({
        rawReasonerStatus: null,
        normalizedReasonerStatus: "READY",
        warnings: [],
      }),
    ).toBe("terminal-success");
  });

  it("exposes a sane hard-max constant", () => {
    expect(REASONER_PENDING_HARD_MAX_MS).toBeGreaterThan(10_000);
    expect(REASONER_PENDING_HARD_MAX_MS).toBeLessThanOrEqual(120_000);
  });
});
