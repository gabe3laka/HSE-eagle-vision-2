import { describe, it, expect } from "vitest";
import {
  buildHseReasoningPayload,
  buildHseRulesReasoning,
  validateHseReasoning,
} from "../features/hse-monitoring/lib/hseRiskReasoning";
import { requestHseReasoning } from "../features/hse-monitoring/api/hseRiskReasoningClient";
import { HSEAlertManager, ALERT_COOLDOWN_MS } from "../features/hse-monitoring/lib/hseAlertManager";
import {
  mapHseAlertToIncidentRow,
  shouldPersistHseAlert,
} from "../features/hse-monitoring/lib/hseIncidents";
import {
  BrowserVibrationAdapter,
  NoopWearableAdapter,
  toWearableAlert,
  vibrate,
} from "../lib/wearable/wearableAlerts";
import type { HSEActiveAlert, HSEAlertCandidate } from "../lib/detection/hseTypes";

const candidate = (over: Partial<HSEAlertCandidate> = {}): HSEAlertCandidate => ({
  id: "c1",
  severity: "high",
  category: "proximity",
  title: "Worker near forklift",
  shortMessage: "Worker close to the forklift path",
  spokenMessage: "Step back from the forklift path.",
  bbox: { x: 0.3, y: 0.3, w: 0.2, h: 0.4 },
  relatedTrackIds: ["t-person-1", "t-vehicle-2"],
  confidence: 0.7,
  persistenceMs: 1500,
  recommendedAction: "Keep clear of the forklift.",
  wearablePattern: "urgent-pulse",
  ...over,
});

describe("HSE reasoning — validation + clamping", () => {
  it("validates a DeepSeek response and clamps all coordinates to 0..1", () => {
    const r = validateHseReasoning({
      status: "ok",
      source: "deepseek",
      sceneCaption: "Worker near a forklift",
      highestSeverity: "high",
      alerts: [
        {
          id: "a1",
          severity: "high",
          category: "proximity",
          title: "Worker near forklift",
          shortMessage: "Worker close to forklift path",
          spokenMessage: "Step back.",
          recommendedAction: "Keep clear.",
          confidence: 2,
          relatedTrackIds: ["t1"],
          overlay: { type: "box", x: 9, y: -3, w: 0.4, h: 0.3 },
          wearablePattern: "urgent-pulse",
        },
        { id: "bad", severity: "high", category: "proximity", title: "", shortMessage: "" }, // dropped
      ],
      supervisorSummary: "One proximity risk.",
      uncertainty: ["low light"],
    })!;
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].confidence).toBe(1); // clamped
    expect(r.alerts[0].overlay!.x).toBe(1);
    expect(r.alerts[0].overlay!.y).toBe(0);
    expect(r.highestSeverity).toBe("high");
  });

  it("coerces unknown enums and returns null for non-objects", () => {
    const r = validateHseReasoning({
      alerts: [
        {
          id: "x",
          severity: "apocalyptic",
          category: "frobnicate",
          shortMessage: "weird",
          wearablePattern: "explode",
          overlay: { type: "wormhole", x: 0.5, y: 0.5 },
        },
      ],
    })!;
    expect(r.alerts[0].severity).toBe("info");
    expect(r.alerts[0].category).toBe("unknown-review");
    expect(r.alerts[0].wearablePattern).toBe("none");
    expect(r.alerts[0].overlay).toBeUndefined(); // unknown overlay type dropped
    expect(validateHseReasoning(null)).toBeNull();
    expect(validateHseReasoning("nope")).toBeNull();
  });

  it("builds an image-free reasoning payload", () => {
    const p = buildHseReasoningPayload({
      tracks: [],
      observations: [],
      candidates: [candidate()],
      profile: "balanced",
    });
    expect(p.mode).toBe("hse-monitoring");
    expect(p.request.output).toBe("strict_json");
    expect(p.sceneSummary.candidateAlerts[0].category).toBe("proximity");
    expect(JSON.stringify(p)).not.toContain("image_b64");
    expect(JSON.stringify(p)).not.toContain("thumbnail");
  });

  it("builds a rules-shaped fallback directly from candidates", () => {
    const r = buildHseRulesReasoning([candidate()]);
    expect(r.status).toBe("fallback");
    expect(r.source).toBe("rules");
    expect(r.alerts).toHaveLength(1);
    expect(r.highestSeverity).toBe("high");
    expect(r.alerts[0].overlay?.type).toBe("box");
  });
});

describe("HSE reasoning client — Supabase only, never DeepSeek directly", () => {
  it("invokes the 'hse-risk-reasoning' Edge Function", async () => {
    const calls: string[] = [];
    const r = await requestHseReasoning(
      buildHseReasoningPayload({
        tracks: [],
        observations: [],
        candidates: [candidate()],
        profile: "balanced",
      }),
      [candidate()],
      async (name) => {
        calls.push(name);
        return {
          data: {
            status: "ok",
            source: "deepseek",
            sceneCaption: "ok",
            highestSeverity: "high",
            alerts: [
              {
                id: "a1",
                severity: "high",
                category: "proximity",
                title: "Worker near forklift",
                shortMessage: "Worker close to forklift",
                spokenMessage: "Step back.",
                recommendedAction: "Keep clear.",
                confidence: 0.7,
                relatedTrackIds: ["t1"],
                wearablePattern: "urgent-pulse",
              },
            ],
            supervisorSummary: "",
            uncertainty: [],
          },
          error: null,
        };
      },
    );
    expect(calls).toEqual(["hse-risk-reasoning"]);
    expect(r.source).toBe("deepseek");
  });

  it("falls back to local rules on a fallback marker, error, or invalid JSON", async () => {
    const fb = await requestHseReasoning(
      buildHseReasoningPayload({
        tracks: [],
        observations: [],
        candidates: [candidate()],
        profile: "fast",
      }),
      [candidate()],
      async () => ({ data: { status: "fallback", source: "rules" }, error: null }),
    );
    expect(fb.source).toBe("rules");
    expect(fb.alerts.length).toBeGreaterThan(0);

    const err = await requestHseReasoning(
      buildHseReasoningPayload({
        tracks: [],
        observations: [],
        candidates: [candidate()],
        profile: "fast",
      }),
      [candidate()],
      async () => ({ data: null, error: { message: "boom" } }),
    );
    expect(err.source).toBe("rules");

    const garbage = await requestHseReasoning(
      buildHseReasoningPayload({
        tracks: [],
        observations: [],
        candidates: [candidate()],
        profile: "fast",
      }),
      [candidate()],
      async () => ({ data: "not-json", error: null }),
    );
    expect(garbage.source).toBe("rules");
  });
});

describe("HSE alert manager — anti-spam + state + priority", () => {
  it("fires a persistent medium alert once, then suppresses within cooldown", () => {
    const m = new HSEAlertManager();
    const c = candidate({ severity: "medium" });
    const first = m.ingest([c], 0);
    expect(first.fired).toHaveLength(1);
    const within = m.ingest([c], 1000); // < 8s medium cooldown
    expect(within.fired).toHaveLength(0);
    const after = m.ingest([c], ALERT_COOLDOWN_MS.medium + 100);
    expect(after.fired).toHaveLength(1); // re-fires past cooldown
  });

  it("lists the highest severity first (HUD focus)", () => {
    const m = new HSEAlertManager();
    m.ingest(
      [
        candidate({ severity: "low", category: "trip-slip", relatedTrackIds: ["a"] }),
        candidate({ severity: "critical", category: "zone", relatedTrackIds: ["b"] }),
      ],
      0,
    );
    expect(m.list()[0].severity).toBe("critical");
  });

  it("acknowledge silences re-fires and changes state", () => {
    const m = new HSEAlertManager();
    const c = candidate({ severity: "high" });
    const { active } = m.ingest([c], 0);
    const key = active[0].key;
    m.acknowledge(key);
    expect(m.list().find((a) => a.key === key)?.state).toBe("acknowledged");
    const again = m.ingest([c], ALERT_COOLDOWN_MS.high + 100);
    expect(again.fired).toHaveLength(0); // ack'd → no re-fire
  });

  it("merges DeepSeek refinement onto a matching active alert", () => {
    const m = new HSEAlertManager();
    m.ingest([candidate()], 0);
    m.mergeReasoning([
      {
        id: "r1",
        severity: "high",
        category: "proximity",
        title: "Worker near forklift",
        shortMessage: "refined",
        spokenMessage: "Step back and keep clear.",
        recommendedAction: "Move away.",
        confidence: 0.8,
        relatedTrackIds: ["t-person-1"],
        wearablePattern: "urgent-pulse",
      },
    ]);
    const a = m.list()[0];
    expect(a.spokenMessage).toBe("Step back and keep clear.");
    expect(a.reasoningSource).toBe("deepseek");
  });
});

describe("Wearable alerts", () => {
  it("maps severity to the right haptic pattern", () => {
    expect(toWearableAlert({ id: "a", severity: "info", spokenMessage: "" }).hapticPattern).toEqual(
      [],
    );
    expect(toWearableAlert({ id: "a", severity: "low", spokenMessage: "" }).hapticPattern).toEqual([
      40,
    ]);
    expect(
      toWearableAlert({ id: "a", severity: "medium", spokenMessage: "" }).hapticPattern,
    ).toEqual([60, 80, 60]);
    expect(toWearableAlert({ id: "a", severity: "high", spokenMessage: "" }).hapticPattern).toEqual(
      [120, 80, 120],
    );
    expect(
      toWearableAlert({ id: "a", severity: "critical", spokenMessage: "" }).hapticPattern,
    ).toEqual([200, 80, 200, 80, 200]);
    expect(
      toWearableAlert({ id: "a", severity: "critical", spokenMessage: "" }).visualPattern,
    ).toBe("critical-flash");
  });

  it("vibration is optional and safe when the API is absent", () => {
    // node test env has no navigator.vibrate → returns false, never throws
    expect(vibrate([100])).toBe(false);
    expect(() => vibrate([])).not.toThrow();
  });

  it("adapters never throw", async () => {
    const a = toWearableAlert({ id: "a", severity: "high", spokenMessage: "Step back." });
    await expect(new BrowserVibrationAdapter().send(a)).resolves.toBeUndefined();
    await expect(new NoopWearableAdapter().send(a)).resolves.toBeUndefined();
  });
});

describe("HSE incident mapping (Phase 11)", () => {
  const active: HSEActiveAlert = {
    key: "proximity:t1,t2",
    id: "hse-a1",
    severity: "high",
    category: "proximity",
    title: "Worker near forklift",
    shortMessage: "Worker close to forklift path",
    spokenMessage: "Step back.",
    recommendedAction: "Keep clear.",
    confidence: 0.72,
    relatedTrackIds: ["t1", "t2"],
    wearablePattern: "urgent-pulse",
    reasoningSource: "rules",
    state: "active",
    firstFiredMs: 0,
    lastFiredMs: 0,
    lastSeenMs: 0,
  };

  it("maps an HSE alert to a best-effort incidents row", () => {
    const row = mapHseAlertToIncidentRow(active, "owner-1", "sess-1");
    expect(row.hazard_type).toBe("forklift_proximity"); // forklift in the title
    expect(row.severity).toBe("high");
    expect(row.owner_id).toBe("owner-1");
    expect(row.message).toContain("Worker close to forklift path");
    expect(row.message).toContain("Keep clear");
    expect(row.message).toContain("proximity");
  });

  it("only persists medium and above", () => {
    expect(shouldPersistHseAlert({ ...active, severity: "low" })).toBe(false);
    expect(shouldPersistHseAlert({ ...active, severity: "medium" })).toBe(true);
    expect(shouldPersistHseAlert(active)).toBe(true);
  });
});
