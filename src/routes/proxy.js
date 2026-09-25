import { HttpError } from "../http.js";
import { fetchProxiedImage, verifyImagePath } from "../proxy.js";
import { limitWith } from "../rate-limit.js";

const OK_CACHE = "public, max-age=2592000, immutable";
const FAIL_CACHE = "public, max-age=300";
const PLACEHOLDER = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

const imageHeaders = (contentType, cache) => ({
  "content-type": contentType,
  "cache-control": cache,
  "x-content-type-options": "nosniff",
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; sandbox",
  "referrer-policy": "no-referrer",
});

const edgeCache = (env) => (env.EDGE_CACHE !== "0" ? globalThis.caches?.default ?? null : null);

export const proxyImage = async ({ request, env, ctx, params, url, fetcher = fetch }) => {
  const href = await verifyImagePath(env, params.sig, params.payload);
  if (!href) throw new HttpError(403, "forbidden", "Invalid image signature");
  const cache = edgeCache(env);
  const cacheKey = new Request(new URL(url.pathname, env.APP_URL).href);
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) return hit;
  await limitWith(env.API_LIMITER, request);
  const result = await fetchProxiedImage(href, fetcher);
  const response = result.ok
    ? new Response(result.bytes, { headers: imageHeaders(result.contentType, OK_CACHE) })
    : new Response(PLACEHOLDER, { status: 404, headers: { ...imageHeaders("image/gif", FAIL_CACHE), "x-proxy-error": result.reason } });
  if (cache) ctx?.waitUntil?.(cache.put(cacheKey, response.clone()).catch(() => {}));
  return response;
};
