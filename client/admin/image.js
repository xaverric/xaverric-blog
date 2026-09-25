export const MAX_EDGE = 1600;
export const MAX_BYTES = 1572864;
export const WEBP_QUALITY = 0.82;
export const ACCEPTED = ["image/webp", "image/jpeg", "image/png", "image/gif"];

export const fitWithin = (width, height, max = MAX_EDGE) => {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

export const altFromName = (name) =>
  String(name ?? "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

export const keepsOriginal = (file) => file.type === "image/gif" && file.size <= MAX_BYTES;

const canvasFor = (width, height) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const encode = async (canvas, type, quality) => {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
};

export const prepareImage = async (file) => {
  if (!ACCEPTED.includes(file.type)) throw new Error("Use a WebP, JPEG, PNG or GIF image.");
  if (keepsOriginal(file)) return file;
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = canvasFor(size.width, size.height);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();
  let blob = await encode(canvas, "image/webp", WEBP_QUALITY);
  if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", WEBP_QUALITY);
  if (!blob) throw new Error("This browser could not compress the image.");
  if (blob.size > MAX_BYTES) throw new Error(`The image is still ${(blob.size / 1048576).toFixed(1)} MB after compression; the limit is 1.5 MB.`);
  return blob;
};
