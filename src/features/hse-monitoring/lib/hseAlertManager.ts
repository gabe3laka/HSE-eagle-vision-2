import type {
  HSEActiveAlert,
  HSEAlertCandidate,
  HSEReasonedAlert,
  HSESeverity,
} from "@/lib/detection/hseTypes";

/**
 * Phase 8 — alert priority + anti-spam. Dedupes candidate hazards into stable
 * keyed alerts, applies per-severity cooldowns (so glasses/wristband never
 * spam), tracks alert state (new → active → acknowledged → resolved), and
 * surfaces which alerts NEWLY fired this tick (to drive haptics + persistence).
 */

const SEV_RANK: Record<HSESeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Re-fire cooldown by severity (ms) — critical may repeat quickly. */
export const ALERT_COOLDOWN_MS: Record<HSESeverity, number> = {
  info: 15000,
  low: 12000,
  medium: 8000,
  high: 5000,
  critical: 2000,
};

/** A hazard is considered resolved if unseen for this long. */
const RESOLVE_TTL_MS = 2500;
/** Drop a resolved alert from the active list after this long. */
const DROP_AFTER_MS = 6000;

let alertSeq = 0;

function keyFor(c: HSEAlertCandidate): string {
  const tracks = [...c.relatedTrackIds].sort().join(",");
  return tracks ? `${c.category}:${tracks}` : `${c.category}:${c.title}`;
}

export interface IngestResult {
  active: HSEActiveAlert[];
  /** Alerts that crossed their cooldown this tick (trigger haptics/persist). */
  fired: HSEActiveAlert[];
}

export class HSEAlertManager {
  private alerts = new Map<string, HSEActiveAlert>();

  reset() {
    this.alerts.clear();
  }

  /** Acknowledge an alert by key — silences re-fires until severity escalates. */
  acknowledge(key: string): void {
    const a = this.alerts.get(key);
    if (a && a.state !== "resolved") a.state = "acknowledged";
  }

  /** Snapshot of non-dropped alerts, highest severity first. */
  list(): HSEActiveAlert[] {
    return [...this.alerts.values()].sort(
      (a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.lastFiredMs - a.lastFiredMs,
    );
  }

  /**
   * Ingest this tick's candidates. New keys fire immediately; existing keys fire
   * again only past their cooldown (or when severity escalates). Acknowledged
   * alerts stay quiet unless they escalate. Unseen alerts resolve, then drop.
   */
  ingest(candidates: HSEAlertCandidate[], now: number): IngestResult {
    const fired: HSEActiveAlert[] = [];
    const seen = new Set<string>();

    for (const c of candidates) {
      const key = keyFor(c);
      // Keep only the highest-severity candidate per key this tick.
      if (seen.has(key)) {
        const prev = this.alerts.get(key)!;
        if (SEV_RANK[c.severity] <= SEV_RANK[prev.severity]) continue;
      }
      seen.add(key);

      const existing = this.alerts.get(key);
      if (!existing) {
        const alert: HSEActiveAlert = {
          key,
          id: `hse-a${++alertSeq}`,
          severity: c.severity,
          category: c.category,
          title: c.title,
          shortMessage: c.shortMessage,
          spokenMessage: c.spokenMessage,
          recommendedAction: c.recommendedAction,
          confidence: c.confidence,
          bbox: c.bbox,
          relatedTrackIds: c.relatedTrackIds,
          wearablePattern: c.wearablePattern,
          reasoningSource: "rules",
          state: "new",
          firstFiredMs: now,
          lastFiredMs: now,
          lastSeenMs: now,
        };
        this.alerts.set(key, alert);
        fired.push(alert);
        continue;
      }

      const escalated = SEV_RANK[c.severity] > SEV_RANK[existing.severity];
      // refresh content + recover from resolved
      existing.severity = escalated ? c.severity : existing.severity;
      existing.title = c.title;
      existing.shortMessage = c.shortMessage;
      existing.spokenMessage = c.spokenMessage;
      existing.recommendedAction = c.recommendedAction;
      existing.confidence = c.confidence;
      existing.bbox = c.bbox;
      existing.relatedTrackIds = c.relatedTrackIds;
      existing.wearablePattern = c.wearablePattern;
      existing.lastSeenMs = now;
      if (existing.state === "resolved") existing.state = "active";

      const cooldown = ALERT_COOLDOWN_MS[existing.severity];
      const cooledDown = now - existing.lastFiredMs >= cooldown;
      const acknowledged = existing.state === "acknowledged";
      // Fire again on cooldown (or immediately on escalation), unless quietly ack'd.
      if (escalated || (cooledDown && !acknowledged)) {
        existing.lastFiredMs = now;
        if (existing.state === "new") existing.state = "active";
        fired.push(existing);
      }
    }

    // Resolve unseen alerts; drop long-resolved ones.
    for (const [key, a] of this.alerts) {
      if (seen.has(key)) continue;
      if (a.state !== "resolved" && now - a.lastSeenMs > RESOLVE_TTL_MS) a.state = "resolved";
      if (now - a.lastSeenMs > DROP_AFTER_MS) this.alerts.delete(key);
    }

    return { active: this.list(), fired };
  }

  /**
   * Merge DeepSeek's refined alerts onto the current active alerts (by shared
   * track ids, else by category). DeepSeek improves text/overlay only — it
   * never creates new keys or changes the local-rules severity downward.
   */
  mergeReasoning(reasoned: HSEReasonedAlert[]): void {
    for (const r of reasoned) {
      const target = this.findTarget(r);
      if (!target) continue;
      if (r.title) target.title = r.title;
      if (r.shortMessage) target.shortMessage = r.shortMessage;
      if (r.spokenMessage) target.spokenMessage = r.spokenMessage;
      if (r.recommendedAction) target.recommendedAction = r.recommendedAction;
      if (r.overlay) target.overlay = r.overlay;
      if (r.wearablePattern) target.wearablePattern = r.wearablePattern;
      target.reasoningSource = "deepseek";
    }
  }

  private findTarget(r: HSEReasonedAlert): HSEActiveAlert | undefined {
    const byTrack = [...this.alerts.values()].find(
      (a) =>
        a.state !== "resolved" && r.relatedTrackIds.some((id) => a.relatedTrackIds.includes(id)),
    );
    if (byTrack) return byTrack;
    return [...this.alerts.values()].find(
      (a) => a.state !== "resolved" && a.category === r.category,
    );
  }
}
