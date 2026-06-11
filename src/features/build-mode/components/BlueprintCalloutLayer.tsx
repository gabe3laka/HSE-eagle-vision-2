import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, Info, Target } from "lucide-react";
import { layoutCallouts, type CardBounds, type PlacedCallout } from "../lib/calloutLayout";
import type { BlueprintFrame, BlueprintNote } from "../types";

/**
 * Readable instruction CALLOUT cards rendered OUTSIDE the blueprint crop and
 * connected to their markers by leader lines. The blueprint overlay keeps the
 * markers/anchors/arrows; the TEXT lives here where there's room to read it on
 * a phone. Cards auto-place on the side of the ghost with the most room, stack
 * without overlapping, expand on tap, and give safety notes stronger treatment.
 */

interface NoteMeta {
  label: string;
  icon: typeof Info;
  color: string;
  border: string;
  bg: string;
}

const META: Record<BlueprintNote["type"], NoteMeta> = {
  instruction: {
    label: "Instruction",
    icon: Info,
    color: "rgb(165,243,252)",
    border: "rgba(34,211,238,0.6)",
    bg: "rgba(8,47,73,0.92)",
  },
  "next-step": {
    label: "Next step",
    icon: ArrowRight,
    color: "rgb(253,230,138)",
    border: "rgba(251,191,36,0.7)",
    bg: "rgba(69,46,5,0.92)",
  },
  safety: {
    label: "Safety",
    icon: AlertTriangle,
    color: "rgb(254,202,202)",
    border: "rgba(248,113,113,0.95)",
    bg: "rgba(69,10,10,0.95)",
  },
  quality: {
    label: "Quality check",
    icon: CheckCircle2,
    color: "rgb(167,243,208)",
    border: "rgba(52,211,153,0.65)",
    bg: "rgba(6,46,33,0.92)",
  },
  observation: {
    label: "Observation",
    icon: Eye,
    color: "rgb(186,230,253)",
    border: "rgba(125,211,252,0.55)",
    bg: "rgba(8,37,64,0.9)",
  },
  intent: {
    label: "Goal",
    icon: Target,
    color: "rgb(221,214,254)",
    border: "rgba(196,181,253,0.6)",
    bg: "rgba(46,16,101,0.9)",
  },
};

const LINE_COLOR: Record<BlueprintNote["type"], string> = {
  instruction: "rgba(34,211,238,0.85)",
  "next-step": "rgba(251,191,36,0.9)",
  safety: "rgba(248,113,113,0.95)",
  quality: "rgba(52,211,153,0.85)",
  observation: "rgba(125,211,252,0.75)",
  intent: "rgba(196,181,253,0.8)",
};

/** Card box CSS for the chosen side — leaves a readable column to the edge. */
function cardStyle(c: PlacedCallout): React.CSSProperties {
  if (c.side === "right") {
    return {
      left: "58%",
      right: "2%",
      top: `${c.connect.y * 100}%`,
      transform: "translateY(-50%)",
    };
  }
  if (c.side === "left") {
    return {
      left: "2%",
      right: "58%",
      top: `${c.connect.y * 100}%`,
      transform: "translateY(-50%)",
    };
  }
  return {
    left: `${c.connect.x * 100}%`,
    top: "72%",
    transform: "translate(-50%, 0)",
    maxWidth: "46%",
  };
}

function CalloutCard({ callout }: { callout: PlacedCallout }) {
  const [expanded, setExpanded] = useState(false);
  const meta = META[callout.type];
  const Icon = meta.icon;
  const isSafety = callout.type === "safety";
  const long = callout.text.length > 64;
  return (
    <button
      type="button"
      onClick={() => long && setExpanded((v) => !v)}
      className={`pointer-events-auto absolute z-[1] rounded-lg border px-2 py-1 text-left shadow-lg backdrop-blur-sm ${
        isSafety ? "ring-1 ring-red-400/50" : ""
      } ${long ? "cursor-pointer" : "cursor-default"}`}
      style={{
        ...cardStyle(callout),
        borderColor: meta.border,
        background: meta.bg,
        borderWidth: isSafety ? 1.5 : 1,
      }}
    >
      <span
        className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide"
        style={{ color: meta.color }}
      >
        <Icon className="h-3 w-3 shrink-0" />
        {meta.label}
      </span>
      <span
        className={`block text-[11px] leading-snug text-white/95 ${
          expanded || !long ? "" : "line-clamp-2"
        }`}
      >
        {callout.text}
      </span>
      {long && (
        <span className="text-[9px] text-white/50">
          {expanded ? "tap to collapse" : "tap to expand"}
        </span>
      )}
    </button>
  );
}

export function BlueprintCalloutLayer({
  frame,
  bounds,
}: {
  frame: BlueprintFrame | null;
  /** Live ghost bounds in card space (region + drag transform). */
  bounds: CardBounds | null;
}) {
  if (!frame || !bounds) return null;
  const notes = frame.aiNotes ?? [];
  const callouts = layoutCallouts(bounds, notes);
  if (callouts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* leader lines: marker → card attach point */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {callouts.map((c) => (
          <g key={`lead-${c.id}`}>
            <line
              x1={c.anchor.x * 100}
              y1={c.anchor.y * 100}
              x2={c.connect.x * 100}
              y2={c.connect.y * 100}
              stroke={LINE_COLOR[c.type]}
              strokeWidth={0.4}
              strokeDasharray="1.5 1"
            />
            <circle cx={c.anchor.x * 100} cy={c.anchor.y * 100} r={0.9} fill={LINE_COLOR[c.type]} />
          </g>
        ))}
      </svg>
      {callouts.map((c) => (
        <CalloutCard key={c.id} callout={c} />
      ))}
    </div>
  );
}
