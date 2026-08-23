import { ZONE_POINTS } from "./heroSceneCore";

/**
 * The illustrated warehouse bay — one-point perspective, drawn twice by
 * HeroScene (clean + sensor copy) so the lens reveals a perfectly aligned
 * second view.
 *
 * One projection: horizon (eye level) at y=34.2 (38% of 90), vanishing point
 * at x=89.6 (0.56 × 160). Every solid shows a lit top face and one side face
 * receding to the same point; every object sits on a contact shadow. Values:
 * light top / mid front / dark side, no uniform outlines.
 */

const VPX = 89.6;
const VPY = 34.2;

/** Recede a front-face point toward the vanishing point by fraction t. */
const rc = (x: number, y: number, t: number): [number, number] => [
  x + (VPX - x) * t,
  y + (VPY - y) * t,
];
const poly = (pts: [number, number][]) =>
  pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** A box in one-point perspective: front face + top face + the side face
 *  that actually faces the vanishing point. */
function Box({
  x0,
  x1,
  yTop,
  yBot,
  t,
  front,
  top,
  side,
}: {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  t: number;
  front: string;
  top: string;
  side: string;
}) {
  const tl = rc(x0, yTop, t);
  const tr = rc(x1, yTop, t);
  const showRight = x1 < VPX; // object left of the VP shows its right side
  const sideFace: [number, number][] = showRight
    ? [[x1, yTop], tr, rc(x1, yBot, t), [x1, yBot]]
    : [[x0, yTop], tl, rc(x0, yBot, t), [x0, yBot]];
  return (
    <g>
      <polygon points={poly([[x0, yTop], [x1, yTop], tr, tl])} fill={top} />
      <polygon points={poly(sideFace)} fill={side} />
      <rect x={x0} y={yTop} width={x1 - x0} height={yBot - yTop} fill={front} />
    </g>
  );
}

/** Soft contact-shadow ellipse; every object stands on one. */
const Shadow = ({
  cx,
  cy,
  rx,
  ry = 2.4,
  o = 0.5,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry?: number;
  o?: number;
}) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`rgba(2,6,12,${o})`} filter="url(#hero-soft)" />
);

export function SceneArt() {
  // Walkway edges converge to the VP; drawn from the wall base (y=46) forward.
  const zone = ZONE_POINTS.map((p) => `${(p.x * 160).toFixed(1)},${(p.y * 90).toFixed(1)}`).join(
    " ",
  );
  return (
    <svg
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <filter id="hero-soft" x="-60%" y="-120%" width="220%" height="340%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <linearGradient id="hero-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1725" />
          <stop offset="1" stopColor="#1a2536" />
        </linearGradient>
        <radialGradient id="hero-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(251,211,141,0.20)" />
          <stop offset="0.22" stopColor="rgba(244,193,116,0.13)" />
          <stop offset="0.45" stopColor="rgba(226,168,92,0.06)" />
          <stop offset="0.7" stopColor="rgba(203,142,68,0.02)" />
          <stop offset="1" stopColor="rgba(203,142,68,0)" />
        </radialGradient>
        <radialGradient id="hero-vig" cx="0.5" cy="0.46" r="0.72">
          <stop offset="0.55" stopColor="rgba(0,0,0,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.44)" />
        </radialGradient>
      </defs>

      {/* ceiling + back wall */}
      <rect width="160" height="46" fill="#0a1220" />
      <rect y="8" width="160" height="38" fill="#0c1524" />
      <path
        d="M20 8.6 V46 M56 8.6 V46 M96 8.6 V46 M134 8.6 V46"
        stroke="#0a111d"
        strokeWidth="0.8"
      />
      {/* trusses filling the dead upper third, converging to the same VP */}
      <g stroke="#182335" strokeWidth="0.7" fill="none">
        {[-6, 26, 58, 122, 154].map((x) => (
          <path
            key={x}
            d={`M${x} 0 L${(x + (VPX - x) * 0.34).toFixed(1)} ${(VPY * 0.34 + 2).toFixed(1)}`}
          />
        ))}
        <path d="M0 4.2 H160 M0 9.4 H160" strokeWidth="0.5" />
        <path d="M-6 0 L26 8.8 L58 0 L96 8.8 L122 0 L154 8.8" strokeWidth="0.4" opacity="0.5" />
      </g>

      {/* floor with joints receding to the VP */}
      <rect y="46" width="160" height="44" fill="url(#hero-floor)" />
      <g stroke="#0d1522" strokeWidth="0.5">
        {[-30, 8, 46, 120, 158, 196].map((xb) => (
          <path key={xb} d={`M${VPX} ${VPY} L${xb} 90`} strokeDasharray="none" opacity="0.9" />
        ))}
        <path d="M0 52 H160 M0 61 H160 M0 73 H160" opacity="0.7" />
      </g>
      {/* teal rim light where the wall meets the floor */}
      <rect y="45.2" width="160" height="1" fill="rgba(45,212,191,0.10)" />
      <rect y="45.9" width="160" height="0.35" fill="rgba(45,212,191,0.22)" />

      {/* overhead pool of light on the floor between worker and forklift */}
      <ellipse cx="71" cy="72" rx="27" ry="9.5" fill="url(#hero-pool)" />

      {/* floor-marked pedestrian walkway the forklift is crossing */}
      <polygon points={zone} fill="rgba(45,212,191,0.045)" />
      <g stroke="rgba(45,212,191,0.38)" strokeWidth="0.7" strokeDasharray="2.6 2">
        <path
          d={`M${ZONE_POINTS[0].x * 160} ${ZONE_POINTS[0].y * 90} L${ZONE_POINTS[3].x * 160} ${ZONE_POINTS[3].y * 90}`}
        />
        <path
          d={`M${ZONE_POINTS[1].x * 160} ${ZONE_POINTS[1].y * 90} L${ZONE_POINTS[2].x * 160} ${ZONE_POINTS[2].y * 90}`}
        />
      </g>

      {/* ── pallet stack (left) ── */}
      <Shadow cx={27} cy={74.8} rx={16} />
      <Box
        x0={11}
        x1={35.5}
        yTop={71.8}
        yBot={74.4}
        t={0.13}
        front="#3d3323"
        top="#55482f"
        side="#241d12"
      />
      <Box
        x0={12}
        x1={34}
        yTop={64.2}
        yBot={71.8}
        t={0.13}
        front="#2a3549"
        top="#3c4a63"
        side="#1a2334"
      />
      <Box
        x0={12.6}
        x1={33.2}
        yTop={56.4}
        yBot={64.2}
        t={0.13}
        front="#2e3a50"
        top="#41506b"
        side="#1c2537"
      />
      <Box
        x0={13.4}
        x1={31.8}
        yTop={48.6}
        yBot={56.4}
        t={0.13}
        front="#333f57"
        top="#495a76"
        side="#1f2839"
      />
      <path d="M12 68 h22 M12.6 60.3 h20.6" stroke="#1b2434" strokeWidth="0.9" />
      <path d="M13.4 48.6 h18.4" stroke="rgba(45,212,191,0.4)" strokeWidth="0.45" />

      {/* ── exit door on the back wall + the pallet blocking it ── */}
      <rect x={127.5} y={23.5} width={16.5} height={22.5} fill="#1b2939" />
      <rect x={128.6} y={24.6} width={14.3} height={21.4} fill="#233a50" />
      <rect x={128.6} y={24.6} width={14.3} height={2.1} fill="#2c485f" />
      <rect x={130} y={36.2} width={11.5} height={1.3} rx={0.6} fill="#8fa8b8" />
      <rect x={129.8} y={18.8} width={12} height={3.6} rx={0.7} fill="rgba(52,211,153,0.32)" />
      <rect x={130.6} y={19.6} width={10.4} height={2} rx={0.4} fill="rgba(110,240,190,0.5)" />
      <Shadow cx={132.5} cy={57.6} rx={10.5} />
      <Box
        x0={124.5}
        x1={140}
        yTop={44.6}
        yBot={54.6}
        t={0.12}
        front="#31405a"
        top="#475977"
        side="#1e2a3e"
      />
      <Box
        x0={123.8}
        x1={140.7}
        yTop={54.6}
        yBot={57.2}
        t={0.12}
        front="#3d3323"
        top="#55482f"
        side="#241d12"
      />
      <path d="M124.5 49.4 h15.5" stroke="#22304a" strokeWidth="0.7" />
      <path d="M124.5 44.6 h15.5" stroke="rgba(45,212,191,0.42)" strokeWidth="0.45" />

      {/* ── worker, standing inside the marked walkway ── */}
      <Shadow cx={65} cy={76.6} rx={6} ry={1.7} o={0.55} />
      <path
        d="M63.3 70.6 L62.6 76.2 M66.7 70.6 L67.5 76.2"
        stroke="#3f4c60"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M62 61.4 q0 -1.6 1.5 -1.9 l3 0 q1.5 0.3 1.5 1.9 l-0.4 9.4 l-5.2 0 z"
        fill="#8a6420"
      />
      <rect x={62} y={61} width={6} height={2.6} fill="#c9a13f" />
      <rect x={62} y={65.6} width={6} height={1.5} fill="#cbd5e1" opacity={0.65} />
      <path d="M62 61.2 q3 -1.4 6 0" stroke="rgba(45,212,191,0.5)" strokeWidth="0.5" fill="none" />
      <circle cx={65} cy={57.2} r={2.6} fill="#94a3b8" />
      <path d="M62.7 56.4 a2.6 2.6 0 0 1 4.6 0" fill="#b7c4d4" />

      {/* ── forklift, crossing the walkway toward the worker ── */}
      <Shadow cx={81.5} cy={77.4} rx={13.5} ry={2.8} o={0.55} />
      {/* forks reach the worker's ankles — the proximity IS the story */}
      <path
        d="M72.8 73.4 H63 M72.8 75 H63.8"
        stroke="#8ea2b5"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <rect x={63} y={75} width={1.6} height={1.4} fill="#6b7d90" />
      {/* mast, taller than the worker */}
      <rect x={72.4} y={44.8} width={1.5} height={31.4} fill="#42526a" />
      <rect x={74.3} y={44.8} width={1.5} height={31.4} fill="#2c394e" />
      <path
        d="M72.4 48 h3.4 M72.4 56 h3.4 M72.4 64 h3.4 M72.4 71.6 h3.4"
        stroke="#576b85"
        strokeWidth="0.7"
      />
      <path d="M72.4 44.8 h3.4" stroke="rgba(45,212,191,0.55)" strokeWidth="0.55" />
      {/* body: hood + counterweight, three values */}
      <Box
        x0={76.4}
        x1={91.5}
        yTop={62.4}
        yBot={74.2}
        t={0.1}
        front="#8a5c14"
        top="#c08a2e"
        side="#5d3f0e"
      />
      <path d="M76.4 62.4 l15.1 0 l0 -1.6 q-7 -1.8 -15.1 0 z" fill="#a06f1d" />
      <path d="M89.3 62.4 q2.6 5 1.6 11.8 l0.6 0 l0 -11.8 z" fill="#6e4a10" />
      {/* overhead guard + seat */}
      <rect x={77.4} y={50.6} width={1.2} height={11.8} fill="#3a4a60" />
      <rect x={85.8} y={50.6} width={1.2} height={11.8} fill="#2c394e" />
      <path d="M76.6 50.6 l9.8 0 l1.4 -0.4 l0 -1.3 l-12.4 0 l0 1.3 z" fill="#4a5c76" />
      <path d="M76.6 48.9 h12.4" stroke="rgba(45,212,191,0.5)" strokeWidth="0.5" />
      <rect x={80.6} y={56.8} width={4.2} height={4} rx={0.9} fill="#1d2635" />
      <rect x={87.6} y={47.4} width={1.9} height={2.2} rx={0.5} fill="#d9a13c" opacity={0.85} />
      {/* wheels */}
      <circle cx={78.2} cy={75.8} r={3.9} fill="#141b26" />
      <circle cx={78.2} cy={75.8} r={1.5} fill="#38465c" />
      <circle cx={88.6} cy={76.2} r={3} fill="#141b26" />
      <circle cx={88.6} cy={76.2} r={1.1} fill="#38465c" />

      {/* frame vignette */}
      <rect width="160" height="90" fill="url(#hero-vig)" />
    </svg>
  );
}
