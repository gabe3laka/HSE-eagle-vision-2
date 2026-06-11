/**
 * Compress a base64 JPEG crop into a small thumbnail for saved blueprints
 * (saved-thumbnail mode keeps ONLY this, never the full crop). Browser-only —
 * resolves null on SSR or any decode/canvas failure so saving never blocks.
 */
export function compressImageB64(
  imageB64: string,
  maxSide = 128,
  quality = 0.5,
): Promise<string | null> {
  if (typeof document === "undefined" || !imageB64) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const b64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
        resolve(b64 || null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/jpeg;base64,${imageB64}`;
  });
}
