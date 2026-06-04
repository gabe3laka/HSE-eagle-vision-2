# Ergonomics risk model — unsafe-lift detection

> **Scope & disclaimer.** This is an in-browser, pose-based **screening / coaching**
> signal — not a medical, clinical, or legal determination of injury risk. It runs
> on the phone/browser camera (the current CCTV substitute) and is designed to
> nudge safer lifting, not to grade or discipline workers.

## Where it lives
- `src/lib/detection/poseGeometry.ts` — pure geometry + scoring (unit-tested).
- `src/lib/detection/realPoseDetector.ts` — MediaPipe Pose Landmarker (VIDEO mode,
  `numPoses: 4`), per-frame, **synchronous** `detect()`.
- Escalation/alerting is owned by `riskEngine.ts`, not the detector.

## Inputs
MediaPipe Pose landmarks (normalized 0..1, `y` grows downward). We use shoulders,
elbows, wrists, hips, knees and ankles (`LM` in `poseGeometry.ts`).

## Signals (per person, per frame)
| Signal | How | Notes |
|---|---|---|
| Torso flexion | angle of the shoulder→hip line from vertical (`torsoAngleDeg`) | 0° upright, 90° horizontal |
| Knee straightness | mean interior knee angle hip–knee–ankle (`jointAngleDeg`) | straight legs = classic stoop |
| Wrist-low | lower wrist between hip (0) and knee (1) level | hands near the floor |
| Forward reach | horizontal wrist offset from the body line, in torso-lengths | load away from body |
| Twist / asymmetry | shoulder-line vs hip-line angle (`computeTwistAsymmetry`) | **2D projection only** |
| Overhead reach | how far the higher wrist sits above the shoulders | suppresses, see below |
| Visibility | mean landmark visibility | gates the whole reading |

## Thresholds (`POSE_THRESHOLDS`) — REBA/RULA-aligned trunk bands
- `torsoBendWatch 20°` (scoring starts) · `torsoBendLow 35°` · `torsoBendHigh 60°`
  (REBA high band) · `torsoBendExtreme 80°` (≈horizontal).
- `kneeStraightLow 140°` → `kneeStraightHigh 165°` (fully straight / stoop).
- `minVisibility 0.25` (below → reading discarded), `emitThreshold 0.6`.
- Reach `0.5 → 1.3` torso-lengths; overhead `0.25`; twist `25°`.
- Dynamics: static hold `2 s → 10 s`; repetition `4 → 12` bends/min.

## Scoring
```
torsoBendScore = clamp((torsoAngle - 20) / (60 - 20))
kneeStraightScore = clamp((kneeAngle - 140) / (165 - 140))
liftRisk = torsoBendScore * (0.25 + 0.40*kneeStraight + 0.20*wristLow + 0.15*forwardReach)
         + 0.10 * twist * torsoBendScore           // twist counts only while flexed
confidence = clamp(liftRisk) * (1 - (1 - visibility)*0.3)
confidence = 0 if visibility < 0.25
```
Knee straightness dominates: a **knees-bent squat** at the same trunk angle as a
**straight-knee stoop** scores far lower. Overhead reach and twist *alone* (upright
trunk) do **not** cross `emitThreshold` — they only matter alongside flexion.

## Dynamics — per person
`PerPersonDynamics` keeps a **separate** rolling sample buffer per tracked id
(`p1`, `p2`, …), so one worker's sustained/repetitive bending never leaks into
another's. `computePostureDynamics` derives `staticHoldMs`, `bendsPerMin`,
`staticScore`, `repetitionScore`. The detector then boosts confidence by up to
`0.15*staticScore + 0.15*repetitionScore`. Histories prune when a person leaves.

## Emission
For each tracked person, if confidence ≥ `emitThreshold (0.6)` the detector emits:
`{ hazardType: "unsafe_lift", confidence, bbox, trackKey: "p1", source: "pose" }`.
The RiskEngine escalates each person on an independent track (`unsafe_lift:p1`).
The highest-confidence person is shown as the debug "primary" only.

## Limitations
- **2D camera** — true spinal rotation and depth are not measured; a front/back
  view under-reads twist and forward reach.
- **Load weight is unknown** — a light box and a heavy box look identical.
- Sensitive to camera angle, occlusion, crowding and lighting.
- Best with a fixed, CCTV-like vantage; a hand-held moving phone adds noise.

## Future
Sprint 4 (RunPod YOLO) adds PPE, forklift, object and blocked-exit detection and
stronger person tracking, merged with these pose hazards via the
`Detector`/`trackKey`/`source` seam. Voice alerts remain out of scope.
