import { Cable, CircuitBoard, Cpu, Plug, Shapes, TriangleAlert, Wrench } from "lucide-react";
import { planRoleDisplayLabel } from "../lib/sceneBlueprint";
import type { PlanObjectRole, PlanSceneObject } from "../types";

/**
 * Plan console — "DETECTED OBJECTS (N)" panel (mockup): an ordered list with a
 * small role icon, the object number, its name, and an UPPERCASE role subtitle
 * (PRIMARY PART / CABLE / TOOL …). The currently-active object is highlighted in
 * amber to match the scene's active reticle. PURE presentation.
 */

const ROLE_ICON: Record<PlanObjectRole, typeof Cpu> = {
  "primary-part": CircuitBoard,
  tool: Wrench,
  connector: Plug,
  cable: Cable,
  fastener: Shapes,
  support: Shapes,
  hazard: TriangleAlert,
  unknown: Cpu,
};

export function PlanDetectedObjects({
  objects,
  activeObjectId,
  className,
}: {
  objects: PlanSceneObject[];
  /** Id of the object the active step is operating on (highlighted amber). */
  activeObjectId?: string | null;
  className?: string;
}) {
  return (
    <div className={`console-panel p-3 ${className ?? ""}`}>
      <p className="console-eyebrow">Detected objects ({objects.length})</p>
      {objects.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No parts detected yet — point the camera at the workspace.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {objects.map((obj, i) => {
            const Icon = ROLE_ICON[obj.role] ?? Cpu;
            const isActive = obj.id === activeObjectId;
            return (
              <li
                key={obj.id}
                className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors ${
                  isActive ? "border-amber-300/30 bg-amber-400/10" : "border-white/5 bg-black/15"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                    isActive ? "bg-amber-400/15 text-amber-200" : "bg-cyan-400/10 text-cyan-200"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    isActive
                      ? "border-amber-300/40 text-amber-200"
                      : "border-cyan-300/30 text-cyan-200"
                  }`}
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {obj.label || "Object"}
                  </span>
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {planRoleDisplayLabel(obj.role)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
