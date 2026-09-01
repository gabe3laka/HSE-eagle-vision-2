/**
 * useScanSensors — IMU + compass feed for the capture engine.
 *
 * Deliberately re-implements the SAME event plumbing as the shared-vision
 * `useCameraStability` / `useDeviceOrientation` hooks (DeviceMotion window,
 * webkitCompassHeading → absolute alpha → relative alpha fallback) instead of
 * importing them, so the scan feature has no dependency on monitoring code.
 * Samples are pushed straight into refs (no React state churn per event); the
 * consumer reads the latest sample when it offers a frame.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrientationSample, StabilitySample } from "../types";

const ACCELERATION_THRESHOLD = 2.5; // m/s² above gravity → "moving"
const SMOOTHING_WINDOW = 4;
const MOVING_HOLD_MS = 400;

export type SensorPermission = "unknown" | "granted" | "denied" | "unsupported";

export interface ScanSensors {
  /** Latest stability sample (stable ref, mutated in place). */
  stabilityRef: React.RefObject<StabilitySample>;
  /** Latest orientation sample (stable ref, mutated in place). */
  orientationRef: React.RefObject<OrientationSample>;
  motionPermission: SensorPermission;
  orientationPermission: SensorPermission;
  /** Must be called from a user gesture on iOS Safari. */
  requestPermissions: () => Promise<void>;
}

type Requestable = { requestPermission?: () => Promise<"granted" | "denied"> };

export function useScanSensors(enabled: boolean): ScanSensors {
  const stabilityRef = useRef<StabilitySample>({
    ts: 0,
    isMoving: false,
    accelerationMagnitude: null,
  });
  const orientationRef = useRef<OrientationSample>({ ts: 0, headingDeg: null, pitchDeg: null });
  const [motionPermission, setMotionPermission] = useState<SensorPermission>("unknown");
  const [orientationPermission, setOrientationPermission] = useState<SensorPermission>("unknown");
  const windowRef = useRef<number[]>([]);
  const lastMovingRef = useRef<number>(0);

  const requestPermissions = useCallback(async () => {
    if (typeof window === "undefined") return;
    const DME = (window as unknown as { DeviceMotionEvent?: Requestable }).DeviceMotionEvent;
    const DOE = (window as unknown as { DeviceOrientationEvent?: Requestable })
      .DeviceOrientationEvent;
    try {
      if (DME && typeof DME.requestPermission === "function") {
        setMotionPermission((await DME.requestPermission()) === "granted" ? "granted" : "denied");
      }
      if (DOE && typeof DOE.requestPermission === "function") {
        setOrientationPermission(
          (await DOE.requestPermission()) === "granted" ? "granted" : "denied",
        );
      }
    } catch {
      setMotionPermission((p) => (p === "unknown" ? "denied" : p));
      setOrientationPermission((p) => (p === "unknown" ? "denied" : p));
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    // -- motion --------------------------------------------------------------
    if (!("DeviceMotionEvent" in window)) {
      setMotionPermission("unsupported");
    } else {
      setMotionPermission((p) => (p === "unknown" ? "granted" : p));
    }
    const onMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const magnitude = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      const w = windowRef.current;
      w.push(magnitude);
      if (w.length > SMOOTHING_WINDOW) w.shift();
      const avg = w.reduce((a, b) => a + b, 0) / w.length;
      const userFacing = Math.abs(avg - 9.8);
      const now = performance.now();
      const moving = userFacing > ACCELERATION_THRESHOLD;
      if (moving) lastMovingRef.current = now;
      stabilityRef.current = {
        ts: now,
        isMoving: moving || now - lastMovingRef.current < MOVING_HOLD_MS,
        accelerationMagnitude: userFacing,
      };
    };

    // -- orientation ---------------------------------------------------------
    if (!("DeviceOrientationEvent" in window)) {
      setOrientationPermission("unsupported");
    } else {
      setOrientationPermission((p) => (p === "unknown" ? "granted" : p));
    }
    const screenAngle = () => screen.orientation?.angle ?? 0;
    const setHeading = (heading: number, pitch: number | null) => {
      orientationRef.current = {
        ts: performance.now(),
        headingDeg: ((heading % 360) + 360) % 360,
        pitchDeg: pitch,
      };
    };
    let sawAbsolute = false;
    const onAbsolute = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      if (e.webkitCompassHeading != null) {
        sawAbsolute = true;
        setHeading(e.webkitCompassHeading, e.beta ?? null);
        return;
      }
      if (e.alpha != null && e.absolute) {
        sawAbsolute = true;
        setHeading(360 - e.alpha + screenAngle(), e.beta ?? null);
      }
    };
    const onRelative = (e: DeviceOrientationEvent) => {
      if (e.alpha != null) setHeading(360 - e.alpha + screenAngle(), e.beta ?? null);
    };

    window.addEventListener("devicemotion", onMotion, { passive: true });
    window.addEventListener("deviceorientationabsolute", onAbsolute as EventListener);
    let usingRelative = false;
    const fallback = setTimeout(() => {
      if (!sawAbsolute) {
        usingRelative = true;
        window.addEventListener("deviceorientation", onRelative as EventListener);
      }
    }, 2000);

    return () => {
      clearTimeout(fallback);
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientationabsolute", onAbsolute as EventListener);
      if (usingRelative)
        window.removeEventListener("deviceorientation", onRelative as EventListener);
    };
  }, [enabled]);

  return {
    stabilityRef,
    orientationRef,
    motionPermission,
    orientationPermission,
    requestPermissions,
  };
}
