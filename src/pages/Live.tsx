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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export default function Live() {
  const { videoRef, active, starting, error, facing, start: startCamera, flip } = useCamera();
  const { config } = useAlertSettings();
  const queryClient = useQueryClient();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [editingZones, setEditingZones] = useState(false);
  const { data: zones = [] } = useZones();
  const createZone = useCreateZone();
  const deleteZone = useDeleteZone();

  const captureSnapshot = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const maxW = 640;
    const scale = Math.min(1, maxW / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7));
  }, [videoRef]);

  const onIncidentSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
  }, [queryClient]);

  const { running, alerts, liveBoxes, stats, debug, perf, poseStatus, start, stop, dismissAlert } =
    useDetectionSession({
      video: videoRef.current,
      config,
      zones,
      captureSnapshot,
      onIncidentSaved,
    });

  const topAlert = useMemo(() => alerts.find((a) => a.isIncident) ?? null, [alerts]);

  const handleStart = useCallback(async () => {
    if (!active) await startCamera();
    await start();
  }, [active, startCamera, start]);

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
                Restricted zones
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
    </div>
  );
}
