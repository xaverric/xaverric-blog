import { isLocalApp } from "./cookies.js";
import { IMMUTABLE_CACHE, errorResponse, readJsonBody, redirect, toErrorResponse, withSecurityHeaders } from "./http.js";
import { limitRequest } from "./rate-limit.js";
import { createRouter } from "./router.js";
import { getMediaList, removeMedia, serveMedia, uploadMedia } from "./routes/media.js";
import { adminPage, createPost, deletePost, getMe, getPost, listPosts, patchPost, previewPost, publishPost, undeletePost, unpublishPost } from "./routes/posts.js";
import { proxyImage } from "./routes/proxy.js";
import { atom, homePage, homePageN, jsonFeedRoute, notFoundPage, postDetail, robotsRoute, rss, sitemapRoute, tagPage, tagPageN } from "./routes/public.js";
import { devLogin, finishGithubLogin, logout, startGithubLogin } from "./routes/web-auth.js";

const routes = [
  { method: "GET", path: "/api/me", handler: getMe },
  { method: "GET", path: "/api/admin/posts", handler: listPosts },
  { method: "POST", path: "/api/admin/posts", handler: createPost, body: "optional" },
  { method: "GET", path: "/api/admin/posts/:id", handler: getPost },
  { method: "PATCH", path: "/api/admin/posts/:id", handler: patchPost, body: true },
  { method: "DELETE", path: "/api/admin/posts/:id", handler: deletePost },
  { method: "POST", path: "/api/admin/posts/:id/restore", handler: undeletePost },
  { method: "POST", path: "/api/admin/posts/:id/publish", handler: publishPost, body: "optional" },
  { method: "POST", path: "/api/admin/posts/:id/unpublish", handler: unpublishPost },
  { method: "POST", path: "/api/admin/preview", handler: previewPost, body: true },
  { method: "GET", path: "/api/admin/media", handler: getMediaList },
  { method: "POST", path: "/api/admin/media", handler: uploadMedia },
  { method: "DELETE", path: "/api/admin/media/:key", handler: removeMedia },
  { method: "GET", path: "/auth/github", handler: startGithubLogin },
  { method: "GET", path: "/auth/github/callback", handler: finishGithubLogin },
  { method: "GET", path: "/auth/dev", handler: devLogin },
  { method: "POST", path: "/auth/logout", handler: logout },
];

const pages = [
  { method: "GET", path: "/", handler: homePage },
  { method: "GET", path: "/page/:n", handler: homePageN },
  { method: "GET", path: "/tags/:tag", handler: tagPage },
  { method: "GET", path: "/tags/:tag/page/:n", handler: tagPageN },
  { method: "GET", path: "/rss.xml", handler: rss },
  { method: "GET", path: "/atom.xml", handler: atom },
  { method: "GET", path: "/feed.json", handler: jsonFeedRoute },
  { method: "GET", path: "/sitemap.xml", handler: sitemapRoute },
  { method: "GET", path: "/robots.txt", handler: robotsRoute },
  { method: "GET", path: "/media/:file", handler: serveMedia },
  { method: "GET", path: "/img/:sig/:payload", handler: proxyImage },
  { method: "GET", path: "/admin", handler: adminPage },
  { method: "GET", path: "/admin/posts/:id", handler: adminPage },
];

const matchApi = createRouter(routes);
const matchPage = createRouter(pages);

const isWorkerPath = (pathname) => /^\/(api|auth)(\/|$)/.test(pathname);

const ASSET_PREFIX = /^\/(css|js|fonts|build)\//;
const STATIC_FILES = new Set(["/favicon.svg", "/og-default.png"]);
const SINGLE_SEGMENT = /^\/([^/]+)$/;

const httpsUrl = (url) => {
  const secure = new URL(url);
  secure.protocol = "https:";
  return secure.href;
};

const serveAsset = async (request, env, url) => {
  const response = await env.ASSETS.fetch(request);
  if (response.status === 404) return notFoundPage(env);
  if (url.pathname.startsWith("/fonts/")) {
    const immutable = new Response(response.body, response);
    immutable.headers.set("cache-control", IMMUTABLE_CACHE);
    return immutable;
  }
  return response;
};

const handleWorkerPath = async (request, env, ctx, url, now) => {
  const found = matchApi(request.method, url.pathname);
  if (found.status === 404) return errorResponse(404, "not_found", "Not found");
  if (found.status === 405) return errorResponse(405, "invalid_request", "Method not allowed", { allow: found.allow });
  const hasBody = found.route.body === true || (found.route.body === "optional" && request.headers.get("content-type"));
  const body = hasBody ? await readJsonBody(request) : undefined;
  return found.route.handler({ request, env, url, params: found.params, body, now, ctx });
};

const handlePage = async (request, env, ctx, url, now) => {
  const found = matchPage(request.method, url.pathname);
  if (found.route) return found.route.handler({ request, env, url, params: found.params, now, ctx });
  if (found.status === 405) return errorResponse(405, "invalid_request", "Method not allowed", { allow: found.allow });
  if (ASSET_PREFIX.test(url.pathname) || STATIC_FILES.has(url.pathname)) return serveAsset(request, env, url);
  if (url.pathname === "/admin/") return redirect("/admin", [], 301);
  const single = SINGLE_SEGMENT.exec(url.pathname);
  if (single && ["GET", "HEAD"].includes(request.method)) return postDetail({ request, env, url, now, ctx }, single[1]);
  if (single) return errorResponse(405, "invalid_request", "Method not allowed", { allow: "GET, HEAD" });
  return notFoundPage(env);
};

const handle = async (request, env, ctx) => {
  const url = new URL(request.url);
  const now = new Date();
  if (url.protocol === "http:" && !isLocalApp(env)) return redirect(httpsUrl(url), [], 301);
  await limitRequest(request, env, url.pathname);
  if (isWorkerPath(url.pathname)) return handleWorkerPath(request, env, ctx, url, now);
  return handlePage(request, env, ctx, url, now);
};

export default {
  async fetch(request, env, ctx) {
    const response = await handle(request, env, ctx).catch(toErrorResponse);
    const secured = withSecurityHeaders(response, request);
    return request.method === "HEAD" ? new Response(null, secured) : secured;
  },
};
