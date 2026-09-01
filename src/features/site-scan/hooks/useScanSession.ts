/**
 * useScanSession — drives capture against the live <video>.
 *
 * Every ~100 ms while capturing: grab a 64×48 grey thumbnail → offer it to the
 * pure CaptureScheduler (with the latest IMU/compass samples) → if kept, draw
 * the full-res frame to an offscreen canvas, encode JPEG, and hand it to a
 * bounded upload queue (retries with backoff; the scan never blocks on a
 * failed upload). `finish()` drains the queue and asks the worker for a job.
 *
 * The <video> element belongs to the page's own `useCamera()` instance —
 * nothing here touches monitoring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SCAN_MIN_FRAMES,
  SCAN_UPLOAD_CONCURRENCY,
  SCAN_UPLOAD_RETRIES,
  SCAN_UPLOAD_RETRY_BASE_MS,
  type ScanMode,
} from "../config";
import { CaptureScheduler } from "../lib/captureEngine";
import { createFrameGrabber, type FrameGrabber } from "../lib/frameGrab";
import { finishScanSession, startScanSession, uploadScanFrame } from "../api/scanClient";
import type { CoverageScore, KeptFrame, ScanSessionInfo } from "../types";
import type { ScanSensors } from "./useScanSensors";

const TICK_MS = 100;

export interface ScanSessionState {
  session: ScanSessionInfo | null;
  capturing: boolean;
  keptFrames: number;
  uploadedFrames: number;
  failedFrames: number;
  pendingUploads: number;
  coverage: CoverageScore;
  coachLine: string;
  lastDrop: string | null;
  error: string | null;
}

export interface UseScanSession extends ScanSessionState {
  start: (mode: ScanMode) => Promise<void>;
  stop: () => void;
  /** Drains uploads, finishes the worker session; resolves the job id. */
  finish: () => Promise<{ jobId: string; frameCount: number }>;
  canFinish: boolean;
}

interface QueueItem {
  frame: KeptFrame;
  jpeg: Blob;
  attempt: number;
}

const EMPTY_COVERAGE: CoverageScore = {
  score: 0,
  keptFrames: 0,
  headingCoverage: 0,
  orbitDeg: 0,
  pathSeconds: 0,
};

export function useScanSession(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sensors: ScanSensors,
): UseScanSession {
  const [session, setSession] = useState<ScanSessionInfo | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [keptFrames, setKeptFrames] = useState(0);
  const [uploadedFrames, setUploadedFrames] = useState(0);
  const [failedFrames, setFailedFrames] = useState(0);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [coverage, setCoverage] = useState<CoverageScore>(EMPTY_COVERAGE);
  const [coachLine, setCoachLine] = useState("");
  const [lastDrop, setLastDrop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedulerRef = useRef<CaptureScheduler | null>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);
  const sessionRef = useRef<ScanSessionInfo | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const inFlightRef = useRef(0);
  const uploadedRef = useRef(0);
  const failedRef = useRef(0);
  const capturingRef = useRef(false);
  const grabbingRef = useRef(false);
  const drainWaitersRef = useRef<Array<() => void>>([]);

  const publishQueue = useCallback(() => {
    setPendingUploads(queueRef.current.length + inFlightRef.current);
    setUploadedFrames(uploadedRef.current);
    setFailedFrames(failedRef.current);
    if (queueRef.current.length === 0 && inFlightRef.current === 0) {
      const waiters = drainWaitersRef.current;
      drainWaitersRef.current = [];
      waiters.forEach((w) => w());
    }
  }, []);

  const pump = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    while (inFlightRef.current < SCAN_UPLOAD_CONCURRENCY && queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      inFlightRef.current++;
      publishQueue();
      uploadScanFrame(s, item.frame, item.jpeg)
        .then(() => {
          uploadedRef.current++;
        })
        .catch(() => {
          if (item.attempt < SCAN_UPLOAD_RETRIES) {
            const delay = SCAN_UPLOAD_RETRY_BASE_MS * 2 ** item.attempt;
            setTimeout(() => {
              queueRef.current.push({ ...item, attempt: item.attempt + 1 });
              pump();
            }, delay);
          } else {
            failedRef.current++;
          }
        })
        .finally(() => {
          inFlightRef.current--;
          publishQueue();
          pump();
        });
    }
  }, [publishQueue]);

  const waitForDrain = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (queueRef.current.length === 0 && inFlightRef.current === 0) return resolve();
        drainWaitersRef.current.push(resolve);
      }),
    [],
  );

  // -- capture tick ------------------------------------------------------------
  useEffect(() => {
    if (!capturing) return;
    const id = setInterval(() => {
      const video = videoRef.current;
      const sched = schedulerRef.current;
      const grabber = grabberRef.current;
      if (!video || !sched || !grabber || grabbingRef.current) return;
      sched.pushStability(sensors.stabilityRef.current);
      sched.pushOrientation(sensors.orientationRef.current);
      const gray = grabber.grabThumbnail(video);
      if (!gray) return;
      const decision = sched.offer({
        ts: performance.now(),
        gray,
        width: 64,
        height: 48,
      });
      setCoachLine(sched.coachLine());
      if (!decision.keep) {
        if (decision.reason !== "too_soon") setLastDrop(decision.reason);
        if (decision.reason === "cap_reached") {
          capturingRef.current = false;
          setCapturing(false);
        }
        return;
      }
      setLastDrop(null);
      setKeptFrames(sched.keptFrames.length);
      setCoverage(sched.coverage());
      grabbingRef.current = true;
      grabber
        .grabKeyframe(video)
        .then((jpeg) => {
          if (jpeg && decision.frame) {
            queueRef.current.push({ frame: decision.frame, jpeg, attempt: 0 });
            pump();
          }
        })
        .finally(() => {
          grabbingRef.current = false;
        });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [capturing, videoRef, sensors, pump]);

  const start = useCallback(async (mode: ScanMode) => {
    setError(null);
    try {
      const s = await startScanSession(mode);
      sessionRef.current = s;
      setSession(s);
      schedulerRef.current = new CaptureScheduler({ mode, maxFrames: s.maxFrames });
      grabberRef.current = createFrameGrabber();
      queueRef.current = [];
      inFlightRef.current = 0;
      uploadedRef.current = 0;
      failedRef.current = 0;
      setKeptFrames(0);
      setUploadedFrames(0);
      setFailedFrames(0);
      setPendingUploads(0);
      setCoverage(EMPTY_COVERAGE);
      setCoachLine(mode === "object" ? "Circle the machine slowly" : "Start walking slowly");
      capturingRef.current = true;
      setCapturing(true);
    } catch (e) {
      setError((e as Error).message || "start_failed");
    }
  }, []);

  const stop = useCallback(() => {
    capturingRef.current = false;
    setCapturing(false);
  }, []);

  const finish = useCallback(async () => {
    const s = sessionRef.current;
    const sched = schedulerRef.current;
    if (!s || !sched) throw new Error("no_session");
    stop();
    await waitForDrain();
    const frameCount = uploadedRef.current;
    if (frameCount < SCAN_MIN_FRAMES) {
      throw new Error(`too_few_frames:${frameCount}`);
    }
    const { jobId } = await finishScanSession(s);
    return { jobId, frameCount };
  }, [stop, waitForDrain]);

  useEffect(
    () => () => {
      capturingRef.current = false;
      grabberRef.current?.dispose();
    },
    [],
  );

  const canFinish = useMemo(
    () => !!session && uploadedFrames + pendingUploads >= SCAN_MIN_FRAMES,
    [session, uploadedFrames, pendingUploads],
  );

  return {
    session,
    capturing,
    keptFrames,
    uploadedFrames,
    failedFrames,
    pendingUploads,
    coverage,
    coachLine,
    lastDrop,
    error,
    start,
    stop,
    finish,
    canFinish,
  };
}
