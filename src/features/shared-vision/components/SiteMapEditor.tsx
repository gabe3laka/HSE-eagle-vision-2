import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateSiteMap } from "../hooks/useSiteMaps";
import type { SiteMap } from "../hooks/useSiteMaps";

interface Props {
  orgId: string;
  existingMaps: SiteMap[];
  onSelect: (map: SiteMap) => void;
}

/**
 * Phase 1B: upload or name a site map and set scale.
 * Lets operators define the shared floor-plan that camera placements reference.
 */
export function SiteMapEditor({ orgId, existingMaps, onSelect }: Props) {
  const [name, setName] = useState("");
  const [widthM, setWidthM] = useState("");
  const [heightM, setHeightM] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const createMap = useCreateSiteMap();

  async function handleCreate() {
    if (!name.trim()) return;
    await createMap.mutateAsync({
      orgId,
      name: name.trim(),
      widthM: parseFloat(widthM) || undefined,
      heightM: parseFloat(heightM) || undefined,
    });
    setName("");
    setWidthM("");
    setHeightM("");
  }

  return (
    <div className="space-y-4">
      {existingMaps.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Existing maps
          </p>
          {existingMaps.map((m) => (
            <button
              key={m.id}
              className="w-full rounded border border-border px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
              onClick={() => onSelect(m)}
            >
              {m.name}
              {m.width_m && m.height_m ? ` · ${m.width_m}×${m.height_m} m` : ""}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded border border-dashed border-border p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          New map
        </p>
        <div className="space-y-1">
          <Label htmlFor="map-name" className="text-xs">
            Name
          </Label>
          <Input
            id="map-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Warehouse Floor A"
            className="h-8 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="map-w" className="text-xs">
              Width (m)
            </Label>
            <Input
              id="map-w"
              type="number"
              value={widthM}
              onChange={(e) => setWidthM(e.target.value)}
              placeholder="20"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="map-h" className="text-xs">
              Height (m)
            </Label>
            <Input
              id="map-h"
              type="number"
              value={heightM}
              onChange={(e) => setHeightM(e.target.value)}
              placeholder="15"
              className="h-8 text-sm"
            />
          </div>
        </div>
        {/* Image upload placeholder — Phase 1B uses dimensions only */}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" />
        <Button
          size="sm"
          className="w-full"
          disabled={!name.trim() || createMap.isPending}
          onClick={handleCreate}
        >
          {createMap.isPending ? "Creating…" : "Create map"}
        </Button>
      </div>
    </div>
  );
}
