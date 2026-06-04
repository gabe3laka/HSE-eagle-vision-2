import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
  starting: boolean;
  error: string | null;
  deviceLabel: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Wraps getUserMedia for a phone's rear camera. The phone is the camera —
 * the live stream feeds the detection engine.
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setDeviceLabel(stream.getVideoTracks()[0]?.label ?? null);
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
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, active, starting, error, deviceLabel, start, stop };
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
