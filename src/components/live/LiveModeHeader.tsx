import { AlertTriangle, Camera, CircleDot, Hammer, Radar, Route, ShieldCheck } from "lucide-react";

type LiveMode = "hse" | "build" | "plan";

const MODE_META = {
  hse: {
    label: "Eagle Vision",
    eyebrow: "Safety monitoring",
    description: "Watch the work area, surface risk, and keep operators informed.",
    icon: Radar,
    tone: "cyan",
  },
  build: {
    label: "Build Studio",
    eyebrow: "Procedure capture",
    description: "Extract a blueprint, place it, then record and save the procedure.",
    icon: Hammer,
    tone: "mint",
  },
  plan: {
    label: "Plan Assistant",
    eyebrow: "Guided AR workflow",
    description: "Capture the workpiece, set a goal, and follow generated guidance.",
    icon: Route,
    tone: "violet",
  },
} as const;

interface Props {
  mode: LiveMode;
  running: boolean;
  cameraActive: boolean;
  backendName: string | null;
  fallbackActive: boolean;
  objectCount: number;
  alertCount: number;
  topRisk?: string | null;
}

export function LiveModeHeader({
  mode,
  running,
  cameraActive,
  backendName,
  fallbackActive,
  objectCount,
  alertCount,
  topRisk,
}: Props) {
  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;
  const backendLabel =
    backendName === "yolo26"
      ? "YOLO26"
      : backendName === "edgecrafter"
        ? "EdgeCrafter"
        : backendName;

  return (
    <section className={`live-command-bar live-mode-${meta.tone}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="live-mode-emblem">
          <ModeIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="console-eyebrow">{meta.eyebrow}</p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-display text-xl font-semibold sm:text-2xl">{meta.label}</h1>
            <p className="hidden max-w-xl text-xs text-muted-foreground md:block">
              {meta.description}
            </p>
          </div>
        </div>
      </div>

      <div className="live-status-grid">
        <div className="live-status-item">
          <span className={running ? "status-dot status-dot-live" : "status-dot"} />
          <span>
            <small>Session</small>
            <strong>{running ? "Monitoring" : "Paused"}</strong>
          </span>
        </div>
        <div className="live-status-item">
          <Camera className="h-4 w-4" />
          <span>
            <small>Camera</small>
            <strong>{cameraActive ? "Ready" : "Offline"}</strong>
          </span>
        </div>
        <div className="live-status-item">
          {fallbackActive ? (
            <AlertTriangle className="h-4 w-4 text-amber-300" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          <span>
            <small>Vision</small>
            <strong>{fallbackActive ? "Fallback" : (backendLabel ?? "Standby")}</strong>
          </span>
        </div>
        <div className="live-status-item hidden sm:flex">
          <CircleDot className="h-4 w-4" />
          <span>
            <small>{topRisk ? "Top risk" : "Scene"}</small>
            <strong>{topRisk ?? `${objectCount} objects / ${alertCount} alerts`}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
