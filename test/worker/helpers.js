import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../../src/index.js";
import { cookieName } from "../../src/cookies.js";
import { SESSION_COOKIE, createSession } from "../../src/session.js";

export const ORIGIN = "https://blog.xaverric.cz";

export const ADMIN_ID = 19148363;

export const TEST_SECRET = "test-session-secret-0123456789abcdef";

export const okLimiter = () => ({ limit: async () => ({ success: true }) });

const ASSETS = {
  "/admin.html": ["<!doctype html><title>admin</title>", "text/html"],
  "/css/base.css": ["body{}", "text/css"],
  "/fonts/Newsreader-latin.woff2": ["font", "font/woff2"],
  "/favicon.svg": ["<svg/>", "image/svg+xml"],
};

export const assets = {
  fetch: async (request) => {
    const found = ASSETS[new URL(request.url).pathname];
    return found ? new Response(found[0], { headers: { "content-type": found[1] } }) : new Response("missing", { status: 404 });
  },
};

export const makeEnv = (overrides = {}) => ({
  DB: env.DB,
  AUTH_LIMITER: okLimiter(),
  API_LIMITER: okLimiter(),
  ASSETS: assets,
  APP_URL: ORIGIN,
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: TEST_SECRET,
  ADMIN_GITHUB_IDS: String(ADMIN_ID),
  EDGE_CACHE: "0",
  ...overrides,
});

export const call = async (method, path, { body, headers = {}, env: envOverrides, raw, cf } = {}) => {
  const init = { method, headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) };
  if (raw !== undefined) init.body = raw;
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] ??= "application/json";
  }
  if (init.headers.cookie && !["GET", "HEAD"].includes(method) && !("origin" in headers)) init.headers.origin = ORIGIN;
  if (cf) init.cf = cf;
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(new URL(path, ORIGIN), init), makeEnv(envOverrides), ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

export const resetDb = () => env.DB.batch(["posts", "media", "web_sessions", "users"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));

export const insertUser = async (githubId, login) =>
  (await env.DB.prepare("INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?1, ?2, ?2, NULL, ?3) RETURNING id")
    .bind(githubId, login, new Date().toISOString())
    .first()).id;

export const sessionCookie = async (uid, exp = Math.floor(Date.now() / 1000) + 3600) =>
  `${cookieName(SESSION_COOKIE, makeEnv())}=${await createSession(makeEnv(), uid, Math.floor(Date.now() / 1000), exp)}`;

export const adminCookie = async () => sessionCookie(await insertUser(ADMIN_ID, "xaverric"));

export const strangerCookie = async () => sessionCookie(await insertUser(42, "someone"));

let slugCounter = 0;

export const insertPost = async (fields = {}) => {
  slugCounter += 1;
  const now = new Date().toISOString();
  const row = {
    slug: `post-${slugCounter}`,
    title: `Post ${slugCounter}`,
    excerpt: "",
    body_md: "Hello.",
    body_html: "<p>Hello.</p>\n",
    html_version: "",
    tags: "[]",
    status: "published",
    published_at: now,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    cover_key: null,
    ...fields,
  };
  return (
    await env.DB.prepare(
      `INSERT INTO posts (slug, title, excerpt, body_md, body_html, html_version, tags, status, published_at, created_at, updated_at, deleted_at, cover_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id, slug`,
    )
      .bind(row.slug, row.title, row.excerpt, row.body_md, row.body_html, row.html_version, row.tags, row.status, row.published_at, row.created_at, row.updated_at, row.deleted_at, row.cover_key)
      .first()
  );
};

export const githubUser = (id, login) => ({ id, login, name: login, avatar_url: `https://avatars.githubusercontent.com/u/${id}` });

export const mockGithub = ({ users = {}, codes = {} } = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === "https://github.com/login/oauth/access_token") {
      const { code } = await request.json();
      return Response.json(codes[code] ? { access_token: codes[code] } : { error: "bad_verification_code" });
    }
    if (url.href === "https://api.github.com/applications/test-client-id/token" && request.method === "POST") {
      const { access_token: checked } = await request.json();
      return users[checked] ? Response.json({ user: users[checked] }) : Response.json({ message: "Not Found" }, { status: 404 });
    }
    return new Response("unexpected", { status: 599 });
  });

export const setCookies = (response) => response.headers.getSetCookie();

const u32be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export const pngBytes = (width = 4, height = 3, padding = 0) =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0, ...new Array(padding).fill(0)]);

export const gifBytes = (width = 2, height = 5) => Uint8Array.from([...new TextEncoder().encode("GIF89a"), width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0, 0x3b]);

export const webpBytes = (width = 1600, height = 900) => {
  const w = width - 1;
  const h = height - 1;
  const bytes = new Uint8Array(40);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  bytes.set([10, 0, 0, 0, 0, 0, 0, 0], 16);
  bytes.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24);
  return bytes;
};

export const jpegBytes = (width = 640, height = 480) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
