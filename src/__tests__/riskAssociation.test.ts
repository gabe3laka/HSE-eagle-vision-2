import { describe, expect, it } from "vitest";
import type { BackendEntity } from "../lib/detection/types";
import type { SceneRisk, SemanticCorrection } from "../lib/detection/riskTypes";
import {
  applySemanticCorrectionsToEntities,
  associateRisksToEntities,
  type EntitySnapshot,
} from "../lib/detection/riskAssociation";

const box = (x: number, y: number, w = 0.2, h = 0.2) => ({ x, y, w, h });

function entity(overrides: Partial<BackendEntity> = {}): BackendEntity {
  return {
    label: "box",
    class_id: 1,
    confidence: 0.9,
    bbox: box(0.2, 0.2),
    ...overrides,
  };
}

function risk(overrides: SceneRisk = {}): SceneRisk {
  return {
    risk_id: "risk-1",
    hazard_type: "object_near_edge",
    risk_level: "YELLOW",
    risk_score: 0.6,
    ...overrides,
  };
}

function correction(overrides: SemanticCorrection = {}): SemanticCorrection {
  return {
    correction_id: "correction-1",
    action: "semantic_label",
    semantic_label: "hand_tool",
    ...overrides,
  };
}

describe("stable risk entity association", () => {
  it("applies an exact current track ID match", () => {
    const result = associateRisksToEntities(
      [entity({ id: "e1", track_id: "track-a" })],
      [risk({ risk_level: "RED", involved_track_ids: ["track-a"] })],
      [],
      [],
      [],
      1000,
    );

    expect(result.entities[0].risk_level).toBe("RED");
    expect(result.entities[0].risk_association).toBe("exact_id");
    expect(result.entities[0].linked_risk_id).toBe("risk-1");
    expect(result.associatedRisks[0].linked_entity_id).toBe("e1");
    expect(result.unmatchedRisks).toHaveLength(0);
  });

  it("tracks an ID switch through recent history", () => {
    const recent: EntitySnapshot[] = [
      {
        frameId: "1",
        timestampMs: 1000,
        entities: [entity({ id: "old", track_id: "track-old", bbox: box(0.2, 0.2) })],
      },
    ];

    const result = associateRisksToEntities(
      [entity({ id: "new", track_id: "track-new", bbox: box(0.21, 0.2) })],
      [risk({ involved_track_ids: ["track-old"] })],
      [],
      recent,
      [],
      1500,
    );

    expect(result.entities[0].risk_level).toBe("YELLOW");
    expect(result.entities[0].risk_association).toBe("historical_id");
    expect(result.associatedRisks[0].linked_entity_id).toBe("new");
  });

  it("carries a current risk through an anchor after another ID switch", () => {
    const first = associateRisksToEntities(
      [entity({ id: "e1", track_id: "track-a", bbox: box(0.3, 0.3) })],
      [risk({ risk_level: "ORANGE", involved_track_ids: ["track-a"] })],
      [],
      [],
      [],
      1000,
    );

    const second = associateRisksToEntities(
      [entity({ id: "e2", track_id: "track-b", bbox: box(0.31, 0.3) })],
      [risk({ risk_level: "ORANGE", involved_track_ids: [] })],
      [],
      [],
      first.anchors,
      1400,
    );

    expect(second.entities[0].risk_level).toBe("ORANGE");
    expect(second.entities[0].risk_association).toBe("anchor_carryover");
    expect(second.entities[0].risk_stale).toBe(false);
  });

  it("leaves low-confidence spatial risks unmatched", () => {
    const result = associateRisksToEntities(
      [entity({ id: "far", bbox: box(0.05, 0.05) })],
      [risk({ bbox: box(0.75, 0.75), involved_track_ids: [] })],
      [],
      [],
      [],
      1000,
    );

    expect(result.entities[0].risk_level).toBeUndefined();
    expect(result.unmatchedRisks).toHaveLength(1);
    expect(result.unmatchedRisks[0].risk_association).toBe("unmatched");
  });

  it("keeps the highest risk level on an entity", () => {
    const result = associateRisksToEntities(
      [entity({ track_id: "track-a" })],
      [
        risk({ risk_id: "red", risk_level: "RED", involved_track_ids: ["track-a"] }),
        risk({ risk_id: "yellow", risk_level: "YELLOW", involved_track_ids: ["track-a"] }),
      ],
      [],
      [],
      [],
      1000,
    );

    expect(result.entities[0].risk_level).toBe("RED");
    expect(result.entities[0].linked_risk_id).toBe("red");
  });

  it("expires stale ORANGE carryover after its TTL", () => {
    const first = associateRisksToEntities(
      [entity({ track_id: "track-a", bbox: box(0.2, 0.2) })],
      [risk({ risk_level: "ORANGE", involved_track_ids: ["track-a"] })],
      [],
      [],
      [],
      1000,
    );

    const expired = associateRisksToEntities(
      [entity({ track_id: "track-b", bbox: box(0.2, 0.2) })],
      [],
      [],
      [],
      first.anchors,
      4101,
    );

    expect(expired.entities[0].risk_level).toBeUndefined();
    expect(expired.anchors).toHaveLength(0);
  });

  it("marks YELLOW as resolving, then clears it within the 500 to 1000 ms window", () => {
    const first = associateRisksToEntities(
      [entity({ track_id: "track-a", bbox: box(0.2, 0.2) })],
      [risk({ risk_level: "YELLOW", involved_track_ids: ["track-a"] })],
      [],
      [],
      [],
      1000,
    );

    const resolving = associateRisksToEntities(
      [entity({ track_id: "track-b", bbox: box(0.2, 0.2) })],
      [],
      [],
      [],
      first.anchors,
      1500,
    );
    expect(resolving.entities[0].risk_resolving).toBe(true);
    expect(resolving.entities[0].risk_stale).toBe(true);

    const cleared = associateRisksToEntities(
      [entity({ track_id: "track-b", bbox: box(0.2, 0.2) })],
      [],
      [],
      [],
      resolving.anchors,
      2301,
    );
    expect(cleared.entities[0].risk_level).toBeUndefined();
    expect(cleared.anchors).toHaveLength(0);
  });

  it("keeps RED only as stale/dashed carryover until 5000 ms", () => {
    const first = associateRisksToEntities(
      [entity({ track_id: "track-a", bbox: box(0.2, 0.2) })],
      [risk({ risk_level: "RED", involved_track_ids: ["track-a"] })],
      [],
      [],
      [],
      1000,
    );

    const carried = associateRisksToEntities(
      [entity({ track_id: "track-b", bbox: box(0.2, 0.2) })],
      [],
      [],
      [],
      first.anchors,
      5500,
    );
    expect(carried.entities[0].risk_level).toBe("RED");
    expect(carried.entities[0].risk_stale).toBe(true);
    expect(carried.entities[0].risk_association).toBe("anchor_carryover");

    const expired = associateRisksToEntities(
      [entity({ track_id: "track-b", bbox: box(0.2, 0.2) })],
      [],
      [],
      [],
      carried.anchors,
      6001,
    );
    expect(expired.entities[0].risk_level).toBeUndefined();
  });

  it("carries a semantic correction through an ID switch", () => {
    const recent: EntitySnapshot[] = [
      {
        frameId: "1",
        timestampMs: 1000,
        entities: [entity({ track_id: "track-old", bbox: box(0.2, 0.2), label: "tool" })],
      },
    ];

    const result = applySemanticCorrectionsToEntities(
      [entity({ track_id: "track-new", bbox: box(0.21, 0.2), label: "tool" })],
      [correction({ track_id: "track-old", semantic_label: "hand_tool" })],
      recent,
      [],
      1500,
    );

    expect(result.entities[0].semantic_label).toBe("hand_tool");
    expect(result.entities[0].correction_status).toBe("semantic_label");
  });

  it("never suppresses protected hazards", () => {
    const result = applySemanticCorrectionsToEntities(
      [entity({ label: "person", track_id: "track-a" })],
      [
        correction({
          action: "suppress_from_hse_alerts",
          track_id: "track-a",
          semantic_label: "person",
        }),
      ],
      [],
      [],
      1000,
    );

    expect(result.entities[0].correction_status).toBe("protected_not_suppressed");
  });
});
