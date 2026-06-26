/**
 * Pure 3×3 homography math for Hive Mode ground-plane projection.
 *
 * All homographies are row-major 9-element arrays:
 *   [ h0 h1 h2
 *     h3 h4 h5
 *     h6 h7 h8 ]
 * mapping (x, y) → ( (h0x+h1y+h2)/(h6x+h7y+h8), (h3x+h4y+h5)/(h6x+h7y+h8) ).
 *
 * solveHomography uses normalized DLT (Hartley normalization): points are
 * translated to their centroid and scaled to RMS distance √2 before solving,
 * then the result is denormalized. This is numerically stable and matches the
 * classic getPerspectiveTransform behaviour. No external SVD dependency —
 * for the (over)determined system we fix h8 = 1 and solve the linear system via
 * Gaussian elimination with partial pivoting (the floor-plane case never has a
 * true vanishing h8).
 */

export interface Pt {
  x: number;
  y: number;
}

/** Apply a 3×3 homography to a 2D point. Returns null on degenerate w. */
export function applyHomographyPoint(H: number[], x: number, y: number): Pt | null {
  if (!H || H.length !== 9) return null;
  const w = H[6] * x + H[7] * y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  const ox = (H[0] * x + H[1] * y + H[2]) / w;
  const oy = (H[3] * x + H[4] * y + H[5]) / w;
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  return { x: ox, y: oy };
}

/** Multiply two row-major 3×3 matrices. */
function mul3(a: number[], b: number[]): number[] {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

/** Invert a row-major 3×3 matrix. Returns null when singular. */
export function invertHomography(H: number[]): number[] | null {
  if (!H || H.length !== 9) return null;
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  const invDet = 1 / det;
  return [
    A * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    C * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/** Solve a square linear system M·x = v via Gaussian elimination with partial
 *  pivoting. Returns null when singular. M is row-major n×n. */
function solveLinear(M: number[][], v: number[]): number[] | null {
  const n = v.length;
  // Augmented copy.
  const a = M.map((row, r) => [...row, v[r]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(a[r][col]);
      if (mag > best) {
        best = mag;
        pivot = r;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
    }
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) a[r][k] -= factor * a[col][k];
    }
  }
  // Back-substitute.
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Hartley normalization: returns the 3×3 similarity T that maps the points to
 *  centroid 0 and mean distance √2, plus the transformed points. */
function normalizePoints(pts: Pt[]): { T: number[]; normed: Pt[] } | null {
  const n = pts.length;
  if (n === 0) return null;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let meanDist = 0;
  for (const p of pts) meanDist += Math.hypot(p.x - cx, p.y - cy);
  meanDist /= n;
  if (meanDist < 1e-12) return null;
  const s = Math.SQRT2 / meanDist;
  const T = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  const normed = pts.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) }));
  return { T, normed };
}

/**
 * Solve the homography mapping srcPts → dstPts. 4 points = exact; 5+ points =
 * least-squares (normal equations). Returns a row-major 9-array, or null when
 * the configuration is degenerate (collinear points, too few points).
 */
export function solveHomography(srcPts: Pt[], dstPts: Pt[]): number[] | null {
  if (srcPts.length < 4 || srcPts.length !== dstPts.length) return null;

  const ns = normalizePoints(srcPts);
  const nd = normalizePoints(dstPts);
  if (!ns || !nd) return null;

  // Build the linear system in 8 unknowns (h0..h7), fixing h8 = 1:
  //   h0 x + h1 y + h2 - h6 x x' - h7 y x' = x'
  //   h3 x + h4 y + h5 - h6 x y' - h7 y y' = y'
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let k = 0; k < ns.normed.length; k++) {
    const { x, y } = ns.normed[k];
    const { x: X, y: Y } = nd.normed[k];
    rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    rhs.push(X);
    rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    rhs.push(Y);
  }

  let h: number[] | null;
  if (rows.length === 8) {
    // Exact 4-point system.
    h = solveLinear(rows, rhs);
  } else {
    // Overdetermined → normal equations (AᵀA) h = Aᵀb (8×8).
    const ata: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
    const atb: number[] = new Array(8).fill(0);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < 8; i++) {
        atb[i] += row[i] * rhs[r];
        for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
      }
    }
    h = solveLinear(ata, atb);
  }
  if (!h) return null;

  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];

  // Denormalize: H = T_dst⁻¹ · Hn · T_src.
  const invTd = invertHomography(nd.T);
  if (!invTd) return null;
  const H = mul3(invTd, mul3(Hn, ns.T));

  // Normalize so H[8] = 1 for a canonical, comparable representation.
  if (Math.abs(H[8]) < 1e-12) return null;
  const scale = 1 / H[8];
  return H.map((v) => v * scale);
}

/** RMS reprojection error of H mapping srcPts → dstPts, in the dst domain. */
export function reprojectionError(
  H: number[],
  srcPts: Pt[],
  dstPts: Pt[],
): { rmsImageNorm: number; samples: number } {
  let sumSq = 0;
  let n = 0;
  for (let k = 0; k < srcPts.length; k++) {
    const p = applyHomographyPoint(H, srcPts[k].x, srcPts[k].y);
    if (!p) continue;
    const dx = p.x - dstPts[k].x;
    const dy = p.y - dstPts[k].y;
    sumSq += dx * dx + dy * dy;
    n++;
  }
  if (n === 0) return { rmsImageNorm: Number.POSITIVE_INFINITY, samples: 0 };
  return { rmsImageNorm: Math.sqrt(sumSq / n), samples: n };
}
