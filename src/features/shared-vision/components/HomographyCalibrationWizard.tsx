import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { solveHomography, reprojectionError, type Pt } from "../lib/homography";
import { confidenceFromReprojection } from "../lib/projectionConfidence";
import { buildCaptureTransform } from "../lib/captureTransform";
import { useUpsertCameraCalibration } from "../hooks/useCameraCalibrations";
import type { SiteMap } from "../hooks/useSiteMaps";

interface Props {
  orgId: string;
  userId: string;
  deviceId: string;
  siteMap: SiteMap;
  /** Live camera element — its MediaStream is mirrored into the wizard preview. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Detector capture dimensions (from backendStatus). Used for the persisted
   *  CaptureTransform + reprojection-error → pixel conversion. */
  captureW: number | null;
  captureH: number | null;
  facing: "user" | "environment";
  /** Current compass heading (deg) — stored for the receiver pose-lock gate
   *  when calibrating a handheld camera. */
  currentHeadingDeg: number | null;
  onClose: () => void;
}

type MapPt = { x_m: number; y_m: number };

/**
 * Phase 2 ground-plane homography calibration.
 *
 * Workflow: tap 4–8 floor points in the live camera preview, then the matching
 * point on the site map, building correspondences. We solve BOTH directions
 * (imageToMapH and mapToImageH) and grade the fit by reprojection error.
 *
 * Capture-space contract: the preview is forced to the detector's CAPTURE aspect
 * ratio with object-cover, so a tap normalized against the preview is already in
 * the capture-normalized 0..1 domain — the same space as bboxRemote /
 * getEntityFootPoint. We never solve in raw display pixels.
 *
 * Only Good/Weak fits are persisted; Failed is blocked. Weak is never labelled
 * accurate (projection.ts caps it below the solid threshold).
 */
export function HomographyCalibrationWizard({
  orgId,
  userId,
  deviceId,
  siteMap,
  videoRef,
  captureW,
  captureH,
  facing,
  currentHeadingDeg,
  onClose,
}: Props) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const [imagePts, setImagePts] = useState<Pt[]>([]);
  const [mapPts, setMapPts] = useState<MapPt[]>([]);
  const [surfaceType, setSurfaceType] = useState<"mounted" | "handheld">("mounted");
  const upsert = useUpsertCameraCalibration();

  const mapW = siteMap.width_m ?? 20;
  const mapH = siteMap.height_m ?? 15;
  // Preview aspect = capture aspect so a normalized preview tap == capture-norm.
  const captureAspect = captureW && captureH && captureH > 0 ? captureW / captureH : 16 / 9;

  // Mirror the live MediaStream into the wizard preview element.
  useEffect(() => {
    const src = videoRef.current?.srcObject ?? null;
    const el = previewRef.current;
    if (el && src && el.srcObject !== src) {
      el.srcObject = src;
      el.play().catch(() => {});
    }
  }, [videoRef]);

  // Whether the next tap should be on the image (true) or the map (false).
  const expectImageTap = imagePts.length === mapPts.length;
  const pairCount = Math.min(imagePts.length, mapPts.length);

  function handleImageTap(e: React.MouseEvent<HTMLDivElement>) {
    if (!expectImageTap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setImagePts((p) => [...p, { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }]);
  }

  function handleMapTap(e: React.MouseEvent<HTMLDivElement>) {
    if (expectImageTap) return; // need an image tap first
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * mapW;
    const y = ((e.clientY - rect.top) / rect.height) * mapH;
    setMapPts((p) => [...p, { x_m: x, y_m: y }]);
  }

  function undo() {
    if (!expectImageTap && imagePts.length > mapPts.length) {
      setImagePts((p) => p.slice(0, -1));
    } else if (mapPts.length > 0) {
      setMapPts((p) => p.slice(0, -1));
    } else if (imagePts.length > 0) {
      setImagePts((p) => p.slice(0, -1));
    }
  }

  function reset() {
    setImagePts([]);
    setMapPts([]);
  }

  // Solve + grade once we have ≥4 complete pairs.
  const solution = useMemo(() => {
    if (pairCount < 4) return null;
    const src = imagePts.slice(0, pairCount);
    const dst: Pt[] = mapPts.slice(0, pairCount).map((m) => ({ x: m.x_m, y: m.y_m }));
    const imageToMapH = solveHomography(src, dst);
    const mapToImageH = solveHomography(dst, src);
    if (!imageToMapH || !mapToImageH) return null;
    // Grade in image-normalized space: reproject map points back to image.
    const err = reprojectionError(mapToImageH, dst, src);
    const grade = confidenceFromReprojection(err.rmsImageNorm, { captureW, captureH });
    return { imageToMapH, mapToImageH, rmsImageNorm: err.rmsImageNorm, grade };
  }, [imagePts, mapPts, pairCount, captureW, captureH]);

  const canSave = !!solution && solution.grade.tier !== "failed";

  async function handleSave() {
    if (!solution) return;
    const calibrationHeadingDeg = surfaceType === "handheld" ? currentHeadingDeg : null;
    const captureTransform = buildCaptureTransform({
      rawVideoW: videoRef.current?.videoWidth,
      rawVideoH: videoRef.current?.videoHeight,
      captureW,
      captureH,
      displayW: previewRef.current?.clientWidth,
      displayH: previewRef.current?.clientHeight,
      mirrored: facing === "user",
      facing,
    });
    await upsert.mutateAsync({
      orgId,
      userId,
      deviceId,
      siteMapId: siteMap.id,
      surfaceType,
      status: "homography",
      method: "homography_4pt",
      confidence: solution.grade.confidence,
      ttlMs: surfaceType === "handheld" ? 30_000 : null,
      transform: {
        imageToMapH: solution.imageToMapH,
        mapToImageH: solution.mapToImageH,
        referencePoints: {
          image: imagePts.slice(0, pairCount),
          map: mapPts.slice(0, pairCount),
        },
        captureTransform,
        reprojectionErrorNorm: solution.rmsImageNorm,
        calibrationHeadingDeg,
      },
    });
    onClose();
  }

  const gradeColor =
    solution?.grade.tier === "good"
      ? "text-emerald-500"
      : solution?.grade.tier === "weak"
        ? "text-amber-500"
        : "text-red-500";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Homography calibration · {siteMap.name}
        </p>
        <span className="text-[11px] text-muted-foreground">{pairCount} / 6 pairs</span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {expectImageTap
          ? "Tap a floor point in the camera view…"
          : "…now tap the SAME point on the site map."}{" "}
        Aim for 6–8 well-spread floor points.
      </p>

      {/* Live camera preview — capture aspect, object-cover → taps are capture-norm. */}
      <div
        className="relative w-full overflow-hidden rounded border border-border"
        style={{ aspectRatio: String(captureAspect) }}
        onClick={handleImageTap}
        role="presentation"
      >
        <video
          ref={previewRef}
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
        />
        {imagePts.map((p, i) => (
          <div
            key={`img-${i}`}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-fuchsia-500 text-[8px]"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          >
            <span className="absolute left-3 top-0 text-fuchsia-300">{i + 1}</span>
          </div>
        ))}
      </div>

      {/* Site-map tap target. */}
      <div
        className="relative w-full overflow-hidden rounded border border-dashed border-border bg-muted/30"
        style={{ aspectRatio: String(mapW / mapH) }}
        onClick={handleMapTap}
        role="presentation"
      >
        <span className="absolute left-1 top-1 text-[9px] text-muted-foreground">
          {mapW}×{mapH} m
        </span>
        {mapPts.map((m, i) => (
          <div
            key={`map-${i}`}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-cyan-500 text-[8px]"
            style={{ left: `${(m.x_m / mapW) * 100}%`, top: `${(m.y_m / mapH) * 100}%` }}
          >
            <span className="absolute left-3 top-0 text-cyan-300">{i + 1}</span>
          </div>
        ))}
      </div>

      {solution && (
        <div className="rounded bg-muted/40 px-3 py-2 text-xs">
          Fit quality:{" "}
          <span className={`font-semibold uppercase ${gradeColor}`}>{solution.grade.tier}</span> ·
          reprojection {solution.grade.rmsPx.toFixed(1)} px · confidence{" "}
          {Math.round(solution.grade.confidence * 100)}%
          {solution.grade.tier === "weak" && (
            <span className="text-amber-500"> — approximate; not labelled accurate.</span>
          )}
          {solution.grade.tier === "failed" && (
            <span className="text-red-500"> — too imprecise to save; re-tap.</span>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Camera mount</Label>
        <div className="flex gap-2">
          {(["mounted", "handheld"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={surfaceType === s ? "default" : "outline"}
              className="flex-1 capitalize"
              onClick={() => setSurfaceType(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Mounted cameras publish a trusted in-view transform. Handheld cameras still help as the
          detecting peer, but their receiver overlay degrades to anchored on movement.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={undo}
          disabled={pairCount === 0 && imagePts.length === 0}
        >
          Undo
        </Button>
        <Button size="sm" variant="outline" onClick={reset} disabled={imagePts.length === 0}>
          Reset
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={!canSave || upsert.isPending}
          onClick={handleSave}
        >
          {upsert.isPending ? "Saving…" : "Save calibration"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
