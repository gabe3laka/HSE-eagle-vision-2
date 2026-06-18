import { Sparkles } from "lucide-react";
import type {
  ParsedDetectRisk,
  DetectResponseSummary,
} from "@/lib/detection/backendVisionHttpDetector";
import { summarizeDetectResponse } from "@/lib/detection/backendVisionHttpDetector";
import type { BackendStatus } from "@/lib/detection/backendVisionDetector";

/**
 * Reasoner Contract Probe — dev/diagnostic only. Renders the latest backend
 * /detect response in a way that proves whether worker scene_risks and Qwen
 * fields are actually arriving. NEVER triggers alerts, haptics, incidents,
 * CAPA, or modifies overlay boxes.
 */

export interface ReasonerProbe {
  summary: DetectResponseSummary;
  endToEndWorking: boolean;
  qwenDetected: boolean;
}

/** PURE: build the probe verdict from the latest parsed risk + backend status. */
export function buildReasonerProbe(
  parsed: ParsedDetectRisk | null,
  rawResp: unknown,
  status: BackendStatus | null,
): ReasonerProbe {
  const summary = summarizeDetectResponse(rawResp, parsed, {
    latencyMs: status?.lastLatencyMs ?? null,
    proxy: "cloudflare",
    transport: status?.transport ?? null,
  });

  // End-to-end verdict: real scene_risks with at least one level AND at least
  // one form of linkage (ids OR bbox/region).
  const risks = parsed?.sceneRisks ?? [];
  const hasLevel = risks.some(
    (r) =>
      typeof r.risk_level === "string" &&
      ["GREEN", "YELLOW", "ORANGE", "RED"].includes(r.risk_level.toUpperCase()),
  );
  const hasLink = risks.some(
    (r) =>
      !!(r.linked_entity_id || r.entity_id || r.detection_id) ||
      (Array.isArray(r.involved_detection_ids) && r.involved_detection_ids.length > 0) ||
      !!r.track_id ||
      (Array.isArray(r.involved_track_ids) && r.involved_track_ids.length > 0) ||
      !!(r.bbox || r.box || r.approximate_region || r.region || r.visual_region || r.location_box),
  );
  const endToEndWorking = risks.length > 0 && hasLevel && hasLink;

  // Qwen contribution: explicit produced_by / reasoner_model markers OR semantic
  // corrections OR a scene_context with a ready/running reasoner status. Falls
  // back to the summary (which itself reads raw response fields) so the probe
  // still reports Qwen presence when `parsed` is null.
  const READY_RUNNING = new Set([
    "ready", "ok", "done", "completed", "success",
    "running", "processing", "in_progress", "busy",
  ]);
  const status_ = (summary.reasoner.reasonerStatus ?? "").toLowerCase();
  const qwenFromRisks = risks.some((r) => {
    const p = (r.produced_by ?? "").toLowerCase();
    const m = (r.reasoner_model ?? "").toLowerCase();
    return p.includes("qwen") || p.includes("vlm") || m.includes("qwen");
  });
  const qwenFromCorrections = summary.reasoner.semanticCorrections > 0;
  const qwenFromContext =
    summary.reasoner.sceneContextPresent && READY_RUNNING.has(status_);
  const qwenDetected = qwenFromRisks || qwenFromCorrections || qwenFromContext;

  return { summary, endToEndWorking, qwenDetected };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-semibold uppercase tracking-wider text-[10px] text-cyan-300/80">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function ReasonerContractProbe({
  parsedRisk,
  rawResp,
  status,
  localAlertsEnabled,
  riskLinkedEntityCount,
  riskLinkedPoseCount,
}: {
  parsedRisk: ParsedDetectRisk | null;
  rawResp: unknown;
  status: BackendStatus | null;
  localAlertsEnabled?: boolean;
  riskLinkedEntityCount?: number;
  riskLinkedPoseCount?: number;
}) {
  const probe = buildReasonerProbe(parsedRisk, rawResp, status);
  const s = probe.summary;
  const visibleSource = localAlertsEnabled ? "legacy_local_alerts" : "worker_scene_risks";
  const perceptionBackend =
    s.gateway.backend ?? (status?.backend ?? null);
  const perceptionModel = s.gateway.model ?? (status?.model ?? null);
  return (
    <div className="rounded-xl border border-violet-300/30 bg-violet-400/[0.04] p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-violet-300" />
        <span className="font-semibold text-violet-100">Reasoner Contract Probe</span>
        <span
          className={
            "ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider " +
            (localAlertsEnabled
              ? "bg-amber-400/15 text-amber-200"
              : "bg-emerald-400/15 text-emerald-200")
          }
          title="Visible alert source"
        >
          src: {visibleSource}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Cloudflare">
          <Row label="proxy" value={s.gateway.proxy ?? "—"} />
          <Row label="transport" value={s.gateway.transport ?? "—"} />
          <Row label="upstream_status" value={s.gateway.upstreamStatus ?? "—"} />
          <Row label="latency_ms" value={s.gateway.latencyMs ?? "—"} />
        </Section>
        <Section title="Perception">
          <Row label="backend" value={perceptionBackend ?? "—"} />
          <Row label="model" value={perceptionModel ?? "—"} />
          <Row label="detector_objects" value={s.detection.entities} />
          <Row label="risk_linked_boxes" value={riskLinkedEntityCount ?? "—"} />
          <Row label="risk_linked_poses" value={riskLinkedPoseCount ?? "—"} />
        </Section>
        <Section title="Detection">
          <Row label="entities" value={s.detection.entities} />
          <Row label="poses" value={s.detection.poses} />
          <Row label="segments" value={s.detection.segments} />
        </Section>
        <Section title="Risk">
          <Row label="risks" value={s.risk.risks} />
          <Row label="scene_risks" value={s.risk.sceneRisks} />
          <Row label="highest_level" value={s.risk.highestLevel ?? "—"} />
          <Row label="risk_engine" value={s.risk.riskEngine ?? "—"} />
          <Row label="degraded" value={String(s.risk.degraded)} />
          {s.risk.degradationMode && <Row label="degradation_mode" value={s.risk.degradationMode} />}
        </Section>
        <Section title="Reasoner">
          <Row label="reasoner_status" value={s.reasoner.reasonerStatus ?? "missing"} />
          <Row label="scene_context" value={s.reasoner.sceneContextPresent ? "yes" : "no"} />
          <Row label="semantic_corrections" value={s.reasoner.semanticCorrections} />
          <Row label="temporal_reasoning" value={s.reasoner.temporalReasoningPresent ? "yes" : "no"} />
        </Section>
        <Section title="Sources">
          <Row label="Rules" value={s.sources.rules} />
          <Row label="Qwen / VLM" value={s.sources.qwen} />
          <Row label="Rules + Qwen" value={s.sources.rulesAndQwen} />
          <Row label="Unknown" value={s.sources.unknown} />
        </Section>
        <Section title="Linkability">
          <Row label="linked_entity_id" value={s.linkability.withLinkedEntityId} />
          <Row label="involved_detection_ids" value={s.linkability.withInvolvedDetectionIds} />
          <Row label="involved_track_ids" value={s.linkability.withInvolvedTrackIds} />
          <Row label="bbox / region" value={s.linkability.withBboxOrRegion} />
          <Row label="unlinked" value={s.linkability.unlinked} />
        </Section>
      </div>
      <div className="mt-3 space-y-1 border-t border-violet-300/20 pt-2 text-[11px]">
        <div
          className={
            probe.endToEndWorking ? "text-emerald-300" : "text-muted-foreground"
          }
        >
          End-to-end scene reasoning: {probe.endToEndWorking ? "working" : "not confirmed"}
        </div>
        <div className={probe.qwenDetected ? "text-emerald-300" : "text-muted-foreground"}>
          Qwen contribution:{" "}
          {probe.qwenDetected ? "detected" : "not detected in latest response"}
        </div>
        <div className="text-muted-foreground">
          Visible alert source: <span className="text-foreground">{visibleSource}</span>
        </div>
        <div className="text-muted-foreground">
          Local alerts enabled:{" "}
          <span className="text-foreground">{localAlertsEnabled ? "yes" : "no"}</span>
        </div>
      </div>
    </div>
  );
}
