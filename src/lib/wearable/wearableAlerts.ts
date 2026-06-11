import type { HSESeverity } from "../detection/hseTypes";

/**
 * Phase 7 — wearable alert engine. Maps HSE alert severity to wearable outputs
 * (visual pattern + haptic vibration pattern + optional audio + spoken text),
 * and provides pluggable output adapters so a future wristband / AR-glasses
 * device can receive the same alert the phone shows today.
 */

export type WearableVisualPattern =
  | "none"
  | "cyan-ring"
  | "amber-pulse"
  | "red-pulse"
  | "critical-flash";

export interface WearableAlert {
  id: string;
  severity: HSESeverity;
  visualPattern: WearableVisualPattern;
  /** navigator.vibrate pattern (ms on/off). Empty = no haptic. */
  hapticPattern: number[];
  audioCue?: "none" | "soft" | "warning" | "critical";
  spokenMessage: string;
}

const HAPTICS: Record<HSESeverity, number[]> = {
  info: [],
  low: [40],
  medium: [60, 80, 60],
  high: [120, 80, 120],
  critical: [200, 80, 200, 80, 200],
};

const VISUAL: Record<HSESeverity, WearableVisualPattern> = {
  info: "none",
  low: "cyan-ring",
  medium: "amber-pulse",
  high: "red-pulse",
  critical: "critical-flash",
};

const AUDIO: Record<HSESeverity, WearableAlert["audioCue"]> = {
  info: "none",
  low: "soft",
  medium: "soft",
  high: "warning",
  critical: "critical",
};

/** Build a wearable alert from severity + spoken text. */
export function toWearableAlert(opts: {
  id: string;
  severity: HSESeverity;
  spokenMessage: string;
}): WearableAlert {
  return {
    id: opts.id,
    severity: opts.severity,
    visualPattern: VISUAL[opts.severity],
    hapticPattern: HAPTICS[opts.severity],
    audioCue: AUDIO[opts.severity],
    spokenMessage: opts.spokenMessage,
  };
}

/** A destination for wearable alerts (phone today, wristband/glasses later). */
export interface WearableOutputAdapter {
  readonly name: string;
  send(alert: WearableAlert): Promise<void>;
}

/** Phone haptics via the Vibration API — a no-op when unavailable. */
export class BrowserVibrationAdapter implements WearableOutputAdapter {
  readonly name = "browser-vibration";
  async send(alert: WearableAlert): Promise<void> {
    if (!alert.hapticPattern.length) return;
    vibrate(alert.hapticPattern);
  }
}

/** Drops every alert — used when haptics are disabled. */
export class NoopWearableAdapter implements WearableOutputAdapter {
  readonly name = "noop";
  async send(_alert: WearableAlert): Promise<void> {
    /* intentionally does nothing */
  }
}

/** Stub for a future BLE wristband — logs in dev, never throws. */
export class FutureBluetoothWristbandAdapter implements WearableOutputAdapter {
  readonly name = "future-bluetooth-wristband";
  async send(alert: WearableAlert): Promise<void> {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      console.debug("[wristband stub] would buzz", alert.severity, alert.hapticPattern);
    }
  }
}

/** Stub for a future AR-glasses HUD output — logs in dev, never throws. */
export class FutureGlassesHudAdapter implements WearableOutputAdapter {
  readonly name = "future-glasses-hud";
  async send(alert: WearableAlert): Promise<void> {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      console.debug("[glasses stub] would show", alert.severity, alert.spokenMessage);
    }
  }
}

/** Fire-and-forget browser vibration — guarded for SSR / unsupported devices. */
export function vibrate(pattern: number[]): boolean {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator && pattern.length) {
      return (navigator as Navigator & { vibrate(p: number[]): boolean }).vibrate(pattern);
    }
  } catch {
    /* ignore — vibration is best-effort */
  }
  return false;
}
