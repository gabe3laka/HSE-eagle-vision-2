import { useCallback, useEffect, useRef, useState } from "react";

export type CameraFacing = "environment" | "user";

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
  starting: boolean;
  error: string | null;
  deviceLabel: string | null;
  facing: CameraFacing;
  start: (facing?: CameraFacing) => Promise<void>;
  stop: () => void;
  flip: () => Promise<void>;
}

/**
 * Wraps getUserMedia for a phone camera. The phone is the camera —
 * the live stream feeds the detection engine. Supports flipping between
 * the rear (environment) and front (user) cameras.
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraFacing>("environment");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopStream();
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, [stopStream]);

  const start = useCallback(
    async (nextFacing?: CameraFacing) => {
      const target = nextFacing ?? facing;
      setError(null);
      setStarting(true);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API not available in this browser.");
        }
        stopStream();
        // Prefer a PORTRAIT capture on phones held upright, so the image we
        // receive matches the portrait UI instead of a wide 16:9 frame that has
        // to be letterboxed. Desktop / landscape keeps the usual 16:9. Devices
        // that ignore the orientation hint still work — the live view letterboxes
        // a wide stream inside the portrait shell.
        const wantPortrait =
          typeof window !== "undefined" &&
          window.innerWidth < 768 &&
          window.innerHeight >= window.innerWidth;
        const size = wantPortrait
          ? { width: { ideal: 720 }, height: { ideal: 1280 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } };
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: target }, ...size },
          audio: false,
        });
        streamRef.current = stream;
        setDeviceLabel(stream.getVideoTracks()[0]?.label ?? null);
        setFacing(target);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setActive(true);
      } catch (e) {
        setError(humanizeCameraError(e));
        setActive(false);
      } finally {
        setStarting(false);
      }
    },
    [facing, stopStream],
  );

  const flip = useCallback(async () => {
    await start(facing === "environment" ? "user" : "environment");
  }, [facing, start]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, active, starting, error, deviceLabel, facing, start, stop, flip };
}

function humanizeCameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission denied. Allow camera access and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera found on this device.";
  if (name === "NotReadableError") return "Camera is in use by another app.";
  return (e as { message?: string })?.message || "Could not start the camera.";
}
