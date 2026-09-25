import { afterEach, describe, expect, it, vi } from "vitest";
import { base64urlEncode, utf8 } from "../../src/encoding.js";
import { PROXY_MAX_BYTES, fetchProxiedImage, isPublicImageUrl, keyFingerprint, signImageUrl, verifyImagePath } from "../../src/proxy.js";
import { TEST_SECRET, call, makeEnv, pngBytes } from "./helpers.js";

const env = makeEnv();

afterEach(() => vi.restoreAllMocks());

const upstream = (routes) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const route = routes[url];
    if (!route) return new Response("nope", { status: 404 });
    return typeof route === "function" ? route(init) : route();
  });

const png = () => new Response(pngBytes(8, 8), { headers: { "content-type": "image/png", "set-cookie": "tracker=1" } });

describe("url policy", () => {
  it.each([
    ["https://images.example.org/a.png", true],
    ["https://cdn.example.com/path/to/img.webp?w=800", true],
    ["http://images.example.org/a.png", false],
    ["https://images.example.org:8443/a.png", false],
    ["https://user:pw@images.example.org/a.png", false],
    ["https://127.0.0.1/a.png", false],
    ["https://2130706433/a.png", false],
    ["https://[::1]/a.png", false],
    ["https://localhost/a.png", false],
    ["https://printer.local/a.png", false],
    ["https://intranet/a.png", false],
    ["https://blog.xaverric.cz/media/x.png", false],
    ["https://xaverric.cz/a.png", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["data:image/png;base64,AAAA", false],
  ])("%s -> %s", (url, allowed) => {
    expect(isPublicImageUrl(url)).toBe(allowed);
  });
});

describe("signatures", () => {
  it("signs and verifies a URL", async () => {
    const path = await signImageUrl(env, "https://images.example.org/a.png");
    const [, , sig, payload] = path.split("/");
    expect(sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await verifyImagePath(env, sig, payload)).toBe("https://images.example.org/a.png");
  });

  it("refuses tampered payloads and signatures", async () => {
    const [, , sig, payload] = (await signImageUrl(env, "https://images.example.org/a.png")).split("/");
    const other = base64urlEncode(utf8("https://images.example.org/b.png"));
    expect(await verifyImagePath(env, sig, other)).toBeNull();
    expect(await verifyImagePath(env, `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, payload)).toBeNull();
    expect(await verifyImagePath(env, "short", payload)).toBeNull();
    expect(await verifyImagePath(env, sig, "***")).toBeNull();
  });

  it("does not sign blocked URLs", async () => {
    expect(await signImageUrl(env, "https://localhost/a.png")).toBeNull();
  });

  it("derives a distinct key from IMAGE_PROXY_SECRET", async () => {
    const own = makeEnv({ IMAGE_PROXY_SECRET: "another-image-proxy-secret-0123456789" });
    const a = await signImageUrl(env, "https://images.example.org/a.png");
    const b = await signImageUrl(own, "https://images.example.org/a.png");
    expect(a).not.toBe(b);
    expect(await keyFingerprint(env)).not.toBe(await keyFingerprint(own));
    const [, , sig, payload] = b.split("/");
    expect(await verifyImagePath(env, sig, payload)).toBeNull();
    expect(TEST_SECRET).toBe(env.SESSION_SECRET);
  });
});

describe("fetching", () => {
  it("returns sniffed image bytes", async () => {
    upstream({ "https://images.example.org/a.png": png });
    const result = await fetchProxiedImage("https://images.example.org/a.png");
    expect(result).toMatchObject({ ok: true, contentType: "image/png" });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.headers.accept).toContain("image/");
  });

  it("follows up to three redirects and re-validates each target", async () => {
    const hop = (to) => () => new Response(null, { status: 302, headers: { location: to } });
    upstream({
      "https://a.example.org/1": hop("https://a.example.org/2"),
      "https://a.example.org/2": hop("/3"),
      "https://a.example.org/3": hop("https://b.example.org/final.png"),
      "https://b.example.org/final.png": png,
      "https://a.example.org/evil": hop("https://127.0.0.1/secret"),
      "https://a.example.org/loop": hop("https://a.example.org/loop"),
    });
    expect((await fetchProxiedImage("https://a.example.org/1")).ok).toBe(true);
    expect(await fetchProxiedImage("https://a.example.org/evil")).toEqual({ ok: false, reason: "redirect blocked" });
    expect(await fetchProxiedImage("https://a.example.org/loop")).toEqual({ ok: false, reason: "too many redirects" });
  });

  it.each([
    ["an SVG", () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }), "not an image"],
    ["HTML", () => new Response("<html>", { headers: { "content-type": "text/html" } }), "not an image"],
    ["a lie about the type", () => new Response("<svg/>", { headers: { "content-type": "image/png" } }), "unknown image format"],
    ["an error", () => new Response("x", { status: 500, headers: { "content-type": "image/png" } }), "upstream 500"],
    ["a declared huge body", () => new Response(pngBytes(), { headers: { "content-type": "image/png", "content-length": String(PROXY_MAX_BYTES + 1) } }), "too large"],
  ])("refuses %s", async (name, route, reason) => {
    upstream({ "https://images.example.org/x": route });
    expect(await fetchProxiedImage("https://images.example.org/x")).toEqual({ ok: false, reason });
  });

  it("stops streaming past the size cap", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(pngBytes());
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        sent += 1;
        if (sent > 20) controller.close();
        else controller.enqueue(chunk.slice());
      },
    });
    upstream({ "https://images.example.org/big": () => new Response(body, { headers: { "content-type": "image/png" } }) });
    expect(await fetchProxiedImage("https://images.example.org/big")).toEqual({ ok: false, reason: "too large" });
    expect(sent).toBeLessThan(12);
  });
});

describe("GET /img", () => {
  it("serves a proxied image with strict headers and no upstream cookies", async () => {
    upstream({ "https://images.example.org/a.png": png });
    const path = await signImageUrl(env, "https://images.example.org/a.png");
    const response = await call("GET", path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("max-age=2592000");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers 403 for unsigned or tampered paths", async () => {
    const [, , sig] = (await signImageUrl(env, "https://images.example.org/a.png")).split("/");
    expect((await call("GET", `/img/${sig}/${base64urlEncode(utf8("https://images.example.org/other.png"))}`)).status).toBe(403);
    expect((await call("GET", `/img/${"A".repeat(22)}/${base64urlEncode(utf8("https://images.example.org/a.png"))}`)).status).toBe(403);
  });

  it("returns a small GIF placeholder with 404 on upstream failure", async () => {
    upstream({});
    const response = await call("GET", await signImageUrl(env, "https://images.example.org/missing.png"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("image/gif");
  });

  it("is rate limited per client on cache misses", async () => {
    upstream({ "https://images.example.org/a.png": png });
    const denied = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const response = await call("GET", await signImageUrl(env, "https://images.example.org/a.png"), { env: { API_LIMITER: denied }, headers: { "cf-connecting-ip": "203.0.113.9" } });
    expect(response.status).toBe(429);
    expect(denied.limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
  });

  it("serves repeat requests from the edge cache", async () => {
    upstream({ "https://images.example.org/cached.png": png });
    const path = await signImageUrl(env, "https://images.example.org/cached.png");
    expect((await call("GET", path, { env: { EDGE_CACHE: "1" } })).status).toBe(200);
    expect((await call("GET", path, { env: { EDGE_CACHE: "1" } })).status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
