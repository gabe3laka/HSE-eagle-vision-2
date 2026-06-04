import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCamera } from "@/hooks/useCamera";
import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useDetectionSession } from "@/hooks/useDetectionSession";
import { CameraView } from "@/components/live/CameraView";
import { AlertFeed } from "@/components/live/AlertFeed";
import { SessionControls } from "@/components/live/SessionControls";
import { PoseDebugPanel } from "@/components/live/PoseDebugPanel";

export default function Live() {
  const { videoRef, active, starting, error, facing, start: startCamera, flip } = useCamera();
  const { config } = useAlertSettings();
  const queryClient = useQueryClient();

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

  const { running, alerts, liveBoxes, stats, debug, start, stop, dismissAlert } =
    useDetectionSession({
      video: videoRef.current,
      config,
      captureSnapshot,
      onIncidentSaved,
    });

  // most recent high/critical alert drives the on-camera banner
  const topAlert = useMemo(() => alerts.find((a) => a.isIncident) ?? null, [alerts]);

  const handleStart = useCallback(async () => {
    if (!active) await startCamera();
    await start();
  }, [active, startCamera, start]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold">Live monitoring</h1>
        <p className="text-sm text-muted-foreground">
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
            onEnable={startCamera}
          />
          <SessionControls
            cameraActive={active}
            running={running}
            stats={stats}
            onStart={handleStart}
            onStop={stop}
          />
          {import.meta.env.DEV && debug && <PoseDebugPanel debug={debug} />}
        </div>

        <aside className="glass-panel rounded-2xl border p-4 lg:sticky lg:top-6 lg:h-[calc(100vh-9rem)]">
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
