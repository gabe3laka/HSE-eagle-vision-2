import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceHeading } from "../types";
import { circularEma } from "../lib/bearing";

const EMA_ALPHA = 0.15;

export function useDeviceOrientation({ enabled }: { enabled: boolean }): DeviceHeading & {
  requestPermission: () => Promise<void>;
} {
  const [state, setState] = useState<DeviceHeading>({
    headingDeg: null,
    accuracyDeg: null,
    source: null,
    permission: "unknown",
  });
  const smoothedRef = useRef<number | null>(null);

  const updateHeading = useCallback(
    (raw: number, accuracy: number | null, source: DeviceHeading["source"]) => {
      smoothedRef.current =
        smoothedRef.current === null ? raw : circularEma(smoothedRef.current, raw, EMA_ALPHA);
      setState((prev) => ({
        ...prev,
        headingDeg: smoothedRef.current,
        accuracyDeg: accuracy,
        source,
        permission: "granted",
      }));
    },
    [],
  );

  const requestPermission = useCallback(async () => {
    // iOS Safari requires explicit permission inside a user gesture
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DOE.requestPermission === "function") {
      const result = await DOE.requestPermission();
      setState((prev) => ({
        ...prev,
        permission: result === "granted" ? "granted" : "denied",
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") {
      setState((prev) => ({ ...prev, permission: "unsupported" }));
      return;
    }
    if (!("DeviceOrientationEvent" in window)) {
      setState((prev) => ({ ...prev, permission: "unsupported" }));
      return;
    }

    const screenAngle = () => screen.orientation?.angle ?? 0;

    const handleAbsolute = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      if (e.webkitCompassHeading != null) {
        updateHeading(
          e.webkitCompassHeading,
          (e as unknown as { webkitCompassAccuracy?: number }).webkitCompassAccuracy ?? null,
          "webkit",
        );
        return;
      }
      if (e.alpha != null && e.absolute) {
        const heading = (360 - e.alpha + screenAngle()) % 360;
        updateHeading(heading, null, "absolute");
      }
    };

    const handleRelative = (e: DeviceOrientationEvent) => {
      if (e.alpha != null) {
        const heading = (360 - e.alpha + screenAngle()) % 360;
        updateHeading(heading, null, "relative");
      }
    };

    let usingRelative = false;
    window.addEventListener("deviceorientationabsolute", handleAbsolute as EventListener);
    // Fallback to plain deviceorientation if absolute never fires
    const fallbackTimer = setTimeout(() => {
      if (smoothedRef.current === null) {
        usingRelative = true;
        window.addEventListener("deviceorientation", handleRelative as EventListener);
      }
    }, 2000);

    return () => {
      clearTimeout(fallbackTimer);
      window.removeEventListener("deviceorientationabsolute", handleAbsolute as EventListener);
      if (usingRelative)
        window.removeEventListener("deviceorientation", handleRelative as EventListener);
    };
  }, [enabled, updateHeading]);

  return { ...state, requestPermission };
}
