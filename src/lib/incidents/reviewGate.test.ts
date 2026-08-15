import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitByReviewStatus, bySeverityThenRecency } from "./reviewGate";
import type { ReviewableIncident } from "./reviewGate";

function inc(
  review_status: ReviewableIncident["review_status"],
  severity: ReviewableIncident["severity"],
  occurred_at = "2026-01-01T00:00:00Z",
): ReviewableIncident {
  return { review_status, severity, occurred_at };
}

describe("splitByReviewStatus — the human approval gate", () => {
  it("puts pending in the pending lane, approved in the incident log", () => {
    const { pending, approved } = splitByReviewStatus([
      inc("pending", "low"),
      inc("approved", "high"),
      inc("pending", "critical"),
    ]);
    expect(pending).toHaveLength(2);
    expect(approved).toHaveLength(1);
  });

  it("excludes dismissed rows from BOTH lanes (false-positive log only)", () => {
    const { pending, approved } = splitByReviewStatus([
      inc("dismissed", "critical"),
      inc("dismissed", "low"),
    ]);
    expect(pending).toHaveLength(0);
    expect(approved).toHaveLength(0);
  });

  it("sorts each lane critical-first, then most recent", () => {
    const older = inc("pending", "critical", "2026-01-01T00:00:00Z");
    const newer = inc("pending", "critical", "2026-02-01T00:00:00Z");
    const high = inc("pending", "high", "2026-03-01T00:00:00Z");
    const { pending } = splitByReviewStatus([high, older, newer]);
    expect(pending).toEqual([newer, older, high]);
  });

  it("comparator ranks critical above high above medium above low", () => {
    const order = ["low", "medium", "high", "critical"] as const;
    for (let i = 0; i < order.length - 1; i++) {
      expect(
        bySeverityThenRecency(inc("pending", order[i + 1]), inc("pending", order[i])),
      ).toBeLessThan(0);
    }
  });
});

/**
 * Source-level tripwires. The gate depends on WHO sets review_status:
 * auto-detection writers must NEVER set it (DB default 'pending' is the gate);
 * only the human review screen may write 'approved'. If either invariant
 * changes, these fail and force a human look.
 */
describe("review gate write-side invariants", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("detection-initiated writers never set review_status (→ lands pending)", () => {
    for (const rel of [
      "src/hooks/useDetectionSession.ts",
      "src/features/hse-monitoring/hooks/useHseMonitoring.ts",
      // The HSE payload is actually BUILT here (mapHseAlertToIncidentRow) —
      // guard the invariant where the row is constructed, not just inserted.
      "src/features/hse-monitoring/lib/hseIncidents.ts",
    ]) {
      expect(read(rel)).not.toMatch(/review_status/);
    }
  });

  it("the composer approval screen is the one writer of 'approved'", () => {
    expect(read("src/pages/ReportDraftReview.tsx")).toMatch(/review_status:\s*["']approved["']/);
  });

  it("schema default gates fresh incidents as pending", () => {
    expect(read("supabase/migrations/20260709184427_incident_review_status.sql")).toMatch(
      /DEFAULT\s+'pending'/i,
    );
  });
});
