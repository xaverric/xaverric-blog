import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_SECURITY_POLICY, MAX_JSON_BYTES, SECURITY_HEADERS, readJsonBody } from "../../src/http.js";
import { adminCookie, call, insertPost, resetDb } from "./helpers.js";

beforeEach(resetDb);

const parseHeadersFile = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((line) => /^\s+\S/.test(line))
      .map((line) => line.trim().split(/:\s(.*)/s).slice(0, 2))
      .map(([name, value]) => [name.toLowerCase(), value]),
  );

describe("security headers", () => {
  it.each([
    ["home", "/"],
    ["post", "/hello"],
    ["404 page", "/missing"],
    ["admin redirect", "/admin"],
    ["asset", "/css/base.css"],
    ["font", "/fonts/Newsreader-latin.woff2"],
    ["api error", "/api/admin/posts"],
    ["feed", "/rss.xml"],
    ["robots", "/robots.txt"],
  ])("are set on the %s", async (name, path) => {
    await insertPost({ slug: "hello" });
    const response = await call("GET", path);
    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("keeps the CSP strict: self-hosted scripts, styles and images only", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self';");
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self';");
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data:;");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it("marks only private paths noindex", async () => {
    expect((await call("GET", "/api/me")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("GET", "/auth/dev")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("GET", "/admin")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("GET", "/")).headers.get("x-robots-tag")).toBeNull();
  });

  it("caches fonts immutably", async () => {
    expect((await call("GET", "/fonts/Newsreader-latin.woff2")).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("_headers matches the Worker headers", () => {
    const file = parseHeadersFile(env.TEST_STATIC_HEADERS);
    expect(env.TEST_STATIC_HEADERS.startsWith("/*\n")).toBe(true);
    Object.entries(SECURITY_HEADERS).forEach(([name, value]) => expect(file[name]).toBe(value));
    expect(file["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("strips the body of HEAD responses", async () => {
    const response = await call("HEAD", "/missing");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("transport", () => {
  it("redirects plain http to https in production", async () => {
    const response = await call("GET", "http://blog.xaverric.cz/hello");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://blog.xaverric.cz/hello");
  });
});

describe("rate limits", () => {
  it("limits auth and api routes by their own limiter", async () => {
    const denied = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const auth = await call("GET", "/auth/github", { env: { AUTH_LIMITER: denied } });
    expect(auth.status).toBe(429);
    expect(auth.headers.get("retry-after")).toBe("60");
    expect((await call("GET", "/api/admin/posts", { env: { API_LIMITER: denied } })).status).toBe(429);
    expect(denied.limit).toHaveBeenCalledTimes(2);
  });

  it("does not limit public pages", async () => {
    const denied = { limit: vi.fn().mockResolvedValue({ success: false }) };
    expect((await call("GET", "/", { env: { API_LIMITER: denied, AUTH_LIMITER: denied } })).status).toBe(200);
  });

  it("skips limiting when the bindings are absent", async () => {
    const cookie = await adminCookie();
    expect((await call("GET", "/api/admin/posts", { headers: { cookie }, env: { API_LIMITER: undefined } })).status).toBe(200);
  });
});

describe("bodies", () => {
  it("rejects oversized JSON bodies", async () => {
    const cookie = await adminCookie();
    const raw = JSON.stringify({ bodyMd: "a".repeat(MAX_JSON_BYTES) });
    const response = await call("POST", "/api/admin/preview", { raw, headers: { cookie, "content-type": "application/json" } });
    expect(response.status).toBe(413);
  });

  it("rejects invalid JSON and wrong content types", async () => {
    const request = new Request("https://blog.xaverric.cz/api/admin/posts", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 400 });
    const cookie = await adminCookie();
    expect((await call("PATCH", "/api/admin/posts/1", { raw: "title=x", headers: { cookie, "content-type": "text/plain" } })).status).toBe(400);
  });

  it("answers internal errors without details", async () => {
    const cookie = await adminCookie();
    const response = await call("GET", "/api/admin/posts", {
      headers: { cookie },
      env: {
        DB: {
          prepare: (sql) => {
            if (sql.includes("web_sessions")) return env.DB.prepare(sql);
            throw new Error("secret detail");
          },
        },
      },
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret detail");
  });
});
