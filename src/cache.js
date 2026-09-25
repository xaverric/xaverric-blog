import { readTags } from "./posts.js";

const edgeCache = () => globalThis.caches?.default ?? null;

export const edgeCacheEnabled = (env) => env.EDGE_CACHE !== "0" && Boolean(edgeCache());

const cacheKey = (env, path) => new Request(new URL(path, env.APP_URL).href, { method: "GET" });

export const fromEdge = async (env, request, url) => {
  if (!edgeCacheEnabled(env) || !["GET", "HEAD"].includes(request.method)) return null;
  const hit = await edgeCache().match(cacheKey(env, url.pathname + url.search));
  return hit ?? null;
};

export const toEdge = (env, ctx, url, response) => {
  if (!edgeCacheEnabled(env) || response.status !== 200 || !ctx?.waitUntil) return response;
  ctx.waitUntil(edgeCache().put(cacheKey(env, url.pathname + url.search), response.clone()).catch(() => {}));
  return response;
};

const FEED_PATHS = ["/", "/rss.xml", "/atom.xml", "/feed.json", "/sitemap.xml"];

export const dropCachedPages = async (env, rows) => {
  if (!edgeCacheEnabled(env)) return;
  const paths = new Set(FEED_PATHS);
  rows.filter(Boolean).forEach((row) => {
    paths.add(`/${row.slug}`);
    readTags(row.tags).forEach((tag) => paths.add(`/tags/${tag}`));
  });
  await Promise.all([...paths].map((path) => edgeCache().delete(cacheKey(env, path))));
};
