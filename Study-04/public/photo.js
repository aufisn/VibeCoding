// Shrinks a photo in the browser before it's sent: at most 1568 px on the
// long side (more detail than Claude uses), as JPEG. A 4 MB phone photo
// becomes about 300 KB, so it uploads fast and costs fewer tokens.

import { toBase64 } from "./fc-crypto.js";

export const MAX_SIDE = 1568;

/** Width and height that fit within `max` on the long side. Pure. */
export function fitSize(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Loads the photo into an <img> (EXIF orientation applied). Waiting for "load"
 * (not img.decode()) means the browser has read the size but not unpacked
 * every pixel yet. Call `release()` once it has been drawn.
 */
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return { img, release: () => URL.revokeObjectURL(url) };
}

/**
 * The photo at the size to send. A 48 MP phone photo decoded at full size is
 * ~190 MB of pixels; asking createImageBitmap to resize while decoding keeps
 * it to ~7 MB. Returns { picture, width, height, release }.
 */
async function decode(file) {
  const { img, release } = await loadImage(file); // throws for formats this browser can't open
  const size = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (globalThis.createImageBitmap && (size.width < img.naturalWidth || size.height < img.naturalHeight)) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" });
      // A browser that resizes before turning the photo upright gives the
      // sides swapped (and the picture squashed): use the plain path then.
      if (bitmap.width === size.width && bitmap.height === size.height) {
        release();
        return { picture: bitmap, ...size, release: () => bitmap.close?.() };
      }
      bitmap.close?.();
    } catch {
      /* resize options not supported: the <img> below works everywhere */
    }
  }
  return { picture: img, ...size, release };
}

/** @returns {Promise<{ base64: string, mediaType: "image/jpeg", width: number, height: number, kb: number }>} */
export async function preparePhoto(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("That file isn't a photo.");
  let picture, width, height, release;
  try {
    ({ picture, width, height, release } = await decode(file));
  } catch {
    throw new Error("This browser can't open that photo format. Try a JPEG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible).");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext("2d").drawImage(picture, 0, 0, width, height);
  } finally {
    release();
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't prepare the photo.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { base64: toBase64(bytes), mediaType: "image/jpeg", width, height, kb: Math.round(bytes.length / 1024) };
}
