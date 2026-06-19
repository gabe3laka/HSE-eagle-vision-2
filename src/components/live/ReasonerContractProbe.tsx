import { Sparkles } from "lucide-react";
import type {
  ParsedDetectRisk,
  DetectResponseSummary,
} from "@/lib/detection/backendVisionHttpDetector";
import {
  summarizeDetectResponse,
  qwenResultReceivedFromSummary,
} from "@/lib/detection/backendVisionHttpDetector";
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
  ctx: { forceReasonSent?: boolean } = {},
): ReasonerProbe {
  const summary = summarizeDetectResponse(rawResp, parsed, {
    latencyMs: status?.lastLatencyMs ?? null,
    proxy: "cloudflare",
    transport: status?.transport ?? null,
    forceReasonSent: ctx.forceReasonSent,
  });

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

  // "Qwen contribution detected" uses the strict result-received rule:
  // `temporal_reasoning` alone never flips it true.
  const qwenDetected = qwenResultReceivedFromSummary(summary);

  return { summary, endToEndWorking, qwenDetected };
}

// ── New strict Qwen reasoning diagnostic ────────────────────────────────────

export type QwenReasoningState =
  | "not_requested"
  | "fields_present_empty"
  | "queued"
  | "running"
  | "ready_with_scene_risks"
  | "ready_no_scene_risks"
  | "unavailable"
  | "timeout"
  | "error"
  | "disabled";

export interface QwenDiagnostic {
  detectionOk: boolean;
  state: QwenReasoningState;
  rawReasonerStatus: string | null;
  normalizedReasonerStatus: string | null;
  qwenResultReceived: boolean;
  qwenUnavailableWarning: boolean;
  sceneRisks: number;
  semanticCorrections: number;
  sceneContextPresent: boolean;
  temporalReasoningPresent: boolean;
  forceReasonSent: boolean;
  message: string;
}

const READY = new Set(["ready", "ok", "done", "completed", "success", "cached"]);
const QUEUED = new Set(["queued", "pending", "scheduled", "throttled", "busy"]);
const RUNNING = new Set(["running", "processing", "in_progress", "triggered"]);

/** PURE: classify Qwen state from a DetectResponseSummary, with explicit
 *  wording per state. `temporal_reasoning` alone NEVER counts as a result. */
export function computeQwenDiagnostic(summary: DetectResponseSummary): QwenDiagnostic {
  const detectionOk = summary.detection.entities > 0 || summary.gateway.upstreamStatus === 200;
  const raw = summary.reasoner.rawReasonerStatus;
  const norm = summary.reasoner.reasonerStatus;
  const status = (norm ?? raw ?? "").toLowerCase();
  const warnings = summary.warnings ?? [];
  const qwenUnavailableWarning = warnings.includes("qwen_unavailable");
  const sceneRisks = summary.risk.sceneRisks;
  const fields = summary.riskAwareFieldsPresent;

  let state: QwenReasoningState;
  if (!fields && !raw && !norm) {
    state = "not_requested";
  } else if (
    qwenUnavailableWarning ||
    ["unavailable", "not_available", "missing"].includes(status)
  ) {
    state = "unavailable";
  } else if (status === "timeout") {
    state = "timeout";
  } else if (["error", "schema_error"].includes(status)) {
    state = "error";
  } else if (["disabled", "not_run"].includes(status)) {
    state = "disabled";
  } else if (QUEUED.has(status)) {
    state = "queued";
  } else if (RUNNING.has(status)) {
    state = "running";
  } else if (READY.has(status)) {
    state = sceneRisks > 0 ? "ready_with_scene_risks" : "ready_no_scene_risks";
  } else {
    // Risk-aware fields present but no recognizable status/context/corrections/risks.
    state = "fields_present_empty";
  }

  const qwenResultReceived = qwenResultReceivedFromSummary(summary);

  const messages: Record<QwenReasoningState, string> = {
    not_requested: "Risk-aware reasoning was not requested for this frame.",
    fields_present_empty:
      "Worker risk fields are present, but no active scene_risks were returned. Qwen result: not received.",
    queued: "Qwen queued/throttled. No current scene reasoning returned.",
    running: "Qwen running. No scene reasoning returned yet.",
    ready_with_scene_risks: "Qwen ready, active scene risks returned.",
    ready_no_scene_risks: "Qwen ready, no active scene risks for this frame.",
    unavailable:
      "Qwen unavailable from worker. Check RunPod Qwen model loading / GPU memory / reasoner env / worker logs.",
    timeout: "Qwen timed out for this frame. Qwen result: not received.",
    error: "Qwen error from worker. Qwen result: not received. Check RunPod worker logs.",
    disabled: "Qwen reasoning is disabled on the worker for this frame.",
  };
  const detectionPrefix = detectionOk
    ? ""
    : "Detection route: error or unavailable. No entities returned from the latest /detect. ";

  return {
    detectionOk,
    state,
    rawReasonerStatus: raw,
    normalizedReasonerStatus: norm,
    qwenResultReceived,
    qwenUnavailableWarning,
    sceneRisks,
    semanticCorrections: summary.reasoner.semanticCorrections,
    sceneContextPresent: summary.reasoner.sceneContextPresent,
    temporalReasoningPresent: summary.reasoner.temporalReasoningPresent,
    forceReasonSent: summary.forceReasonSent,
    message: detectionPrefix + messages[state],
  };
}

// Back-compat: existing tests/imports continue to work.
export interface ReasonerDiagnostic {
  detectionOk: boolean;
  qwenState: "ready" | "queued" | "unavailable" | "error" | "disabled";
  sceneRisks: number;
  message: string;
}

export function buildReasonerDiagnostic(probe: ReasonerProbe): ReasonerDiagnostic {
  const d = computeQwenDiagnostic(probe.summary);
  const qwenState: ReasonerDiagnostic["qwenState"] =
    d.state === "ready_with_scene_risks" || d.state === "ready_no_scene_risks"
      ? "ready"
      : d.state === "queued" || d.state === "running"
        ? "queued"
        : d.state === "error"
          ? "error"
          : d.state === "disabled" || d.state === "not_requested"
            ? "disabled"
            : "unavailable";
  // Preserve the original phrasing the legacy tests assert against.
  let message: string;
  if (!d.detectionOk) {
    message =
      "Detection route: error or unavailable. No entities returned from the latest /detect.";
  } else if (
    qwenState === "unavailable" ||
    qwenState === "error" ||
    qwenState === "disabled"
  ) {
    message = "Detection is working. Qwen reasoning is not available from the worker response.";
  } else if (qwenState === "queued") {
    message =
      "Detection is working. Qwen reasoning is queued/throttled and no current scene_risks were returned.";
  } else if (qwenState === "ready" && d.sceneRisks === 0) {
    message =
      "Detection and Qwen responded. Qwen returned no active scene risks for the latest frame.";
  } else {
    message = `Detection working. Qwen ${qwenState}, scene_risks: ${d.sceneRisks}.`;
  }
  return { detectionOk: d.detectionOk, qwenState, sceneRisks: d.sceneRisks, message };
}

// ── UI ──────────────────────────────────────────────────────────────────────

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

/** PURE: render the multi-line "Route status" block for Probe + dry-run. */
export function formatRouteStatus(
  s: DetectResponseSummary,
  d: QwenDiagnostic,
): string {
  return [
    `Detection route: ${d.detectionOk ? "working" : "error"}`,
    `Detector backend: ${s.gateway.backend ?? "—"}`,
    `Detector model: ${s.gateway.model ?? "—"}`,
    `Detected entities: ${s.detection.entities}`,
    "",
    `Risk schema: ${s.riskAwareFieldsPresent ? "present" : "absent"}`,
    `Raw risks: ${s.risk.risks}`,
    `Scene risks: ${s.risk.sceneRisks}`,
    `Linkable scene risks: ${
      s.linkability.withLinkedEntityId +
      s.linkability.withInvolvedDetectionIds +
      s.linkability.withInvolvedTrackIds +
      s.linkability.withBboxOrRegion
    }`,
    "",
    `Qwen route: ${d.state}`,
    `Qwen result received: ${d.qwenResultReceived ? "yes" : "no"}`,
    `Scene context: ${d.sceneContextPresent ? "yes" : "no"}`,
    `Semantic corrections: ${d.semanticCorrections}`,
    `Temporal reasoning: ${d.temporalReasoningPresent ? "yes" : "no"}`,
    "",
    `raw_reasoner_status: ${d.rawReasonerStatus ?? "missing"}`,
    `normalized_reasoner_status: ${d.normalizedReasonerStatus ?? "missing"}`,
    `qwen_result_received: ${d.qwenResultReceived ? "yes" : "no"}`,
    `qwen_unavailable_warning: ${d.qwenUnavailableWarning ? "yes" : "no"}`,
    `manual force_reason sent: ${d.forceReasonSent ? "yes" : "no"}`,
  ].join("\n");
}

export function ReasonerContractProbe({
  parsedRisk,
  rawResp,
  status,
  localAlertsEnabled,
  riskLinkedEntityCount,
  riskLinkedPoseCount,
  forceReasonSent,
}: {
  parsedRisk: ParsedDetectRisk | null;
  rawResp: unknown;
  status: BackendStatus | null;
  localAlertsEnabled?: boolean;
  riskLinkedEntityCount?: number;
  riskLinkedPoseCount?: number;
  forceReasonSent?: boolean;
}) {
  const probe = buildReasonerProbe(parsedRisk, rawResp, status, { forceReasonSent });
  const s = probe.summary;
  const diag = computeQwenDiagnostic(s);
  const visibleSource = localAlertsEnabled ? "legacy_local_alerts" : "worker_scene_risks";
  const perceptionBackend = s.gateway.backend ?? status?.backend ?? null;
  const perceptionModel = s.gateway.model ?? status?.model ?? null;
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
          {s.risk.degradationMode && (
            <Row label="degradation_mode" value={s.risk.degradationMode} />
          )}
        </Section>
        <Section title="Reasoner">
          <Row label="raw_reasoner_status" value={diag.rawReasonerStatus ?? "missing"} />
          <Row label="normalized" value={diag.normalizedReasonerStatus ?? "missing"} />
          <Row label="qwen_state" value={diag.state} />
          <Row
            label="qwen_result_received"
            value={diag.qwenResultReceived ? "yes" : "no"}
          />
          <Row
            label="qwen_unavailable_warning"
            value={diag.qwenUnavailableWarning ? "yes" : "no"}
          />
          <Row label="scene_context" value={s.reasoner.sceneContextPresent ? "yes" : "no"} />
          <Row label="semantic_corrections" value={s.reasoner.semanticCorrections} />
          <Row
            label="temporal_reasoning"
            value={s.reasoner.temporalReasoningPresent ? "yes" : "no"}
          />
          <Row label="force_reason sent" value={diag.forceReasonSent ? "yes" : "no"} />
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
        <pre className="whitespace-pre-wrap text-foreground/90">{formatRouteStatus(s, diag)}</pre>
        <div className="text-foreground">{diag.message}</div>
        <div className={probe.endToEndWorking ? "text-emerald-300" : "text-muted-foreground"}>
          End-to-end scene reasoning: {probe.endToEndWorking ? "working" : "not confirmed"}
        </div>
        <div className={diag.qwenResultReceived ? "text-emerald-300" : "text-muted-foreground"}>
          Qwen contribution:{" "}
          {diag.qwenResultReceived ? "detected" : "not detected in latest response"}
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
