import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { captureVpsFrame } from "./frameCapture";
import { queryPose } from "./multisetClient";
import type { VpsIntrinsics, VpsQueryResult } from "./types";

/**
 * Stage-0 MultiSet REST proof panel (dev-only). Gated by the caller behind
 * VITE_MULTISET_VPS_ENABLED && appMode === "hse". It captures ONE frame from the
 * existing HSE <video>, downscales it, estimates intrinsics, and runs a single
 * MultiSet map-query via the server-brokered token. Nothing here touches Hive,
 * projection, or the HSE detection path — it only proves localization works on
 * iPhone Safari + Android Chrome before any sv_pose / projection work begins.
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
  const thumbRef = useRef<string | null>(null);

  const localize = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!mapCode) throw new Error("missing_map_code (set VITE_MULTISET_MAP_CODE)");
      const frame = await captureVpsFrame(videoRef.current, {
        maxDim: MAX_DIM,
        hfovDeg: LOCAL_HFOV_DEG,
      });
      thumbRef.current = frame.dataUrl;
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

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-sky-700/50 bg-sky-950/10 p-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-sky-500" />
        <span className="text-sm font-semibold">MultiSet VPS · Stage 0 proof</span>
        <span className="ml-auto rounded bg-sky-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-300">
          dev
        </span>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full border-sky-500/50 text-sky-200"
        disabled={busy}
        onClick={() => void localize()}
      >
        {busy ? "Localizing…" : "Localize now"}
      </Button>

      <div>
        <Row label="map code" value={mapCode || "—"} ok={mapCode ? null : false} />
        <Row
          label="poseFound"
          value={result ? String(result.poseFound) : "—"}
          ok={result ? result.poseFound : null}
        />
        <Row
          label="confidence"
          value={result?.confidence != null ? result.confidence.toFixed(3) : "—"}
          ok={null}
        />
        <Row
          label="position"
          value={pos ? `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}` : "—"}
        />
        <Row
          label="rotation"
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
        <Row label="request resolution" value={resolution} />
        <Row
          label="intrinsics (POC est.)"
          value={
            intrinsics
              ? `fx${Math.round(intrinsics.fx)} fy${Math.round(intrinsics.fy)} px${Math.round(
                  intrinsics.px,
                )} py${Math.round(intrinsics.py)}`
              : "—"
          }
        />
        <Row label="last error" value={error ?? "—"} ok={error ? false : null} />
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        POC only: intrinsics are estimated from a 65° horizontal FOV. Image is sent directly to
        MultiSet (never over Hive). Prove poseFound=true on iPhone Safari and Android Chrome in the
        same map before enabling sv_pose / projection.
      </p>
    </div>
  );
}
