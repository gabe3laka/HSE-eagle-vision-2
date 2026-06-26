import type { SvRemoteRiskMessage } from "../types";
import { riskLevelColor } from "@/lib/detection/riskTypes";

function severityToRiskLevel(severity: string): string {
  if (severity === "critical") return "RED";
  if (severity === "high") return "ORANGE";
  return "YELLOW";
}

/** Chronological feed of remote ORANGE/RED risks from sv_remote_risk events. */
export function RemoteRiskFeed({
  risks,
}: {
  risks: Array<SvRemoteRiskMessage & { expiresAt: number }>;
}) {
  if (risks.length === 0) return null;
  const now = Date.now();
  const active = risks.filter((r) => r.expiresAt > now);
  if (active.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">
        Remote risks
      </p>
      {active.map((r) => {
        const level = severityToRiskLevel(r.severity);
        const color = riskLevelColor(level);
        const peerLabel = r.deviceLabel ?? r.deviceId.slice(0, 6);
        const ageS = Math.round((now - r.ts) / 1000);
        const expiring = r.expiresAt - now < 2000;
        return (
          <div
            key={`${r.deviceId}-${r.session_epoch}-${r.seq}`}
            className="flex items-start gap-2 rounded px-2 py-1 text-[11px]"
            style={{
              backgroundColor: "rgba(0,0,0,0.5)",
              borderLeft: `3px solid ${color}`,
              opacity: expiring ? 0.5 : 1,
            }}
          >
            <span className="font-semibold" style={{ color }}>
              {r.hazard_type.replace(/_/g, " ")}
            </span>
            <span className="text-muted-foreground">— Remote · {peerLabel}</span>
            {r.localizable ? (
              <span className="text-purple-300">· projected</span>
            ) : (
              <span className="text-muted-foreground">· awareness only</span>
            )}
            <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{ageS}s</span>
          </div>
        );
      })}
    </div>
  );
}
