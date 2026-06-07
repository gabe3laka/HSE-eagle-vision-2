import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Shapes, Trash2 } from "lucide-react";
import { useCamera } from "@/hooks/useCamera";
import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useDetectionSession } from "@/hooks/useDetectionSession";
import { useZones, useCreateZone, useDeleteZone } from "@/hooks/useZones";
import { CameraView } from "@/components/live/CameraView";
import { AlertFeed } from "@/components/live/AlertFeed";
import { SessionControls } from "@/components/live/SessionControls";
import { PoseDebugPanel } from "@/components/live/PoseDebugPanel";
import type { BackendStatus } from "@/lib/detection/backendVisionDetector";
import type { BackendEntity, BackendPose } from "@/lib/detection/types";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/own-client";
import { BUILD_MARKER, buildTime } from "@/lib/buildInfo";

/** Readout of the EdgeCrafter backend — HTTP dry-run or WebSocket stream (beta). */
function BackendDebugPanel({
  status,
  entities,
  poses,
}: {
  status: BackendStatus;
  entities: BackendEntity[];
  poses: BackendPose[];
}) {
  const firstEntity = entities[0];
  const firstPose = poses[0];
  const isStream = status.transport === "ws";
  const fmt = (v?: number | null) => (v != null ? `${v}` : "—");
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">
          backend · {isStream ? (status.streamState ?? status.state) : status.state}
        </span>
        <span className={status.inFlight ? "text-amber-500" : "text-muted-foreground"}>
          {status.inFlight ? "in-flight" : "idle"} · {status.entityCount} ent · {status.poseCount}{" "}
          pose
        </span>
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          transport:{" "}
          <span className="text-foreground">
            {isStream ? "WebSocket stream (beta)" : "HTTP dry-run"}
          </span>
        </div>
        <div>
          backend: {status.backend ?? "—"} · tasks: {status.tasks?.join(",") ?? "—"}
        </div>
        <div>
          detector: {isStream ? "BackendVisionStreamDetector" : "BackendVisionDetector"} · mode{" "}
          {isStream ? "backend-edgecrafter-stream" : "backend-deimv2"}
        </div>
        {isStream ? (
          <>
            <div>
              frames sent: {status.requestCount} · vision msgs: {status.responseCount} · dropped:{" "}
              {fmt(status.droppedFrames)} · queue: {fmt(status.currentQueueDepth)}
            </div>
            <div>
              received: {fmt(status.receivedFps)} fps · processed: {fmt(status.processedFps)} fps
            </div>
            <div>
              avg inference:{" "}
              {status.lastInferenceMs != null ? `${Math.round(status.lastInferenceMs)} ms` : "—"} ·
              avg latency:{" "}
              {status.avgEndToEndLatencyMs != null ? `${status.avgEndToEndLatencyMs} ms` : "—"}
            </div>
          </>
        ) : (
          <>
            <div>
              requests: {status.requestCount} · responses: {status.responseCount}
            </div>
            <div>
              video: {status.videoWidth}×{status.videoHeight} · jpeg b64: {status.lastB64Bytes} B
            </div>
            <div>
              last inference:{" "}
              {status.lastInferenceMs != null ? `${Math.round(status.lastInferenceMs)} ms` : "—"}
            </div>
          </>
        )}
        <div>model: {status.model ?? "—"}</div>
        <div>
          last success:{" "}
          {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleTimeString() : "—"}
        </div>
        {firstEntity && (
          <div className="text-teal-500">
            ent#0 {firstEntity.label} {Math.round(firstEntity.confidence * 100)}% · x
            {firstEntity.bbox.x.toFixed(2)} y{firstEntity.bbox.y.toFixed(2)} w
            {firstEntity.bbox.w.toFixed(2)} h{firstEntity.bbox.h.toFixed(2)}
          </div>
        )}
        {firstPose && (
          <div className="text-fuchsia-500">
            pose#0 {Math.round(firstPose.confidence * 100)}% · {firstPose.keypoints.length} kpts
          </div>
        )}
        {status.error && <div className="text-red-500">error: {status.error}</div>}
        {status.lastRawResponse && (
          <div className="truncate" title={status.lastRawResponse}>
            raw: {status.lastRawResponse}
          </div>
        )}
      </div>
      {/* Transport note. */}
      {isStream ? (
        <div className="mt-2 border-t border-border/60 pt-2 text-[10px] not-italic text-muted-foreground">
          <span className="font-semibold text-foreground">WebSocket stream (beta).</span>{" "}
          Authenticated with a short-lived Supabase-issued session token (<code>?token=</code>); the
          gateway URL comes from the session (override with{" "}
          <code>VITE_EDGECRAFT_STREAM_WS_URL</code>). The browser never holds the RunPod API key or
          the signing secret. HTTP dry-run remains available as a fallback.
        </div>
      ) : (
        <div className="mt-2 border-t border-border/60 pt-2 text-[10px] not-italic text-muted-foreground">
          <span className="font-semibold text-foreground">HTTP dry-run mode.</span> Frames go to the
          worker over HTTP via the Supabase <code>deimv2-proxy</code>. The worker&rsquo;s{" "}
          <code>/ws/echo</code> is only a connectivity probe; the real <code>/ws/vision</code>{" "}
          streaming route is the separate &ldquo;EdgeCrafter stream — beta&rdquo; mode.
        </div>
      )}
    </div>
  );
}

export default function Live() {
  const { videoRef, active, starting, error, facing, start: startCamera, flip } = useCamera();
  const { config } = useAlertSettings();
  const queryClient = useQueryClient();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [editingZones, setEditingZones] = useState(false);
  const { data: zones = [] } = useZones();
  const createZone = useCreateZone();
  const deleteZone = useDeleteZone();
  const [backendTest, setBackendTest] = useState<string | null>(null);
  const [backendTestImg, setBackendTestImg] = useState<string | null>(null);
  const [backendTesting, setBackendTesting] = useState(false);

  const onIncidentSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
  }, [queryClient]);

  const {
    running,
    alerts,
    liveBoxes,
    stats,
    debug,
    perf,
    poseStatus,
    backendStatus,
    backendEntities,
    backendPoses,
    start,
    stop,
    dismissAlert,
  } = useDetectionSession({
    video: videoRef.current,
    config,
    zones,
    onIncidentSaved,
  });

  const topAlert = useMemo(() => alerts.find((a) => a.isIncident) ?? null, [alerts]);

  // Both EdgeCrafter modes (HTTP dry-run + WebSocket stream beta) share the same
  // dry-run overlays + debug panel. The single-frame test button is HTTP-only.
  const isBackendMode =
    config.detectionMode === "backend-deimv2" ||
    config.detectionMode === "backend-edgecrafter-stream";
  const isHttpDryRun = config.detectionMode === "backend-deimv2";

  const handleStart = useCallback(async () => {
    if (!active) await startCamera();
    await start();
  }, [active, startCamera, start]);

  // Dev/debug: capture the current frame and send one request to deimv2-proxy,
  // showing the raw response. Dry-run only — never enters the risk engine.
  const testBackendFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setBackendTest("No active video frame — enable the camera first.");
      return;
    }
    setBackendTesting(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setBackendTest("Canvas 2D context unavailable.");
        return;
      }
      ctx.drawImage(video, 0, 0, 640, 480);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setBackendTestImg(dataUrl); // preview the exact frame we send
      const image_b64 = dataUrl.split(",")[1];
      const { data, error } = await supabase.functions.invoke("deimv2-proxy", {
        body: { image_b64, conf: 0.15, img_size: 640, classes: null },
      });
      setBackendTest(JSON.stringify(error ?? data, null, 2));
    } catch (e) {
      setBackendTest(e instanceof Error ? e.message : String(e));
    } finally {
      setBackendTesting(false);
    }
  }, [videoRef]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <header>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Live monitoring</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          The phone is the camera. Hazards are detected on-device and surfaced instantly — nothing
          is recorded unless an incident is saved.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <CameraView
            videoRef={videoRef}
            active={active}
            starting={starting}
            error={error}
            boxes={liveBoxes}
            running={running}
            topAlert={topAlert}
            language={config.language}
            facing={facing}
            onEnable={() => startCamera()}
            onFlip={flip}
            poseStatus={poseStatus}
            debug={debug}
            showSkeleton={import.meta.env.DEV}
            backendEntities={backendEntities as BackendEntity[]}
            backendPoses={backendPoses as BackendPose[]}
            backendDryRun={isBackendMode}
            zones={zones}
            editingZones={editingZones}
            onZoneCreate={(points) =>
              createZone.mutate({
                kind: "restricted",
                label: `Zone ${zones.length + 1}`,
                points,
              })
            }
          />
          <SessionControls
            cameraActive={active}
            running={running}
            stats={stats}
            onStart={handleStart}
            onStop={stop}
          />

          {/* Restricted-zone editor */}
          <div className="rounded-xl border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Shapes className="h-4 w-4 text-primary" />
                Hazard zones
                <span className="text-xs text-muted-foreground">({zones.length})</span>
              </span>
              <Button
                size="sm"
                variant={editingZones ? "default" : "secondary"}
                onClick={() => setEditingZones((v) => !v)}
                disabled={!active}
              >
                {editingZones ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> Done
                  </>
                ) : (
                  "Edit zones"
                )}
              </Button>
            </div>
            {editingZones && (
              <p className="mt-2 text-xs text-muted-foreground">
                Drag a box on the camera to mark an off-limits area. A stable person who steps
                inside raises a restricted-zone alert (needs the “Restricted-zone entry” hazard
                enabled, in Pose mode).
              </p>
            )}
            {zones.length > 0 && (
              <ul className="mt-2 space-y-1">
                {zones.map((z) => (
                  <li
                    key={z.id}
                    className="flex items-center justify-between rounded-lg bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="truncate">{z.label ?? "Zone"}</span>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => deleteZone.mutate(z.id)}
                      aria-label="Delete zone"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Mobile-only alerts trigger */}
          <div className="lg:hidden">
            <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <BellRing className="h-4 w-4 text-primary" />
                    Live alerts
                  </span>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                    {alerts.length}
                  </span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[80vh] rounded-t-2xl p-4">
                <AlertFeed
                  alerts={alerts}
                  running={running}
                  language={config.language}
                  onDismiss={dismissAlert}
                />
              </SheetContent>
            </Sheet>
          </div>

          {import.meta.env.DEV && debug && <PoseDebugPanel debug={debug} perf={perf} />}

          {/* EdgeCrafter dry-run debug — visible in either EdgeCrafter mode (HTTP
              dry-run or WebSocket stream beta), not gated to dev builds so the
              pipeline is observable in the deployed app. Dry-run only: no alerts,
              no incidents. */}
          {isBackendMode && (
            <div className="space-y-2">
              {backendStatus != null && (
                <BackendDebugPanel
                  status={backendStatus as BackendStatus}
                  entities={backendEntities as BackendEntity[]}
                  poses={backendPoses as BackendPose[]}
                />
              )}
              {isHttpDryRun && (
                <div className="rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      EdgeCrafter dry-run · single-frame test
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={testBackendFrame}
                      disabled={!active || backendTesting}
                    >
                      {backendTesting ? "Testing…" : "Test EdgeCrafter frame"}
                    </Button>
                  </div>
                  {(backendTestImg || backendTest) && (
                    <div className="mt-2 space-y-2">
                      {backendTestImg && (
                        <div>
                          <div className="mb-1 text-[10px] text-muted-foreground">
                            captured frame sent to /detect (check it isn't black/blank/rotated):
                          </div>
                          <img
                            src={backendTestImg}
                            alt="captured frame"
                            className="max-h-40 rounded border border-border"
                          />
                        </div>
                      )}
                      {backendTest && (
                        <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-snug">
                          {backendTest}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="glass-panel hidden rounded-2xl border p-4 lg:sticky lg:top-6 lg:block lg:h-[calc(100vh-9rem)]">
          <AlertFeed
            alerts={alerts}
            running={running}
            language={config.language}
            onDismiss={dismissAlert}
          />
        </aside>
      </div>

      <p className="pt-1 text-center text-[10px] text-muted-foreground/60">
        build {BUILD_MARKER} · {buildTime()} · {import.meta.env.MODE} · mode {config.detectionMode}
      </p>
    </div>
  );
}
