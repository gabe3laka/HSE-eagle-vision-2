import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateCameraPlacement } from "../hooks/useSiteMaps";
import type { SiteMap, CameraPlacement } from "../hooks/useSiteMaps";

interface Props {
  orgId: string;
  userId: string;
  deviceId: string;
  cameraLabel: string;
  siteMap: SiteMap;
  existing: CameraPlacement | null;
  onSaved: (placement: {
    mapXM: number;
    mapYM: number;
    headingDeg: number;
    fovDeg: number;
  }) => void;
}

/**
 * Phase 1B: Place this camera on the site map.
 *
 * The user enters X/Y position (metres from map origin) and heading (degrees
 * the camera faces, clockwise from north). FOV defaults to 65°.
 *
 * siteMap.id is saved as site_map_id so useLocalPeerCalibrations can reject
 * cross-map pairs (cameras on different maps cannot share a coordinate origin).
 */
export function CameraPlacementEditor({
  orgId,
  userId,
  deviceId,
  cameraLabel,
  siteMap,
  existing,
  onSaved,
}: Props) {
  const [x, setX] = useState(String(existing?.map_x_m ?? ""));
  const [y, setY] = useState(String(existing?.map_y_m ?? ""));
  const [heading, setHeading] = useState(String(existing?.heading_deg ?? "0"));
  const [fov, setFov] = useState(String(existing?.fov_deg ?? "65"));
  const updatePlacement = useUpdateCameraPlacement();

  async function handleSave() {
    const mapXM = parseFloat(x);
    const mapYM = parseFloat(y);
    const headingDeg = parseFloat(heading);
    const fovDeg = parseFloat(fov);
    if (isNaN(mapXM) || isNaN(mapYM) || isNaN(headingDeg) || isNaN(fovDeg)) return;

    await updatePlacement.mutateAsync({
      orgId,
      userId,
      deviceId,
      cameraLabel,
      siteMapId: siteMap.id,
      mapXM,
      mapYM,
      headingDeg,
      fovDeg,
    });
    onSaved({ mapXM, mapYM, headingDeg, fovDeg });
  }

  const mapW = siteMap.width_m ?? 20;
  const mapH = siteMap.height_m ?? 15;

  return (
    <div className="space-y-3">
      <div className="rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Map: <span className="font-medium text-foreground">{siteMap.name}</span> · {mapW}×{mapH} m
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="cam-x" className="text-xs">
            X position (m)
          </Label>
          <Input
            id="cam-x"
            type="number"
            value={x}
            onChange={(e) => setX(e.target.value)}
            placeholder="0"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cam-y" className="text-xs">
            Y position (m)
          </Label>
          <Input
            id="cam-y"
            type="number"
            value={y}
            onChange={(e) => setY(e.target.value)}
            placeholder="0"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cam-heading" className="text-xs">
            Heading (°, N=0, CW)
          </Label>
          <Input
            id="cam-heading"
            type="number"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            placeholder="0"
            min="0"
            max="360"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cam-fov" className="text-xs">
            FOV (°)
          </Label>
          <Input
            id="cam-fov"
            type="number"
            value={fov}
            onChange={(e) => setFov(e.target.value)}
            placeholder="65"
            min="10"
            max="170"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Approximate placement only. Projection will show{" "}
        <span className="font-medium">Remote · manual map (approximate)</span> labels.
      </p>

      <Button
        size="sm"
        className="w-full"
        disabled={updatePlacement.isPending}
        onClick={handleSave}
      >
        {updatePlacement.isPending ? "Saving…" : "Save placement"}
      </Button>
    </div>
  );
}
