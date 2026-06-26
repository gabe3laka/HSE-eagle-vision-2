import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSiteMaps, useOrgCameraDevices } from "../hooks/useSiteMaps";
import { SiteMapEditor } from "./SiteMapEditor";
import { CameraPlacementEditor } from "./CameraPlacementEditor";
import type { SiteMap } from "../hooks/useSiteMaps";

interface Props {
  orgId: string;
  userId: string;
  deviceId: string;
  cameraLabel: string;
}

/**
 * Phase 1B: Manual map placement panel.
 *
 * Guides the operator through:
 *  1. Select or create a site map
 *  2. Place this camera on the map (position + heading + FOV)
 *  3. Review peer camera placements
 *
 * This panel ONLY persists camera placement into org_camera_devices. It does
 * NOT emit a render-ready calibration — useLocalPeerCalibrations is the single
 * source that builds valid manual_map LocalPeerCalibration objects from BOTH
 * the local and peer camera placements. Manual-map projection then activates
 * automatically once this camera and a peer camera both have valid positions,
 * headings, and FOV. Label: "Remote · Camera B · manual map".
 */
export function ManualMapCalibrationPanel({ orgId, userId, deviceId, cameraLabel }: Props) {
  const [step, setStep] = useState<"map" | "place" | "done">("map");
  const [selectedMap, setSelectedMap] = useState<SiteMap | null>(null);

  const { data: maps = [] } = useSiteMaps(orgId);
  const { data: devices = [] } = useOrgCameraDevices(orgId);

  const myDevice = devices.find((d) => d.device_id === deviceId) ?? null;

  function handleMapSelected(map: SiteMap) {
    setSelectedMap(map);
    setStep("place");
  }

  function handlePlacementSaved() {
    // Placement is persisted by CameraPlacementEditor into org_camera_devices.
    // No fake calibration is created here — useLocalPeerCalibrations derives the
    // real manual_map transform from local + peer placements.
    setStep("done");
  }

  const peerDevices = devices.filter((d) => d.device_id !== deviceId && d.map_x_m !== null);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-purple-500" />
        <span className="text-sm font-semibold">Manual Map Calibration</span>
        <span className="ml-auto rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wider">
          Phase 1B
        </span>
      </div>

      {step === "map" && (
        <SiteMapEditor orgId={orgId} existingMaps={maps} onSelect={handleMapSelected} />
      )}

      {step === "place" && selectedMap && (
        <CameraPlacementEditor
          orgId={orgId}
          userId={userId}
          deviceId={deviceId}
          cameraLabel={cameraLabel}
          siteMap={selectedMap}
          existing={myDevice}
          onSaved={handlePlacementSaved}
        />
      )}

      {step === "done" && (
        <div className="space-y-3">
          <div className="rounded bg-green-950/40 border border-green-800/40 px-3 py-2 text-xs text-green-300">
            Camera placement saved. Manual-map projection activates when this camera and a peer
            camera both have valid map positions, headings, and FOV. Projected detections then
            appear as <span className="font-semibold">Remote · {cameraLabel} · manual map</span>.
          </div>

          {peerDevices.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Other cameras on map
              </p>
              {peerDevices.map((d) => (
                <div
                  key={d.device_id}
                  className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <span className="font-medium">{d.camera_label}</span>
                  <span className="text-muted-foreground">
                    ({d.map_x_m?.toFixed(1)}, {d.map_y_m?.toFixed(1)}) m · {d.heading_deg}°
                  </span>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setStep("place")}
          >
            Update placement
          </Button>
        </div>
      )}
    </div>
  );
}
