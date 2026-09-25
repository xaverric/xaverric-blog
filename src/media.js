import { hex } from "./encoding.js";

export const MAX_UPLOAD_BYTES = 1572864;
export const MAX_DIMENSION = 10000;
export const MEDIA_KEY = /^[0-9a-f]{32}$/;
export const MEDIA_FILE = /^([0-9a-f]{32})\.(webp|jpg|png|gif)$/;

export const TYPES = {
  webp: { contentType: "image/webp", ext: "webp" },
  jpeg: { contentType: "image/jpeg", ext: "jpg" },
  png: { contentType: "image/png", ext: "png" },
  gif: { contentType: "image/gif", ext: "gif" },
  avif: { contentType: "image/avif", ext: "avif" },
};

const EXT_TYPES = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", gif: "image/gif" };

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

const startsWith = (bytes, signature) => signature.every((byte, i) => bytes[i] === byte);

export const sniffImage = (bytes) => {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (ascii(bytes, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 4))) return "avif";
  return null;
};

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const pngSize = (bytes) => (bytes.length >= 24 && ascii(bytes, 12, 4) === "IHDR" ? { width: view(bytes).getUint32(16), height: view(bytes).getUint32(20) } : null);

const gifSize = (bytes) => (bytes.length >= 10 ? { width: view(bytes).getUint16(6, true), height: view(bytes).getUint16(8, true) } : null);

const webpSize = (bytes) => {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  const data = view(bytes);
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = data.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { width, height };
  }
  return null;
};

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpegSize = (bytes) => {
  const data = view(bytes);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = data.getUint16(offset + 2);
    if (SOF_MARKERS.has(marker)) return { width: data.getUint16(offset + 7), height: data.getUint16(offset + 5) };
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
};

const SIZE_READERS = { png: pngSize, gif: gifSize, webp: webpSize, jpeg: jpegSize };

export const imageSize = (bytes, type) => {
  const size = SIZE_READERS[type]?.(bytes) ?? null;
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) return null;
  return size;
};

export const mediaKeyFor = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 32);

export const mediaPath = (key, contentType) => `/media/${key}.${Object.values(TYPES).find((type) => type.contentType === contentType)?.ext ?? "bin"}`;

export const contentTypeForExt = (ext) => EXT_TYPES[ext] ?? null;

export const toMedia = (row) => ({
  key: row.key,
  url: mediaPath(row.key, row.content_type),
  contentType: row.content_type,
  size: row.size,
  width: row.width,
  height: row.height,
  createdAt: row.created_at,
  ...(row.uses === undefined ? {} : { uses: row.uses }),
});
