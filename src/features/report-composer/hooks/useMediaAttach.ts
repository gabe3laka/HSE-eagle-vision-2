import { useCallback, useState } from "react";

/** A photo attached to a report draft, downscaled client-side to a small JPEG
 *  thumbnail. We NEVER upload raw full-res images or any video — only these
 *  bounded thumbnails travel to the agent as visual context, consistent with the
 *  app's metadata-only ethos. */
export interface AttachedMedia {
  /** data: URL JPEG thumbnail (longest side <= MAX_DIM). */
  thumb: string;
  w: number;
  h: number;
  name: string;
}

const MAX_DIM = 512;
const MAX_ITEMS = 3;
const JPEG_QUALITY = 0.6;

async function fileToThumb(file: File): Promise<AttachedMedia | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_decode_failed"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return { thumb: canvas.toDataURL("image/jpeg", JPEG_QUALITY), w, h, name: file.name };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Manage the photo attachments on the composer (add via file input, remove).
 *  Bounded to MAX_ITEMS small thumbnails. */
export function useMediaAttach() {
  const [media, setMedia] = useState<AttachedMedia[]>([]);
  const [processing, setProcessing] = useState(false);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setProcessing(true);
    try {
      const list = Array.from(files);
      const thumbs = (await Promise.all(list.map(fileToThumb))).filter(
        (t): t is AttachedMedia => t !== null,
      );
      setMedia((prev) => [...prev, ...thumbs].slice(0, MAX_ITEMS));
    } finally {
      setProcessing(false);
    }
  }, []);

  const removeAt = useCallback((i: number) => {
    setMedia((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const clear = useCallback(() => setMedia([]), []);

  return { media, processing, addFiles, removeAt, clear, atLimit: media.length >= MAX_ITEMS };
}
