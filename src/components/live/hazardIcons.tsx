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
