# Pose pipeline (Pose-beta) — reliability, throughput, debug

The in-browser **MediaPipe Pose Landmarker** is SafeLens's current body/posture
and keypoint layer. Pose models hallucinate weak landmarks on background texture,
so Pose-beta wraps the model in a **quality gate** and a **stability gate** before
anything can become a hazard. This is what stops empty/background scenes from
drawing phantom boxes.

## Pipeline (each processed frame)

```
video frame
  → detectForVideo()            (MediaPipe, up to MAX_POSES = 4 raw poses)
  → personBBox()                (null when no landmark is visible — no fake box)
  → computePoseQuality()        (visibility + core landmarks + bbox sanity)
        rejected → debug only (skeleton overlay shows the reason)
        accepted ↓
  → PersonTracker.update()      (stable ids p1,p2…; framesSeen, jumpScore)
  → stability gate              (framesSeen ≥ MIN_STABLE_FRAMES before emitting)
  → unsafe_lift / person_proximity observations
  → RiskEngine                  (timing/escalation, per-trackKey)
```

Only **accepted** poses enter the tracker, and only **accepted + stable** tracks
emit `unsafe_lift` / `person_proximity`. A one-frame or low-quality pose can never
create an alert, incident, or DB row.

### Quality gate (`computePoseQuality`, `poseGeometry.ts`)
Rejects a raw pose when it has too few visible landmarks, too few of the 6 **core**
landmarks (shoulders/hips/knees), low core visibility, or an unusable bbox
(missing / too tiny / too large / unrealistic aspect / mostly at the frame edge
with weak visibility). `unsafe_lift` additionally requires the shoulder+hip+knee
"required lift landmarks". Thresholds live in `POSE_THRESHOLDS`.

### MediaPipe confidence thresholds (`realPoseDetector.ts`)
Set explicitly (default ~0.7, tunable): `minPoseDetectionConfidence`,
`minPosePresenceConfidence`, `minTrackingConfidence`. Stricter values mean fewer
hallucinated/background poses but require a more clearly visible person. The
MediaPipe default of 0.5 was a source of phantom boxes. `MAX_POSES` stays **4**
(multi-person); segmentation masks stay off.

## Frame scheduling (`useDetectionSession.ts`)
Detection runs on **actual video frames** via
`HTMLVideoElement.requestVideoFrameCallback()` when supported (Chrome/Safari),
with a **timer fallback** (e.g. Firefox). Key properties:

- **No stale frames** — a callback whose `mediaTime`/`currentTime` hasn't advanced
  is skipped (counted as `staleFrames`).
- **No overlap** — `detect()` is synchronous and never awaited by the scheduler,
  so at most one detection runs at a time; persistence is fire-and-forget.
- **Target ~15 FPS** with **adaptive backoff** — if a detection is slower than the
  frame budget the interval widens (down to ~4 FPS) so the UI never freezes.
- **Metrics** exposed to the dev panel: scheduling mode, processed FPS, avg/max
  detection ms, skipped/stale frames, `presentedFrames`, last `mediaTime`.

## UI

- **Normal mode** shows only confirmed hazard boxes (`DetectionOverlay`) plus a
  status pill: *Loading pose model → Pose model ready → Scanning video → No stable
  person detected → Low confidence (improve lighting / show full body) → Person
  detected → Hazard detected*.
- **Debug mode** (`import.meta.env.DEV`) adds the **skeleton/stickman overlay**
  (`SkeletonOverlay`) — green skeletons for stable accepted poses, amber while
  locking, plus dashed boxes for rejected raw poses with their reason — and the
  `PoseDebugPanel` (raw/accepted/rejected counts, quality, visible landmarks,
  frames seen, FPS, detection timing, thresholds, `MAX_POSES`). The overlay is
  purely presentational and never affects detection output.

## Tracking upgrade (Sprint 3.5)
`PersonTracker` is now ByteTrack-inspired: each track carries a smoothed centre
velocity and is matched against its **predicted** position, and an unmatched track
survives a lost-track buffer (~1.2 s, still predicting) so a brief miss / short
occlusion re-acquires the **same** `pX` id. No full Kalman filter or camera-motion
compensation yet — those can come with YOLO.

## Restricted zones (Sprint 3.75)
Operator-drawn rectangles (stored as normalized polygons in `hazard_zones`) emit
**`restricted_zone`** when a *stable* person's **foot anchor** (bbox bottom-centre,
à la Supervision `PolygonZone`) falls inside — entirely in-browser, no YOLO. Draw
them on Live via "Edit zones"; `pointInPolygon` / `zoneContainsBox` live in
`zones.ts`. `blocked_exit` stays weak with pose-only (it wants object detection)
and remains Sprint 4.

## Future performance
If main-thread detection stays heavy on low-end devices, move MediaPipe into a
**Web Worker** (OffscreenCanvas / `ImageBitmap` transfer) so detection no longer
competes with rendering. The synchronous `Detector` seam already supports a
cache-and-return worker detector.

## Sprint 4 (later — not started)
**YOLO / Ultralytics** will handle object/person/**PPE**/**forklift**/
**blocked-exit** detection and stronger tracking (BoT-SORT / ByteTrack object ids),
merged with the pose hazards via the existing `Detector`/`trackKey`/`source` seam.
Sprint 4 should begin **only after Pose-beta reliably stops creating
empty-background hazard boxes** — i.e. after this sprint is validated on real
cameras. YOLO must not be used to paper over MediaPipe false positives.
