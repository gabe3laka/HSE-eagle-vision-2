/**
 * ScanPage — the in-app Site / Object scan flow (route `/scan`).
 *
 * Mounts the UNMODIFIED <CameraView /> (no new props) with the page's own
 * `useCamera()` stream. The scan HUD is a SIBLING absolute layer this page
 * renders around CameraView — CameraView.tsx has zero diff. This page never
 * imports anything from `hse-monitoring`; monitoring lives in the Live route,
 * which unmounts (and stops its camera + detect loop) before `/scan` mounts.
 *
 * Flow: mode picker → "place the mat" checklist → capture (coach line, frame
 * counter, coverage bar, big stop) → finishing → job polling → result row.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, CheckCircle2, Loader2, Map as MapIcon, Square, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraView } from "@/components/live/CameraView";
import { useCamera } from "@/hooks/useCamera";
import { Link } from "@/lib/router-shim";
import {
  SCAN_MAT_SPEC,
  SCAN_MIN_FRAMES,
  isSiteScanEnabled,
  maxFramesFor,
  readScanApiUrl,
  type ScanMode,
} from "../config";
import { useScanSensors } from "../hooks/useScanSensors";
import { useScanSession } from "../hooks/useScanSession";
import { useRecentScans, useScanJobs } from "../hooks/useScanJobs";
import type { ScanJobResult, ScanPhase } from "../types";

const MAT_CHECKLIST = [
  "Print the Scan Mat (scripts/generate_scan_mat.py) at 100% — no scaling.",
  "Lay it FLAT on the floor where the scan starts. Tape the corners.",
  "Frame the whole mat in view for the first 3–5 seconds of the scan.",
  "Good, even light — avoid glare on the mat.",
];

export default function ScanPage() {
  if (!isSiteScanEnabled()) return <ScanDisabled />;
  return <ScanFlow />;
}

function ScanDisabled() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Site Scan is off for this build</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Set <code>VITE_SITE_SCAN_ENABLED=true</code> to enable the in-app Site &amp; Object scan
        flow. Monitoring is unaffected.
      </p>
      <Button asChild className="mt-4" variant="outline">
        <Link to="/live">Back to Live</Link>
      </Button>
    </div>
  );
}

function ScanFlow() {
  const camera = useCamera();
  const [mode, setMode] = useState<ScanMode>("site");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [finishError, setFinishError] = useState<string | null>(null);
  const sensors = useScanSensors(phase === "mat_check" || phase === "capturing");
  const scan = useScanSession(camera.videoRef, sensors);
  const jobs = useScanJobs();
  const recent = useRecentScans();
  const apiUrl = useMemo(() => readScanApiUrl(), []);

  // Job status → phase.
  useEffect(() => {
    const j = jobs.job;
    if (!j) return;
    if (j.status === "done") setPhase("done");
    else if (j.status === "error") setPhase("error");
    else setPhase(j.status);
  }, [jobs.job]);

  // Leaving the page stops the scan camera (own stream — never monitoring's).
  useEffect(() => () => camera.stop(), [camera]);

  const beginMatCheck = useCallback(async () => {
    setFinishError(null);
    jobs.reset();
    await sensors.requestPermissions();
    if (!camera.active) await camera.start("environment");
    setPhase("mat_check");
  }, [camera, jobs, sensors]);

  const beginCapture = useCallback(async () => {
    await scan.start(mode);
    setPhase("capturing");
  }, [scan, mode]);

  const finish = useCallback(async () => {
    setPhase("finishing");
    try {
      const { jobId, frameCount } = await scan.finish();
      if (scan.session) jobs.track(scan.session, jobId, frameCount);
      setPhase("queued");
    } catch (e) {
      const msg = (e as Error).message ?? "finish_failed";
      setFinishError(
        msg.startsWith("too_few_frames")
          ? `Need at least ${SCAN_MIN_FRAMES} uploaded frames (got ${msg.split(":")[1] ?? "0"}). Keep scanning.`
          : msg,
      );
      setPhase("capturing");
    }
  }, [scan, jobs]);

  const abort = useCallback(() => {
    scan.stop();
    jobs.reset();
    setPhase("idle");
    setFinishError(null);
  }, [scan, jobs]);

  const busy =
    phase === "finishing" ||
    phase === "queued" ||
    phase === "queued_waiting_idle" ||
    phase === "running";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-2 sm:p-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Scan</h1>
          <p className="text-xs text-muted-foreground">
            {apiUrl ? "Worker connected" : "Stub worker (no VITE_SCAN_API_URL) — canned results"}
          </p>
        </div>
        <ModePicker mode={mode} onChange={setMode} disabled={phase !== "idle"} />
      </header>

      {/* The camera card + the scan HUD as a SIBLING absolute layer. */}
      <div className="relative overflow-hidden rounded-xl">
        <CameraView
          videoRef={camera.videoRef}
          active={camera.active}
          starting={camera.starting}
          error={camera.error}
          boxes={[]}
          running={false}
          topAlert={null}
          language="en"
          facing={camera.facing}
          onEnable={() => camera.start("environment")}
          onFlip={camera.flip}
        />
        <ScanHud
          phase={phase}
          mode={mode}
          coachLine={scan.coachLine}
          keptFrames={scan.keptFrames}
          uploadedFrames={scan.uploadedFrames}
          pendingUploads={scan.pendingUploads}
          failedFrames={scan.failedFrames}
          maxFrames={scan.session?.maxFrames ?? maxFramesFor(mode)}
          coverage={scan.coverage.score}
          lastDrop={scan.lastDrop}
          canFinish={scan.canFinish}
          onFinish={finish}
          onAbort={abort}
        />
      </div>

      {(scan.error || finishError) && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {scan.error ?? finishError}
        </p>
      )}

      {phase === "idle" && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium">
            {mode === "site" ? "Scan a site" : "Scan a machine"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "site"
              ? "Walk the room slowly with the phone held steady. The result becomes a metric map for MultiSet VPS."
              : "Orbit one machine at 1–2 m, keeping it centred. The result becomes a MultiSet object anchor."}
          </p>
          <Button className="mt-3" onClick={beginMatCheck} disabled={camera.starting}>
            {camera.starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Start — place the mat
          </Button>
        </section>
      )}

      {phase === "mat_check" && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium">Place the Scan Mat</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            {MAT_CHECKLIST.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Mat v{SCAN_MAT_SPEC.version}: ChArUco {SCAN_MAT_SPEC.squaresX}×{SCAN_MAT_SPEC.squaresY},{" "}
            {SCAN_MAT_SPEC.squareLengthM * 1000} mm squares / {SCAN_MAT_SPEC.markerLengthM * 1000}{" "}
            mm markers, {SCAN_MAT_SPEC.dictionary}. Sensors: motion {sensors.motionPermission},
            compass {sensors.orientationPermission}.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={beginCapture} disabled={!camera.active}>
              Mat is in view — start capture
            </Button>
            <Button variant="ghost" onClick={abort}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {busy && <JobStatus phase={phase} jobId={jobs.job?.job_id ?? null} />}

      {(phase === "done" || phase === "error") && jobs.job && (
        <ResultCard
          ok={phase === "done"}
          mode={mode}
          result={jobs.job.result}
          error={jobs.job.error}
          saved={jobs.saved}
          saveError={jobs.saveError}
          onNew={abort}
        />
      )}

      {recent.data && recent.data.length > 0 && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium">Recent scans</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {recent.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {r.type} · {r.frame_count} frames · {r.mat_detected ? "metric" : "unscaled"}
                  {r.map_code ? ` · ${r.map_code}` : ""}
                  {r.object_anchor_id ? ` · ${r.object_anchor_id}` : ""}
                </span>
                <span className={r.status === "done" ? "text-emerald-500" : "text-destructive"}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: ScanMode;
  onChange: (m: ScanMode) => void;
  disabled: boolean;
}) {
  return (
    <div
      className="flex rounded-lg border border-border p-0.5"
      role="radiogroup"
      aria-label="Scan mode"
    >
      {(["site", "object"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          disabled={disabled}
          onClick={() => onChange(m)}
          className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          } disabled:opacity-60`}
        >
          {m === "site" ? <MapIcon className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
          {m === "site" ? "Site" : "Object"}
        </button>
      ))}
    </div>
  );
}

interface HudProps {
  phase: ScanPhase;
  mode: ScanMode;
  coachLine: string;
  keptFrames: number;
  uploadedFrames: number;
  pendingUploads: number;
  failedFrames: number;
  maxFrames: number;
  coverage: number;
  lastDrop: string | null;
  canFinish: boolean;
  onFinish: () => void;
  onAbort: () => void;
}

/** Sibling overlay: pointer-events pass through except on the controls. */
function ScanHud(p: HudProps) {
  if (p.phase !== "capturing" && p.phase !== "finishing") return null;
  const pct = Math.round(p.coverage * 100);
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white backdrop-blur">
          <div className="font-medium">{p.coachLine}</div>
          {p.lastDrop && <div className="text-[10px] opacity-70">dropped: {p.lastDrop}</div>}
        </div>
        <div className="rounded-md bg-black/60 px-2.5 py-1.5 text-right text-xs tabular-nums text-white backdrop-blur">
          <div>
            {p.keptFrames}/{p.maxFrames} frames
          </div>
          <div className="text-[10px] opacity-70">
            {p.uploadedFrames} sent · {p.pendingUploads} pending
            {p.failedFrames > 0 ? ` · ${p.failedFrames} failed` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/25">
          <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[11px] text-white/90">
          {p.mode === "object" ? "Orbit" : "Walkthrough"} {pct}% · min {SCAN_MIN_FRAMES} frames
        </div>
        <div className="pointer-events-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-white" onClick={p.onAbort}>
            Abort
          </Button>
          <button
            type="button"
            onClick={p.onFinish}
            disabled={!p.canFinish || p.phase === "finishing"}
            aria-label="Stop and finish scan"
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600 text-white shadow-lg disabled:opacity-50"
          >
            {p.phase === "finishing" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Square className="h-6 w-6 fill-current" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function JobStatus({ phase, jobId }: { phase: ScanPhase; jobId: string | null }) {
  const label: Record<string, string> = {
    finishing: "Uploading remaining frames…",
    queued: "Queued for reconstruction",
    queued_waiting_idle: "Waiting — live monitoring has the GPU (monitoring always wins)",
    running: "Reconstructing (this takes minutes)…",
  };
  return (
    <section className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label[phase] ?? phase}</span>
      {jobId && <span className="ml-auto text-xs text-muted-foreground">{jobId}</span>}
    </section>
  );
}

function ResultCard({
  ok,
  mode,
  result,
  error,
  saved,
  saveError,
  onNew,
}: {
  ok: boolean;
  mode: ScanMode;
  result: ScanJobResult | null;
  error: string | null;
  saved: boolean;
  saveError: string | null;
  onNew: () => void;
}) {
  return (
    <section className="rounded-xl border border-border p-4 text-sm">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <XCircle className="h-5 w-5 text-destructive" />
        )}
        <h2 className="font-medium">{ok ? "Scan complete" : "Scan failed"}</h2>
      </div>
      {result && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Metric scale</dt>
          <dd>
            {result.metric ? `yes (${result.mat_frames} mat frames)` : "NO — mat never detected"}
          </dd>
          <dt className="text-muted-foreground">Reprojection error</dt>
          <dd>{result.reproj_error ?? "—"}</dd>
          <dt className="text-muted-foreground">Artifact</dt>
          <dd className="truncate">
            {result.artifact_url ? (
              <a className="underline" href={result.artifact_url} target="_blank" rel="noreferrer">
                download for MultiSet
              </a>
            ) : (
              "—"
            )}
          </dd>
          {mode === "site" && (
            <>
              <dt className="text-muted-foreground">map_code</dt>
              <dd>{result.map_code ?? "pending manual ingestion"}</dd>
            </>
          )}
          {mode === "object" && (
            <>
              <dt className="text-muted-foreground">object anchor</dt>
              <dd>{result.object_anchor_id ?? "pending manual ingestion"}</dd>
            </>
          )}
        </dl>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {saved ? "Saved to scan_sessions." : saveError ? `Not saved: ${saveError}` : "Saving…"}
      </p>
      <Button className="mt-3" variant="outline" onClick={onNew}>
        New scan
      </Button>
    </section>
  );
}
