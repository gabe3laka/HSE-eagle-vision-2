# Sprint 4A-DEIMv2 — Architecture & Integration Notes

## Goal

Add a **dry-run DEIMv2 backend integration** into Eagle Vision 2.

- Build a standalone Dockerized DEIMv2 RunPod worker (separate repo)
- Add `BackendVisionDetector` to Eagle Vision 2 (new `backend-deimv2` mode)
- **Do not emit real DEIMv2 hazards yet** — entities shown in dev/debug mode only
- Do not break pose-beta or the RiskEngine

---

## Two-repo architecture

| Repo | Purpose |
|---|---|
| `gabe3laka/HSE-eagle-vision-2` | Frontend app (React/TS) — this repo |
| `gabe3laka/safelens-deimv2-worker` | RunPod worker (Python/Docker) — separate repo |

RunPod builds and runs containers from the **worker repo** only.  
The frontend never contains model weights, RunPod API keys, or DEIMv2 source code.

---

## Data flow (Sprint 4A)

```
Browser camera frame
  -> BackendVisionDetector.detect()     [synchronous, returns []]
      -> every 1.5s, fire-and-forget:
         -> captureFrame() -> base64 JPEG
         -> supabase.functions.invoke("deimv2-proxy", { image_b64, ... })
            -> Supabase Edge Function (deimv2-proxy/index.ts)
               -> RunPod /runsync endpoint
                  -> DEIMv2 worker (safelens-deimv2-worker)
                     -> DEIMv2 model inference
                     -> returns { entities, inference_ms, model, img_w, img_h }
               <- RunPod output forwarded
            <- Edge Function response
         <- cached in BackendVisionDetector.lastEntities
  -> RiskEngine.update([])             [no observations → no alerts in 4A]
```

---

## Files changed / added

### Worker repo (`safelens-deimv2-worker`)

| File | Purpose |
|---|---|
| `Dockerfile` | CUDA/PyTorch base; clones DEIMv2 at build time |
| `requirements.txt` | runpod, Pillow, pydantic, torch, transformers |
| `schema.py` | Pydantic request/response models |
| `deimv2_infer.py` | Lazy model loading + DEIMv2 inference wrapper |
| `handler.py` | RunPod serverless entry point |
| `scripts/smoke_test.py` | Local + live endpoint smoke test |
| `examples/*.json` | Sample request/response payloads |

### Eagle Vision 2 (`HSE-eagle-vision-2`)

| File | Change |
|---|---|
| `src/lib/detection/types.ts` | Add `"backend-deimv2"` to `DetectionMode`; add `BackendEntity` interface |
| `src/lib/detection/backendVisionDetector.ts` | **New** — fires async backend requests, caches entities |
| `src/lib/detection/detectorFactory.ts` | Add `"backend-deimv2"` case → `BackendVisionDetector` |
| `src/hooks/useAlertSettings.ts` | Add `coerceMode()` to handle `"backend-deimv2"` in persisted settings |
| `supabase/functions/deimv2-proxy/index.ts` | **New** — Edge Function proxy (keeps RunPod key secret) |

---

## Secrets required (Supabase)

```bash
supabase secrets set RUNPOD_API_KEY=rp_...
supabase secrets set RUNPOD_ENDPOINT_ID=<your-endpoint-id>
```

Deploy the Edge Function:
```bash
supabase functions deploy deimv2-proxy
```

---

## Sprint 4A constraints

- `detect()` returns `[]` — **no DEIMv2 hazards emitted**
- `BackendVisionDetector.getLastEntities()` exposes raw entities for dev/debug overlay
- MediaPipe Pose continues to handle `unsafe_lift`, `person_proximity`, `restricted_zone`
- `RiskEngine` is **not modified**
- `Detector.detect()` contract is **not broken** (still synchronous)

---

## Sprint 4B+ plan

When DEIMv2 is validated on real camera footage:
1. Map DEIMv2 `entities` → `Observation[]` in `BackendVisionDetector.detect()`
2. Enable: `ppe_missing`, `forklift_proximity`, `blocked_exit` hazard types
3. Merge DEIMv2 + Pose observations via existing `trackKey` / `source` seam
4. Add `source: "deimv2"` to observations (already in types.ts)
