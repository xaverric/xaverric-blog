import { requireAdmin } from "../auth.js";
import { HttpError, IMMUTABLE_CACHE, badRequest, json, noContent, notFoundError, readLimited } from "../http.js";
import { MAX_UPLOAD_BYTES, MEDIA_FILE, MEDIA_KEY, TYPES, contentTypeForExt, imageSize, mediaKeyFor, sniffImage, toMedia } from "../media.js";
import { deleteMedia, insertMedia, listMedia, mediaFile, mediaUsage } from "../queries.js";

const UPLOAD_TYPES = new Set(["webp", "jpeg", "png", "gif"]);
const MB = 1024 * 1024;

const edgeCache = (env) => (env.EDGE_CACHE !== "0" ? globalThis.caches?.default ?? null : null);

export const uploadMedia = async (context) => {
  await requireAdmin(context);
  const { request, env, now } = context;
  if (!env.DB) throw new HttpError(503, "unavailable", "Media storage is not configured");
  const bytes = await readLimited(request, MAX_UPLOAD_BYTES).catch((error) => {
    if (error?.status === 413) throw new HttpError(413, "too_large", `Images must be at most ${MAX_UPLOAD_BYTES / MB} MB after compression`);
    throw error;
  });
  if (bytes.length === 0) throw badRequest("body: send the image bytes");
  const type = sniffImage(bytes);
  if (!UPLOAD_TYPES.has(type)) throw new HttpError(415, "unsupported_media_type", "Only WebP, JPEG, PNG and GIF images are accepted");
  const size = imageSize(bytes, type);
  if (!size) throw badRequest("image: could not read the dimensions or they exceed 10000 px");
  const key = await mediaKeyFor(bytes);
  const row = await insertMedia(env.DB, { key, contentType: TYPES[type].contentType, size: bytes.length, ...size, bytes, nowIso: now.toISOString() });
  return json(toMedia(row), { status: 201 });
};

export const getMediaList = async (context) => {
  await requireAdmin(context);
  return json({ media: (await listMedia(context.env.DB)).map(toMedia), maxBytes: MAX_UPLOAD_BYTES });
};

export const removeMedia = async (context) => {
  await requireAdmin(context);
  const { env, params, url } = context;
  if (!MEDIA_KEY.test(params.key)) throw notFoundError("Image not found");
  const usedBy = await mediaUsage(env.DB, params.key);
  if (usedBy.length && url.searchParams.get("force") !== "1") {
    return json({ error: { code: "in_use", message: `Used by ${usedBy.length} ${usedBy.length === 1 ? "post" : "posts"}`, posts: usedBy } }, { status: 409 });
  }
  if (!(await deleteMedia(env.DB, params.key))) throw notFoundError("Image not found");
  const cache = edgeCache(env);
  if (cache) context.ctx?.waitUntil?.(Promise.all(Object.values(TYPES).map((type) => cache.delete(new Request(new URL(`/media/${params.key}.${type.ext}`, env.APP_URL).href)))).catch(() => {}));
  return noContent();
};

const mediaHeaders = (key, contentType, size) => ({
  "content-type": contentType,
  "content-length": String(size),
  "cache-control": IMMUTABLE_CACHE,
  etag: `"${key}"`,
  "x-content-type-options": "nosniff",
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; sandbox",
  "cross-origin-resource-policy": "cross-origin",
});

const toBytes = (data) => (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : Uint8Array.from(data));

const notModified = (request, key) => (request.headers.get("if-none-match") ?? "").split(",").some((tag) => tag.trim().replace(/^W\//, "") === `"${key}"`);

export const serveMedia = async ({ request, env, ctx, params }) => {
  const match = MEDIA_FILE.exec(params.file ?? "");
  if (!match) throw notFoundError("Image not found");
  const [, key, ext] = match;
  const cacheKey = new Request(new URL(`/media/${key}.${ext}`, env.APP_URL).href);
  const cache = edgeCache(env);
  const hit = cache ? await cache.match(cacheKey) : null;
  const response = hit ?? (await loadMedia(env, key, ext));
  if (!hit && cache && response.status === 200) ctx?.waitUntil?.(cache.put(cacheKey, response.clone()).catch(() => {}));
  if (response.status === 200 && notModified(request, key)) return new Response(null, { status: 304, headers: { etag: `"${key}"`, "cache-control": IMMUTABLE_CACHE } });
  return response;
};

const loadMedia = async (env, key, ext) => {
  const row = await mediaFile(env.DB, key);
  if (!row || row.content_type !== contentTypeForExt(ext)) throw notFoundError("Image not found");
  const bytes = toBytes(row.data);
  return new Response(bytes, { headers: mediaHeaders(key, row.content_type, bytes.length) });
};
