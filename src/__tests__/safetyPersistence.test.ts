import { describe, it, expect } from "vitest";
import { initialOf, isOverdue, residualOf } from "../features/safety/lib/safetyTypes";
import { toCsv } from "../features/safety/lib/safetyReports";

describe("safety actions — overdue detection", () => {
  const now = new Date("2026-06-13T00:00:00Z").getTime();
  const day = 24 * 60 * 60 * 1000;

  it("flags past-due, not-closed actions", () => {
    expect(isOverdue({ due_date: new Date(now - day).toISOString(), status: "open" }, now)).toBe(
      true,
    );
  });
  it("never flags closed or undated actions", () => {
    expect(isOverdue({ due_date: new Date(now - day).toISOString(), status: "closed" }, now)).toBe(
      false,
    );
    expect(isOverdue({ due_date: null, status: "open" }, now)).toBe(false);
  });
  it("does not flag future due dates", () => {
    expect(
      isOverdue({ due_date: new Date(now + day).toISOString(), status: "in_progress" }, now),
    ).toBe(false);
  });
});

describe("safety risk scoring helpers", () => {
  it("computes initial score/level", () => {
    expect(initialOf({ likelihood: 3, severity: 4 })).toEqual({ score: 12, level: "high" });
  });
  it("returns null residual until both axes are set, then scores it", () => {
    expect(residualOf({ residual_likelihood: null, residual_severity: 3 })).toBeNull();
    expect(residualOf({ residual_likelihood: 2, residual_severity: 2 })).toEqual({
      score: 4,
      level: "low",
    });
  });
});

describe("CSV export builder", () => {
  it("joins headers + rows", () => {
    expect(toCsv(["a", "b"], [[1, 2]])).toBe("a,b\n1,2");
  });
  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv(["x"], [["has, comma"], ['has "quote"'], ["line\nbreak"]]);
    expect(csv).toBe('x\n"has, comma"\n"has ""quote"""\n"line\nbreak"');
  });
  it("renders null/undefined as empty", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\n,");
  });
});
