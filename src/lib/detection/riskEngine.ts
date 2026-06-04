import type { Alert, HazardType, Observation, Severity } from "./types";
import { SEVERITY_ORDER } from "./types";
import { HAZARDS } from "./hazardCatalog";

interface Track {
  hazardType: HazardType;
  firstSeen: number; // performance.now()
  lastSeen: number;
  peakConfidence: number;
  lastBox?: Observation["bbox"];
  zoneLabel?: string;
  emittedSeverity: Severity | null; // highest severity already surfaced / tracked
  lastAlertAt: number;
}

export interface RiskEngineConfig {
  /** ms a track may go unseen before it is reset. */
  gapMs: number;
  /** ms a hazard must persist before low → medium (flag). */
  mediumAfterMs: number;
  /** ms a hazard must persist before medium → high (warning). */
  highAfterMs: number;
  /** ms before the same sustained high/critical re-alerts as a reminder. */
  reAlertMs: number;
  /** minimum confidence for an immediate-critical hazard to fire at once. */
  immediateCriticalConfidence: number;
}

/**
 * Tiered alerting from the SafeLens strategy: a 0.2 s blip triggers nothing;
 * held ~0.6 s while persisting it becomes a flag; sustained it becomes a
 * warning; a collision/fall-path hazard fires critically at once with no
 * ramp-up. Hysteresis + a re-alert cooldown keep false alarms — the fastest
 * way to lose a site — under control.
 */
export const DEFAULT_RISK_CONFIG: RiskEngineConfig = {
  gapMs: 700,
  mediumAfterMs: 600,
  highAfterMs: 1600,
  reAlertMs: 6000,
  immediateCriticalConfidence: 0.6,
};

let alertSeq = 0;

export class RiskEngine {
  private tracks = new Map<string, Track>();
  private cfg: RiskEngineConfig;

  constructor(cfg: Partial<RiskEngineConfig> = {}) {
    this.cfg = { ...DEFAULT_RISK_CONFIG, ...cfg };
  }

  reset() {
    this.tracks.clear();
  }

  /** Current escalation severity for a hazard/track (used to colour the overlay). */
  currentSeverity(hazardType: HazardType, trackKey?: string): Severity | null {
    return this.tracks.get(trackId(hazardType, trackKey))?.emittedSeverity ?? null;
  }

  /**
   * Feed this frame's observations; returns alerts that should be surfaced now.
   */
  update(observations: Observation[], now: number): Alert[] {
    const alerts: Alert[] = [];
    const seen = new Set<string>();

    for (const obs of observations) {
      const key = trackId(obs.hazardType, obs.trackKey);
      seen.add(key);
      const meta = HAZARDS[obs.hazardType];
      let track = this.tracks.get(key);
      let created = false;

      if (!track || now - track.lastSeen > this.cfg.gapMs) {
        created = true;
        track = {
          hazardType: obs.hazardType,
          firstSeen: now,
          lastSeen: now,
          peakConfidence: obs.confidence,
          lastBox: obs.bbox,
          zoneLabel: obs.zoneLabel,
          emittedSeverity: null,
          lastAlertAt: 0,
        };
        this.tracks.set(key, track);
      } else {
        track.lastSeen = now;
        track.peakConfidence = Math.max(track.peakConfidence, obs.confidence);
        track.lastBox = obs.bbox;
        if (obs.zoneLabel) track.zoneLabel = obs.zoneLabel;
      }

      const elapsed = now - track.firstSeen;
      const candidate = this.severityFor(meta.immediateCritical, obs.confidence, elapsed);

      const prevRank = track.emittedSeverity ? SEVERITY_ORDER[track.emittedSeverity] : -1;
      const newRank = SEVERITY_ORDER[candidate];

      const escalatedToAlertable = newRank > prevRank && newRank >= SEVERITY_ORDER.medium;
      const shouldRemind =
        (candidate === "high" || candidate === "critical") &&
        now - track.lastAlertAt >= this.cfg.reAlertMs;

      if (escalatedToAlertable || shouldRemind) {
        track.emittedSeverity = maxSeverity(track.emittedSeverity, candidate);
        track.lastAlertAt = now;
        alerts.push({
          id: `a${++alertSeq}-${Math.round(now)}`,
          hazardType: obs.hazardType,
          severity: candidate,
          confidence: track.peakConfidence,
          message: meta.message,
          bbox: track.lastBox,
          zoneLabel: track.zoneLabel,
          createdAt: Date.now(),
          isIncident: candidate === "high" || candidate === "critical",
          silent: false,
        });
      } else if (newRank > prevRank) {
        // track current (sub-alert) severity for overlay colouring without surfacing it
        track.emittedSeverity = candidate;
        if (created && candidate === "low") {
          // Low tier: record to the dashboard silently, never surfaced in the feed.
          alerts.push({
            id: `a${++alertSeq}-${Math.round(now)}`,
            hazardType: obs.hazardType,
            severity: "low",
            confidence: track.peakConfidence,
            message: meta.message,
            bbox: track.lastBox,
            zoneLabel: track.zoneLabel,
            createdAt: Date.now(),
            isIncident: false,
            silent: true,
          });
        }
      }
    }

    // expire stale tracks
    for (const [key, track] of this.tracks) {
      if (!seen.has(key) && now - track.lastSeen > this.cfg.gapMs) {
        this.tracks.delete(key);
      }
    }

    return alerts;
  }

  private severityFor(immediateCritical: boolean, confidence: number, elapsedMs: number): Severity {
    if (immediateCritical && confidence >= this.cfg.immediateCriticalConfidence) {
      return "critical";
    }
    if (elapsedMs >= this.cfg.highAfterMs) return "high";
    if (elapsedMs >= this.cfg.mediumAfterMs) return "medium";
    return "low";
  }
}

function maxSeverity(a: Severity | null, b: Severity): Severity {
  if (!a) return b;
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/** Track-map key: per-hazard by default, per-pair/person when a trackKey is set. */
function trackId(hazardType: HazardType, trackKey?: string): string {
  return trackKey ? `${hazardType}:${trackKey}` : hazardType;
}
