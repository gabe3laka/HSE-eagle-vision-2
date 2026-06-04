import type { BBox, Detector, DetectorInput, HazardType, Observation } from "./types";
import { ALL_HAZARDS, HAZARDS } from "./hazardCatalog";

interface Episode {
  hazardType: HazardType;
  bbox: BBox;
  vx: number;
  vy: number;
  confidence: number;
  ticksRemaining: number;
  zoneLabel?: string;
}

/**
 * Generates realistic hazard "episodes" so the rest of the pipeline has
 * something to react to. Episodes persist across frames (a bad bend that
 * holds, a forklift that drifts closer), which is exactly what lets the risk
 * engine ramp from flag → warning → critical the way it would with real input.
 *
 * This is a stand-in for a real CV detector and implements the same `Detector`
 * contract, so swapping it for MediaPipe Pose / a YOLO model touches nothing
 * else in the app.
 */
export class SimulatedDetector implements Detector {
  readonly name = "simulated";
  private episodes: Episode[] = [];
  private tick = 0;

  async start() {
    this.episodes = [];
    this.tick = 0;
  }

  stop() {
    this.episodes = [];
  }

  detect(input: DetectorInput): Observation[] {
    this.tick++;
    const enabled = input.enabledHazards.length ? input.enabledHazards : ALL_HAZARDS;
    const sensitivity = clamp(input.sensitivity, 0.05, 1);

    // advance existing episodes
    this.episodes = this.episodes.filter((ep) => {
      ep.ticksRemaining--;
      ep.bbox.x = clamp(ep.bbox.x + ep.vx, 0, 1 - ep.bbox.w);
      ep.bbox.y = clamp(ep.bbox.y + ep.vy, 0, 1 - ep.bbox.h);
      ep.confidence = clamp(ep.confidence + rand(-0.02, 0.05), 0.3, 0.99);
      return ep.ticksRemaining > 0;
    });

    // maybe spawn a new episode (probability scales with sensitivity)
    const maxConcurrent = 2;
    const spawnChance = 0.05 + sensitivity * 0.12;
    if (this.episodes.length < maxConcurrent && Math.random() < spawnChance) {
      this.episodes.push(this.spawn(enabled));
    }

    // seed one shortly after start so the demo comes alive promptly
    if (this.tick === 10 && this.episodes.length === 0) {
      this.episodes.push(this.spawn(enabled));
    }

    return this.episodes.map((ep) => ({
      hazardType: ep.hazardType,
      confidence: ep.confidence,
      bbox: { ...ep.bbox },
      zoneLabel: ep.zoneLabel,
    }));
  }

  private spawn(enabled: HazardType[]): Episode {
    const type = weightedPick(enabled);
    const meta = HAZARDS[type];
    const w = rand(0.18, 0.34);
    const h = rand(0.28, 0.5);
    const immediate = meta.immediateCritical;
    return {
      hazardType: type,
      bbox: { x: rand(0, 1 - w), y: rand(0, 1 - h), w, h },
      vx: rand(-0.02, 0.02),
      vy: rand(-0.01, 0.01),
      confidence: immediate ? rand(0.65, 0.85) : rand(0.4, 0.6),
      // immediate-critical episodes are short & sharp; others persist so they ramp
      ticksRemaining: immediate ? Math.round(rand(6, 14)) : Math.round(rand(14, 34)),
      zoneLabel:
        type === "restricted_zone" ? "Zone B" : type === "blocked_exit" ? "Exit 2" : undefined,
    };
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function weightedPick(types: HazardType[]): HazardType {
  const weights = types.map((t) => HAZARDS[t].weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
}
