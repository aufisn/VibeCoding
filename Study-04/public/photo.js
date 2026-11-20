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

async function decode(file) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** @returns {Promise<{ base64: string, mediaType: "image/jpeg", width: number, height: number, kb: number }>} */
export async function preparePhoto(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("That file isn't a photo.");
  let picture;
  try {
    picture = await decode(file);
  } catch {
    throw new Error("This browser can't open that photo format. Try a JPEG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible).");
  }
  const { width, height } = fitSize(picture.width, picture.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(picture, 0, 0, width, height);
  picture.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't prepare the photo.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { base64: toBase64(bytes), mediaType: "image/jpeg", width, height, kb: Math.round(bytes.length / 1024) };
}
