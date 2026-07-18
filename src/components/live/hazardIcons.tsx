import {
  Ban,
  DoorClosed,
  HardHat,
  PersonStanding,
  TriangleAlert,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { HazardType } from "@/lib/detection/types";

export const HAZARD_ICONS: Record<HazardType, LucideIcon> = {
  unsafe_lift: PersonStanding,
  ppe_missing: HardHat,
  person_proximity: Users,
  restricted_zone: Ban,
  blocked_exit: DoorClosed,
  forklift_proximity: Truck,
  fall_risk: TriangleAlert,
};

/** Safe accessor: never returns undefined for an unknown/off-enum hazard_type
 *  (e.g. data drift from an older worker) — falls back to the generic alert
 *  glyph so a render can never crash on `HAZARD_ICONS[type]`. */
export function hazardIcon(hazardType: HazardType | string): LucideIcon {
  return HAZARD_ICONS[hazardType as HazardType] ?? TriangleAlert;
}
