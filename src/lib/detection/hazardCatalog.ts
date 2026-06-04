import type { HazardType, Severity } from "./types";

export interface HazardMeta {
  type: HazardType;
  label: string;
  short: string;
  /** Coaching-tone message surfaced in the alert feed (non-punitive by design). */
  message: string;
  /** lucide-react icon name. */
  icon: string;
  /** Escalates straight to critical when confident (collision / fall paths). */
  immediateCritical: boolean;
  /** Base spawn weight used by the simulator. */
  weight: number;
}

/**
 * The five core detections from the SafeLens strategy (plus forklift + fall
 * risk). Messages use a coaching, non-punitive tone on purpose — a device that
 * feels punitive gets left in a locker.
 */
export const HAZARDS: Record<HazardType, HazardMeta> = {
  unsafe_lift: {
    type: "unsafe_lift",
    label: "Unsafe lifting",
    short: "Lift",
    message: "Bend your knees — keep your back straight.",
    icon: "PersonStanding",
    immediateCritical: false,
    weight: 1.0,
  },
  ppe_missing: {
    type: "ppe_missing",
    label: "PPE compliance",
    short: "PPE",
    message: "Safety gear required — check helmet, vest and glasses.",
    icon: "HardHat",
    immediateCritical: false,
    weight: 1.0,
  },
  person_proximity: {
    type: "person_proximity",
    label: "Person proximity",
    short: "Proximity",
    message: "Person close by — keep a safe distance.",
    icon: "Users",
    immediateCritical: false,
    weight: 0.9,
  },
  restricted_zone: {
    type: "restricted_zone",
    label: "Restricted-zone entry",
    short: "Zone",
    message: "Restricted area — step back.",
    icon: "Ban",
    immediateCritical: false,
    weight: 0.8,
  },
  blocked_exit: {
    type: "blocked_exit",
    label: "Blocked fire exit",
    short: "Exit",
    message: "Emergency exit blocked — clear the path.",
    icon: "DoorClosed",
    immediateCritical: false,
    weight: 0.6,
  },
  forklift_proximity: {
    type: "forklift_proximity",
    label: "Forklift proximity",
    short: "Forklift",
    message: "Forklift approaching — move aside.",
    icon: "Truck",
    immediateCritical: true,
    weight: 0.8,
  },
  fall_risk: {
    type: "fall_risk",
    label: "Fall / edge risk",
    short: "Fall",
    message: "Edge or fall risk — stop and steady yourself.",
    icon: "TriangleAlert",
    immediateCritical: true,
    weight: 0.5,
  },
};

export const ALL_HAZARDS: HazardType[] = Object.keys(HAZARDS) as HazardType[];

export interface SeverityStyle {
  label: string;
  tone: string;
  text: string;
  bg: string;
  border: string;
  /** RGBA stroke for the overlay box. */
  stroke: string;
}

export const SEVERITY_META: Record<Severity, SeverityStyle> = {
  low: {
    label: "Low",
    tone: "Logged",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-muted-foreground/30",
    stroke: "rgba(148,163,184,0.9)",
  },
  medium: {
    label: "Medium",
    tone: "Flagged",
    text: "text-yellow-500",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/40",
    stroke: "rgba(234,179,8,0.95)",
  },
  high: {
    label: "High",
    tone: "Warning",
    text: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/50",
    stroke: "rgba(249,115,22,0.95)",
  },
  critical: {
    label: "Critical",
    tone: "Act now",
    text: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/60",
    stroke: "rgba(239,68,68,1)",
  },
};
