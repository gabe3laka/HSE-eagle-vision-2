// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { XRayLens } from "@/components/live/XRayLens";
import type { HSETrack } from "@/lib/detection/hseTypes";
import type { BackendEntity, DetectionZone } from "@/lib/detection/types";

/** Crash guard for the demo: the lens must mount (and unmount) cleanly over a
 *  busy scene AND an empty one. Geometry math is covered in xrayLens.test.ts —
 *  this is purely "does the component render without throwing". */

const track: HSETrack = {
  id: "t1",
  label: "forklift",
  category: "vehicle",
  normalizedLabel: "forklift",
  bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
  confidence: 0.9,
  firstSeenMs: 0,
  lastSeenMs: 1000,
  ageMs: 1000,
  seenCount: 10,
  missingCount: 0,
  stable: true,
  source: "backend",
};

const entity: BackendEntity = {
  label: "forklift",
  class_id: 1,
  confidence: 0.9,
  bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
  track_id: "t1",
  risk_level: "RED",
  severity: 4,
  likelihood: 4,
  risk_reason: "Close to pedestrian lane",
  recommended_action: "Stop and give way",
} as BackendEntity;

const zone: DetectionZone = {
  id: "z1",
  kind: "restricted",
  label: "No-go",
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.4 },
  ],
};

const baseProps = {
  poses: [],
  zones: [zone],
  mirrored: true,
  disabled: false,
  flagEnabled: true,
  reasoningSource: "gemini",
};

describe("XRayLens smoke render", () => {
  // No vitest globals in this project → RTL's auto-cleanup never registers.
  afterEach(cleanup);

  it("mounts hidden over a populated scene and tracks on pointer move", () => {
    const onLensContext = vi.fn();
    const { getByTestId, unmount } = render(
      <XRayLens
        {...baseProps}
        tracks={[track]}
        entities={[entity]}
        onLensContext={onLensContext}
      />,
    );
    const root = getByTestId("xray-lens-root");
    expect(root.getAttribute("data-phase")).toBe("hidden");

    fireEvent.pointerMove(root, { pointerType: "mouse", clientX: 50, clientY: 50 });
    expect(root.getAttribute("data-phase")).toBe("tracking");
    expect(getByTestId("xray-reveal")).toBeTruthy();
    unmount(); // must detach window listeners without throwing
  });

  it("renders over an EMPTY scene (zero tracks/entities/zones)", () => {
    const { getByTestId } = render(
      <XRayLens {...baseProps} tracks={[]} entities={[]} zones={[]} onLensContext={() => {}} />,
    );
    expect(getByTestId("xray-lens-root")).toBeTruthy();
  });

  it("renders nothing when the flag is off or gestures are owned elsewhere", () => {
    const off = render(<XRayLens {...baseProps} flagEnabled={false} tracks={[]} entities={[]} />);
    expect(off.container.querySelector('[data-testid="xray-lens-root"]')).toBeNull();
    const busy = render(<XRayLens {...baseProps} disabled tracks={[]} entities={[]} />);
    expect(busy.container.querySelector('[data-testid="xray-lens-root"]')).toBeNull();
  });
});
