import { useState } from "react";
import { Button } from "@/components/ui/button";
import { captureVpsFrame } from "./frameCapture";
import { queryPose } from "./multisetClient";
import type { VpsIntrinsics, VpsQueryResult } from "./types";

/**
 * Stage-0 MultiSet REST proof panel (admin/dev only). The caller gates it behind
 * VITE_MULTISET_VPS_ENABLED && VITE_HIVE_DEBUG && appMode === "hse" && owner/admin
 * role — normal operators never see it. It captures ONE frame from the existing
 * HSE <video>, downscales it, estimates intrinsics, and runs a single MultiSet
 * map-query via the server-brokered token. Nothing here touches Hive, projection,
 * or the HSE detection path — it only proves localization works on iPhone Safari
 * + Android Chrome before any sv_pose / projection work begins.
 */

const MAX_DIM = 1280;
const LOCAL_HFOV_DEG = 65; // POC-only estimate (see frameCapture.estimateIntrinsics)

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  const color =
    ok === true ? "text-emerald-400" : ok === false ? "text-red-400" : "text-muted-foreground";
  return (
    <div className="flex items-start justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono break-all text-right ${color}`}>{value}</span>
    </div>
  );
}

export function MultisetVpsProofPanel({
  videoRef,
  mapCode,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mapCode: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VpsQueryResult | null>(null);
  const [intrinsics, setIntrinsics] = useState<VpsIntrinsics | null>(null);
  const [resolution, setResolution] = useState<string>("—");
  const [error, setError] = useState<string | null>(null);
  const [lastQueryAt, setLastQueryAt] = useState<number | null>(null);

  // Live camera readiness (re-evaluated on each render; Live re-renders often).
  const video = videoRef.current;
  const cameraReady = !!video && video.videoWidth > 0 && video.videoHeight > 0;

  const localize = async () => {
    setBusy(true);
    setError(null);
    setLastQueryAt(Date.now());
    try {
      if (!mapCode) throw new Error("missing_map_code (set VITE_MULTISET_MAP_CODE)");
      const frame = await captureVpsFrame(videoRef.current, {
        maxDim: MAX_DIM,
        hfovDeg: LOCAL_HFOV_DEG,
      });
      setIntrinsics(frame.intrinsics);
      setResolution(`${frame.width}×${frame.height}`);
      const res = await queryPose({ blob: frame.blob, intrinsics: frame.intrinsics, mapCode });
      setResult(res);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const pos = result?.position;
  const rot = result?.rotation;
  const trackingState = result ? (result.pose ? result.pose.trackingState : "lost") : "—";

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-sky-700/50 bg-sky-950/10 p-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-sky-500" />
        <span className="text-sm font-semibold">MultiSet VPS · Stage 0 proof</span>
        <span className="ml-auto rounded bg-sky-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-300">
          dev
        </span>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        Admin/dev test only. This panel will be replaced by automatic VPS status (ready / localizing
        / lost) once sv_pose is implemented.
      </p>

      <Button
        size="sm"
        variant="outline"
        className="w-full border-sky-500/50 text-sky-200"
        disabled={busy || !cameraReady}
        onClick={() => void localize()}
      >
        {busy ? "Localizing…" : cameraReady ? "Localize now" : "Camera not ready"}
      </Button>

      <div>
        {/* --- Config / readiness --- */}
        <Row label="VPS enabled" value="yes" ok={true} />
        <Row
          label="map code"
          value={mapCode || "missing (set VITE_MULTISET_MAP_CODE)"}
          ok={mapCode ? true : false}
        />
        <Row label="camera ready" value={cameraReady ? "yes" : "no"} ok={cameraReady} />
        <Row
          label="last query time"
          value={lastQueryAt ? new Date(lastQueryAt).toLocaleTimeString() : "—"}
        />

        {/* --- Localization result --- */}
        <Row
          label="poseFound"
          value={result ? String(result.poseFound) : "—"}
          ok={result ? result.poseFound : null}
        />
        <Row label="trackingState" value={trackingState} ok={null} />
        <Row
          label="confidence"
          value={result?.confidence != null ? result.confidence.toFixed(3) : "—"}
          ok={null}
        />
        <Row
          label="position x/y/z"
          value={pos ? `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}` : "—"}
        />
        <Row
          label="rotation qx/qy/qz/qw"
          value={
            rot
              ? `${rot.x.toFixed(2)}, ${rot.y.toFixed(2)}, ${rot.z.toFixed(2)}, ${rot.w.toFixed(2)}`
              : "—"
          }
        />
        <Row label="mapId" value={result?.mapId ?? "—"} />
        <Row label="mapCodes" value={result?.mapCodes?.join(", ") ?? "—"} />
        <Row
          label="responseTime"
          value={result?.responseTimeMs != null ? `${result.responseTimeMs} ms` : "—"}
        />

        {/* --- Request diagnostics --- */}
        <Row label="request resolution" value={resolution} />
        <Row
          label="intrinsics fx/fy/px/py"
          value={
            intrinsics
              ? `${Math.round(intrinsics.fx)} / ${Math.round(intrinsics.fy)} / ${Math.round(
                  intrinsics.px,
                )} / ${Math.round(intrinsics.py)}`
              : "—"
          }
        />
        <Row label="intrinsics source" value="estimated_hfov_65" ok={null} />
        <Row label="last error" value={error ?? "—"} ok={error ? false : null} />
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        POC only: intrinsics are estimated from a 65° horizontal FOV. The single frame is sent
        directly to MultiSet (never over Hive). Prove poseFound=true on iPhone Safari and Android
        Chrome in the same map before enabling sv_pose / projection.
      </p>
    </div>
  );
}
