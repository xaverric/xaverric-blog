import { fromEdge, toEdge } from "../cache.js";
import { FEED_SIZE, atomFeed, jsonFeed, robots, rssFeed, sitemap } from "../feeds.js";
import { PUBLIC_HTML_CACHE, html } from "../http.js";
import { messagePage } from "../pages/layout.js";
import { overviewPage, postPage } from "../pages/public.js";
import { PAGE_SIZE, isPublicSlug, normalizeTag } from "../posts.js";
import { feedPosts, publicPostBySlug, publicPosts, sitemapRows, storeRendered } from "../queries.js";
import { htmlVersion, renderBody } from "../render/post.js";

const PAGE_NUMBER = /^[1-9][0-9]{0,4}$/;
const FEED_CACHE = "public, max-age=300, s-maxage=900";

export const notFoundPage = (env) =>
  messagePage(env, 404, "Page not found", "There is nothing at this address. The post may have moved or was never published.", {
    headers: { "cache-control": "public, max-age=60" },
  });

const cachedPage = async ({ request, env, ctx, url }, build) => {
  const hit = await fromEdge(env, request, url);
  if (hit) return hit;
  const response = await build();
  return toEdge(env, ctx, url, response);
};

const publicHtml = (body) => html(body, { headers: { "cache-control": PUBLIC_HTML_CACHE } });

const parsePage = (value) => (value === undefined ? 1 : PAGE_NUMBER.test(value) ? Number(value) : null);

const listing = async (context, { tag, pageValue }) => {
  const { env } = context;
  const current = parsePage(pageValue);
  if (!current || (pageValue !== undefined && current === 1)) return notFoundPage(env);
  if (tag !== undefined && (normalizeTag(tag) !== tag || !tag)) return notFoundPage(env);
  const { posts, total } = await publicPosts(env.DB, { limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE, tag });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (current > pages || (tag && total === 0)) return notFoundPage(env);
  return publicHtml(overviewPage(env, { posts, total, current, pages, tag }));
};

export const homePage = (context) => cachedPage(context, () => listing(context, {}));

export const homePageN = (context) => cachedPage(context, () => listing(context, { pageValue: context.params.n }));

export const tagPage = (context) => cachedPage(context, () => listing(context, { tag: context.params.tag }));

export const tagPageN = (context) => cachedPage(context, () => listing(context, { tag: context.params.tag, pageValue: context.params.n }));

const renderedFor = async (context, post) => {
  const { env, ctx } = context;
  if (post.html_version === (await htmlVersion(env))) {
    return { html: post.body_html, toc: JSON.parse(post.toc_json || "[]"), summary: "" };
  }
  const rendered = await renderBody(env, post.body_md);
  const store = storeRendered(env.DB, post.id, rendered).catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(store);
  else await store;
  return rendered;
};

export const postDetail = async (context, slug) =>
  cachedPage(context, async () => {
    const { env } = context;
    if (!isPublicSlug(slug)) return notFoundPage(env);
    const post = await publicPostBySlug(env.DB, slug);
    if (!post) return notFoundPage(env);
    return publicHtml(postPage(env, post, await renderedFor(context, post)));
  });

const freshFeedPosts = async (context) => {
  const posts = await feedPosts(context.env.DB, FEED_SIZE);
  const version = await htmlVersion(context.env);
  return Promise.all(posts.map(async (post) => (post.html_version === version ? post : { ...post, body_html: (await renderedFor(context, post)).html })));
};

const text = (body, type, cache = FEED_CACHE) => new Response(body, { headers: { "content-type": type, "cache-control": cache } });

const feedHeaders = { "cross-origin-resource-policy": "cross-origin" };

export const rss = (context) =>
  cachedPage(context, async () => {
    const response = text(rssFeed(context.env, await freshFeedPosts(context), context.now), "application/rss+xml; charset=utf-8");
    Object.entries(feedHeaders).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  });

export const atom = (context) =>
  cachedPage(context, async () => {
    const response = text(atomFeed(context.env, await freshFeedPosts(context), context.now), "application/atom+xml; charset=utf-8");
    Object.entries(feedHeaders).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  });

export const jsonFeedRoute = (context) =>
  cachedPage(context, async () => {
    const response = text(JSON.stringify(jsonFeed(context.env, await freshFeedPosts(context))), "application/feed+json; charset=utf-8");
    Object.entries(feedHeaders).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  });

export const sitemapRoute = (context) =>
  cachedPage(context, async () => text(sitemap(context.env, await sitemapRows(context.env.DB)), "application/xml; charset=utf-8"));

export const robotsRoute = ({ env }) => text(robots(env), "text/plain; charset=utf-8", "public, max-age=3600");
