# Person-proximity model — visual person-to-person closeness

> **This is visual proximity, not calibrated distance.** The score is a
> screen-space estimate from 2D pose boxes — **not metres**. Without camera
> calibration or depth it cannot report a real-world separation. Treat it as a
> coaching signal that two people _look_ too close in frame.

## Where it lives

- `src/lib/detection/personProximity.ts` — geometry, scoring, tracker (unit-tested).
- Produced inside `realPoseDetector.ts` from the multi-pose boxes (`numPoses: 4`).

## Signals (`scorePersonProximity`)

For each pair of person boxes A, B:

- **Scale-normalized centre distance** — centre gap ÷ average box height
  (`normalizedDistanceByHeight`), so camera distance doesn't dominate.
- **Edge gap** — shortest gap between box edges (0 when touching/overlapping).
- **Overlap** — `boxIoU` (near/overlapping boxes are a strong signal).
- **Same-floor likelihood** — similarity of the boxes' _bottom_ (foot) level;
  people at clearly different foot levels are likely at different depths/heights.

```
score = 0.45*distScore + 0.30*gapScore + 0.25*min(1, IoU*2)
score *= 0.5 + 0.5*sameFloor          // different floor halves the score
```

## Thresholds

- `PROXIMITY_EMIT_THRESHOLD = 0.55` — emit a `person_proximity` observation.
- `PROXIMITY_STRONG_THRESHOLD = 0.75` — considered strong proximity.

The detector only emits at/above the emit threshold; the RiskEngine then handles
medium→high escalation by persistence, so a weak-but-flickering pair never ramps.

## Tracking & pair keys

`PersonTracker` is a lightweight greedy tracker (IoU first, centre distance
second) that keeps stable ids `p1`, `p2`, … across frames and expires a track
after ~900 ms unseen. It returns one entry per input box **in input order**.
Pairs use a **sorted, order-independent** key via `makePairKey("p2","p1") → "p1-p2"`.

> Note: today the detector aligns tracked ids to pose analyses **by index**
> (the tracker preserves input order). When a heavier tracker (YOLO/ByteTrack)
> lands, the tracker should return an explicit `sourceIndex` so this coupling is
> removed. Not a bug today — a hardening item before a serious pilot.

## Emission

For each close pair the detector emits:
`{ hazardType: "person_proximity", confidence: score, bbox: unionBox(A,B),
   trackKey: "p1-p2", source: "pose" }`.
The RiskEngine escalates each pair on its own track (`person_proximity:p1-p2`).

## Limitations

- Affected by camera angle, occlusion, crowding and depth ambiguity.
- Two people far apart in depth can look close in a 2D frame (mitigated, not
  solved, by the same-floor term).
- Best with a fixed, CCTV-like camera; a moving phone adds identity churn.

## Future

YOLO person detection + a real multi-object tracker (Sprint 4), and later
CCTV / edge-AI / UWB, will improve identity stability and turn visual proximity
into calibrated distance. The same pair/track seam already supports it.
