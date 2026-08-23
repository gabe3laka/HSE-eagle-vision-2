/* The notched plates, corner brackets and haze adapt ThreeUI's UplinkLoader
 * (github.com/MengTo/threeui, MIT, © Meng To / Design+Code) — see
 * THIRD_PARTY_NOTICES.md. */
import { riskLevelColor } from "@/lib/detection/riskTypes";
import { riskTileText, SCENE_OBJECTS, type Layout } from "./heroSceneCore";
const alpha = (rgba: string, a: number) => rgba.replace(/[\d.]+\)$/, `${a})`);
const FOCUSED = SCENE_OBJECTS[0]; // the RED forklift — the story

/** Notched readout plates + corner-bracket marker, positioned in slice space
 *  so they stay glued to the art on every viewport. (UplinkLoader treatment.) */
export function SensorMarks({ layout, still }: { layout: Layout; still: boolean }) {
  const notch =
    "polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)";
  const notchIn =
    "polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)";
  const X = (u: number) => layout.ox + u * layout.s;
  const Y = (v: number) => layout.oy + v * layout.s;

  // One consistent offset above each box; displace only on actual overlap.
  const placed: { left: number; top: number; width: number }[] = [];
  const plates = SCENE_OBJECTS.map((o) => {
    const label = riskTileText(o);
    const width = label.length * 6 + 16;
    const bx = o.bbox.x * 160;
    const bw = o.bbox.w * 160;
    const left = Math.min(Math.max(X(bx + bw / 2) - width / 2, 4), layout.w - width - 4);
    let top = Y(o.bbox.y * 90) - 26 - 8;
    for (const p of placed) {
      const clash =
        Math.abs(top - p.top) < 26 && left < p.left + p.width + 6 && p.left < left + width + 6;
      if (clash) top = p.top - 26 - 6;
    }
    top = Math.max(top, 3);
    placed.push({ left, top, width });
    return { o, label, left, top, width };
  });

  const fk = FOCUSED.bbox;
  const c = [X(fk.x * 160), Y(fk.y * 90), X((fk.x + fk.w) * 160), Y((fk.y + fk.h) * 90)];
  const red = riskLevelColor(FOCUSED.level);
  const corners = [
    { x: c[0], y: c[1], sx: 1, sy: 1, delay: "0s" },
    { x: c[2], y: c[1], sx: -1, sy: 1, delay: ".5s" },
    { x: c[0], y: c[3], sx: 1, sy: -1, delay: "1.1s" },
    { x: c[2], y: c[3], sx: -1, sy: -1, delay: "1.6s" },
  ];
  const fkPlate = plates[0];

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* haze: the highest risk glows through the grain */}
      <div
        style={{
          position: "absolute",
          left: fkPlate.left + fkPlate.width / 2 - (fkPlate.width + 120) / 2,
          top: fkPlate.top - 47,
          width: fkPlate.width + 120,
          height: 120,
          background: `radial-gradient(ellipse 50% 50% at center, ${alpha(red, 0.2)} 0%, ${alpha(red, 0.12)} 22%, ${alpha(red, 0.055)} 45%, ${alpha(red, 0.018)} 70%, transparent 100%)`,
          filter: "blur(6px)",
        }}
      />

      {/* corner brackets + pulsing diamonds, locked on the RED object */}
      {corners.map((k, i) => (
        <div key={i} style={{ position: "absolute", left: k.x, top: k.y }}>
          <i
            style={{
              position: "absolute",
              width: 9,
              height: 1.2,
              background: red,
              opacity: 0.72,
              left: k.sx > 0 ? -4 : -5,
              top: k.sy > 0 ? -4 : -3,
            }}
          />
          <i
            style={{
              position: "absolute",
              width: 1.2,
              height: 9,
              background: red,
              opacity: 0.72,
              left: k.sx > 0 ? -4 : -3,
              top: k.sy > 0 ? -4 : -5,
            }}
          />
          <i
            style={{
              position: "absolute",
              left: -4 + k.sx * -8,
              top: -4 + k.sy * -8,
              width: 8,
              height: 8,
              background: red,
              transform: "rotate(45deg)",
              boxShadow: `0 0 6px ${alpha(red, 0.7)}`,
              animation: still ? undefined : `hero-dia-pulse 3.2s ease-in-out infinite ${k.delay}`,
              opacity: still ? 0.8 : undefined,
            }}
          />
        </div>
      ))}

      {/* thin ticks keep the hierarchy on everything that is not the story */}
      <svg
        viewBox="0 0 160 90"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {SCENE_OBJECTS.slice(1).map((o) => {
          const x = o.bbox.x * 160;
          const y = o.bbox.y * 90;
          const w = o.bbox.w * 160;
          const h = o.bbox.h * 90;
          const L = Math.min(4, Math.min(w, h) * 0.3);
          const d = [
            `M${x} ${y + L} V${y} H${x + L}`,
            `M${x + w - L} ${y} H${x + w} V${y + L}`,
            `M${x + w} ${y + h - L} V${y + h} H${x + w - L}`,
            `M${x + L} ${y + h} H${x} V${y + h - L}`,
          ].join(" ");
          return (
            <path
              key={o.id}
              d={d}
              fill="none"
              stroke={o.tint}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {/* notched plates with the neon readout */}
      {plates.map(({ o, label, left, top, width }) => {
        const col = riskLevelColor(o.level);
        return (
          <div
            key={o.id}
            data-testid="hero-risk-tile"
            style={{
              position: "absolute",
              left,
              top,
              width,
              height: 26,
              background: col,
              clipPath: notch,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 1.2,
                background: "linear-gradient(180deg, #0a1626, #050c16)",
                clipPath: notchIn,
              }}
            />
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                whiteSpace: "pre",
                color: col,
                textShadow: `0 0 4px ${alpha(col, 0.6)}, 0 0 14px ${alpha(col, 0.55)}, 0 0 36px ${alpha(col, 0.4)}`,
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
