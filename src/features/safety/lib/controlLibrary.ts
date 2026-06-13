import type { HazardType } from "@/lib/detection/types";

/**
 * NIOSH hierarchy of controls (most → least effective): elimination,
 * substitution, engineering, administrative, PPE. Higher-order controls reduce
 * exposure without relying on human behaviour, so the UI surfaces them first
 * and flags plans that lean only on PPE/administrative measures.
 *
 * The library maps SafeLens's real `hazard_type` enum to default control
 * suggestions — used to seed corrective actions. Static config (no DB).
 */

export type ControlType = "elimination" | "substitution" | "engineering" | "administrative" | "ppe";

export const CONTROL_TYPE_META: Record<
  ControlType,
  { label: string; rank: number; text: string; bg: string; note: string }
> = {
  elimination: {
    label: "Elimination",
    rank: 1,
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    note: "Most effective — physically remove the hazard",
  },
  substitution: {
    label: "Substitution",
    rank: 2,
    text: "text-teal-300",
    bg: "bg-teal-500/15",
    note: "Replace it with something less hazardous",
  },
  engineering: {
    label: "Engineering",
    rank: 3,
    text: "text-cyan-300",
    bg: "bg-cyan-500/15",
    note: "Isolate people from the hazard",
  },
  administrative: {
    label: "Administrative",
    rank: 4,
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    note: "Change the way people work",
  },
  ppe: {
    label: "PPE",
    rank: 5,
    text: "text-orange-300",
    bg: "bg-orange-500/15",
    note: "Least effective — relies on behaviour",
  },
};

export const CONTROL_TYPE_ORDER: ControlType[] = [
  "elimination",
  "substitution",
  "engineering",
  "administrative",
  "ppe",
];

export interface ControlSuggestion {
  type: ControlType;
  text: string;
}

export const CONTROL_LIBRARY: Record<HazardType, ControlSuggestion[]> = {
  forklift_proximity: [
    { type: "elimination", text: "Segregate pedestrian and vehicle routes" },
    { type: "engineering", text: "Physical barriers + proximity sensors / alarms" },
    { type: "administrative", text: "Banksman, speed limits, one-way routes, briefings" },
    { type: "ppe", text: "High-visibility clothing" },
  ],
  fall_risk: [
    { type: "elimination", text: "Eliminate work at height where possible" },
    { type: "engineering", text: "Guardrails, edge protection, hole covers" },
    { type: "administrative", text: "Permit-to-work, training, exclusion zones" },
    { type: "ppe", text: "Fall-arrest harness + anchor point" },
  ],
  restricted_zone: [
    { type: "engineering", text: "Physical barrier / gated access control" },
    { type: "administrative", text: "Signage, permits, induction & briefings" },
  ],
  blocked_exit: [
    { type: "elimination", text: "Remove the obstruction; relocate storage" },
    { type: "engineering", text: "Keep-clear floor markings, self-closing routes" },
    { type: "administrative", text: "Routine housekeeping checks, exit signage" },
  ],
  ppe_missing: [
    { type: "engineering", text: "PPE dispensers / entry checkpoints" },
    { type: "administrative", text: "Training, supervision, site PPE policy" },
    { type: "ppe", text: "Provide & enforce correct PPE" },
  ],
  unsafe_lift: [
    { type: "engineering", text: "Mechanical aids — hoists, trolleys, conveyors" },
    { type: "substitution", text: "Reduce load size / split the load" },
    { type: "administrative", text: "Manual-handling training, team lifts" },
    { type: "ppe", text: "Support gear (least effective)" },
  ],
  person_proximity: [
    { type: "engineering", text: "Barriers / fixed exclusion zones" },
    { type: "administrative", text: "Spacing rules, spotters, scheduling" },
    { type: "ppe", text: "High-visibility clothing" },
  ],
};
