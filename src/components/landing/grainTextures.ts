/* Adapts UplinkLoader's procedural grain from ThreeUI (github.com/MengTo/threeui,
 * MIT, © Meng To / Design+Code) — see THIRD_PARTY_NOTICES.md. */

let cache: { mul: string; add: string } | null = null;

/**
 * Two 160×160 noise textures as data URLs, generated once and module-cached so
 * a remount never regenerates them. Layer A ("mul"): gaussian-ish grey for
 * `mix-blend-mode: overlay`; layer B ("add"): sparse white speckle.
 */
export function grainTextures(): { mul: string; add: string } {
  if (cache) return cache;
  const N = 160;
  const make = (fn: (d: Uint8ClampedArray, o: number) => void): string => {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) fn(img.data, i * 4);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  };
  const g = () => (Math.random() + Math.random() + Math.random() + Math.random()) / 4;
  cache = {
    mul: make((d, o) => {
      const v = 128 + (g() - 0.5) * 300;
      d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, v));
      d[o + 3] = 255;
    }),
    add: make((d, o) => {
      const v = Math.random();
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = v < 0.86 ? 0 : Math.round(((v - 0.86) / 0.14) * 190);
    }),
  };
  return cache;
}
