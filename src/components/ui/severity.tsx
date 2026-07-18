import { cn } from "@/lib/utils";
import {
  AlertOctagon,
  TriangleAlert,
  ShieldAlert,
  Info,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

/**
 * Severity primitives for the Graphite Console design system.
 *
 * HARD RULE (WCAG + control-room): severity is NEVER conveyed by colour alone.
 * Every SeverityBadge renders colour + a distinct Lucide icon + a text label, so
 * it stays legible in greyscale and for colour-blind operators. Critical always
 * carries the highest visual weight (solid fill by default, heaviest stripe).
 *
 * Levels mirror the domain risk/severity enums (low | medium | high | critical)
 * plus `ok` for all-clear / resolved states. See `src/features/safety/lib/
 * riskModel.ts` (RiskLevel) and the DB `severity` enum.
 */
export type SeverityLevel = "critical" | "high" | "medium" | "low" | "ok";

export const SEVERITY_LEVELS: SeverityLevel[] = ["critical", "high", "medium", "low", "ok"];

/** Ordering weight — highest first. Domain `Severity` (low|medium|high|critical)
 *  is a subset of these keys, so it can be sorted with this map directly. */
export const SEVERITY_RANK: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  ok: 0,
};

interface SeverityMeta {
  label: string;
  icon: LucideIcon;
  /** Soft (tinted) treatment — token-driven, works in light + dark. */
  soft: string;
  /** Solid treatment — used for the highest-priority (critical) rows. */
  solid: string;
  /** Left indicator stripe class (from styles.css). */
  stripe: string;
  /** Foreground/text-only token class. */
  fg: string;
  /** Small dot for legends. */
  dot: string;
}

export const SEVERITY_META: Record<SeverityLevel, SeverityMeta> = {
  critical: {
    label: "Critical",
    icon: AlertOctagon,
    soft: "bg-critical/15 text-critical border-critical/30",
    solid: "bg-critical text-critical-foreground border-critical",
    stripe: "severity-stripe severity-critical",
    fg: "text-critical",
    dot: "bg-critical",
  },
  high: {
    label: "High",
    icon: TriangleAlert,
    soft: "bg-high/15 text-high border-high/30",
    solid: "bg-high text-high-foreground border-high",
    stripe: "severity-stripe severity-high",
    fg: "text-high",
    dot: "bg-high",
  },
  medium: {
    label: "Medium",
    icon: ShieldAlert,
    soft: "bg-medium/15 text-medium border-medium/30",
    solid: "bg-medium text-medium-foreground border-medium",
    stripe: "severity-stripe severity-medium",
    fg: "text-medium",
    dot: "bg-medium",
  },
  low: {
    label: "Low",
    icon: Info,
    soft: "bg-low/15 text-low border-low/30",
    solid: "bg-low text-low-foreground border-low",
    stripe: "severity-stripe severity-low",
    fg: "text-low",
    dot: "bg-low",
  },
  ok: {
    label: "OK",
    icon: CheckCircle2,
    soft: "bg-ok/15 text-ok border-ok/30",
    solid: "bg-ok text-ok-foreground border-ok",
    stripe: "severity-stripe severity-ok",
    fg: "text-ok",
    dot: "bg-ok",
  },
};

/** Class names for the left indicator stripe on a container. */
export function severityStripeClass(level: SeverityLevel): string {
  return SEVERITY_META[level].stripe;
}

interface SeverityBadgeProps {
  level: SeverityLevel;
  /** Override the default label text (defaults to the level name). */
  label?: string;
  /**
   * `soft` (default) tints; `solid` fills — critical auto-promotes to solid
   * unless explicitly overridden, so it always ranks highest.
   */
  variant?: "soft" | "solid";
  size?: "sm" | "md";
  /** Hide the label text (icon still present — never colour-only). */
  iconOnly?: boolean;
  className?: string;
}

export function SeverityBadge({
  level,
  label,
  variant,
  size = "md",
  iconOnly = false,
  className,
}: SeverityBadgeProps) {
  const meta = SEVERITY_META[level];
  const Icon = meta.icon;
  // Critical always ranks highest → default to a solid fill.
  const resolved = variant ?? (level === "critical" ? "solid" : "soft");
  const tone = resolved === "solid" ? meta.solid : meta.soft;
  const text = label ?? meta.label;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium leading-none",
        size === "sm" ? "px-1.5 py-1 text-[11px]" : "px-2 py-1 text-xs",
        tone,
        className,
      )}
      role="status"
      aria-label={`Severity: ${text}`}
    >
      <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0")} aria-hidden />
      {!iconOnly && <span>{text}</span>}
    </span>
  );
}

/** Tiny legend swatch — icon + dot + label, for keys/legends. */
export function SeverityLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-3 text-[11px]", className)}>
      {SEVERITY_LEVELS.filter((l) => l !== "ok").map((level) => {
        const meta = SEVERITY_META[level];
        const Icon = meta.icon;
        return (
          <span key={level} className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className={cn("h-3 w-3", meta.fg)} aria-hidden />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
