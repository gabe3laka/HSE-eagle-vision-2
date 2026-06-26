import { useEffect, useRef, useState } from "react";

const ACCELERATION_THRESHOLD = 2.5;
const SMOOTHING_WINDOW = 4;

export interface CameraStability {
  isMoving: boolean;
  accelerationMagnitude: number | null;
  permission: "unknown" | "granted" | "denied" | "unsupported";
}

/**
 * DeviceMotion-based camera stability gate.
 *
 * When the device accelerates beyond the threshold after a calibration was
 * established, projection should be marked stale. Consumers receive
 * `isMoving: true` and can act accordingly.
 *
 * Critical for handheld phones: marker calibration degrades quickly on movement.
 */
export function useCameraStability(enabled: boolean): CameraStability {
  const [isMoving, setIsMoving] = useState(false);
  const [accelerationMagnitude, setAccelerationMagnitude] = useState<number | null>(null);
  const [permission, setPermission] = useState<CameraStability["permission"]>("unknown");
  const windowRef = useRef<number[]>([]);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (typeof DeviceMotionEvent === "undefined") {
      setPermission("unsupported");
      return;
    }

    function handleMotion(e: DeviceMotionEvent) {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;

      const magnitude = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);

      windowRef.current.push(magnitude);
      if (windowRef.current.length > SMOOTHING_WINDOW) {
        windowRef.current.shift();
      }
      const avg = windowRef.current.reduce((a, b) => a + b, 0) / windowRef.current.length;

      const userFacing = avg - 9.8;
      setAccelerationMagnitude(Math.abs(userFacing));

      const moving = Math.abs(userFacing) > ACCELERATION_THRESHOLD;
      setIsMoving(moving);

      if (moving) {
        if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
        staleTimerRef.current = setTimeout(() => setIsMoving(false), 2000);
      }
    }

    async function requestAndListen() {
      try {
        if (
          typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
            .requestPermission === "function"
        ) {
          const result = await (
            DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
          ).requestPermission();
          if (result !== "granted") {
            setPermission("denied");
            return;
          }
        }
        setPermission("granted");
        window.addEventListener("devicemotion", handleMotion, { passive: true });
      } catch {
        setPermission("denied");
      }
    }

    requestAndListen();

    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [enabled]);

  return { isMoving, accelerationMagnitude, permission };
}
