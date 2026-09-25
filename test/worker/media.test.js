import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index.js";
import { MAX_UPLOAD_BYTES, imageSize, sniffImage } from "../../src/media.js";
import { ORIGIN, adminCookie, call, gifBytes, insertPost, jpegBytes, makeEnv, pngBytes, resetDb, strangerCookie, webpBytes } from "./helpers.js";

let cookie;

beforeEach(async () => {
  await resetDb();
  cookie = await adminCookie();
});

const upload = (bytes, headers = {}) => call("POST", "/api/admin/media", { raw: bytes, headers: { cookie, "content-type": "application/octet-stream", ...headers } });

describe("image sniffing", () => {
  it.each([
    ["png", pngBytes(640, 480), { width: 640, height: 480 }],
    ["gif", gifBytes(300, 200), { width: 300, height: 200 }],
    ["webp", webpBytes(1600, 900), { width: 1600, height: 900 }],
    ["jpeg", jpegBytes(1024, 768), { width: 1024, height: 768 }],
  ])("reads %s dimensions from the header", (type, bytes, size) => {
    expect(sniffImage(bytes)).toBe(type);
    expect(imageSize(bytes, type)).toEqual(size);
  });

  it("does not trust names or declared types", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html><body>hi</body></html>"))).toBeNull();
    expect(imageSize(pngBytes(0, 10), "png")).toBeNull();
    expect(imageSize(pngBytes(20000, 10), "png")).toBeNull();
  });
});

describe("upload", () => {
  it("stores an image by content hash and is idempotent", async () => {
    const response = await upload(webpBytes(1200, 800));
    expect(response.status).toBe(201);
    const media = await response.json();
    expect(media).toMatchObject({ contentType: "image/webp", width: 1200, height: 800, size: 40 });
    expect(media.key).toMatch(/^[0-9a-f]{32}$/);
    expect(media.url).toBe(`/media/${media.key}.webp`);
    const again = await (await upload(webpBytes(1200, 800))).json();
    expect(again.key).toBe(media.key);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first()).n).toBe(1);
  });

  it("uses the sniffed type, not the declared one", async () => {
    const media = await (await upload(pngBytes(), { "content-type": "image/webp" })).json();
    expect(media.contentType).toBe("image/png");
    expect(media.url).toMatch(/\.png$/);
  });

  it.each([
    ["SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 415],
    ["HTML", new TextEncoder().encode("<!doctype html><script>x</script>"), 415],
    ["a PDF", new TextEncoder().encode("%PDF-1.7 fake pdf body"), 415],
    ["an empty body", new Uint8Array(), 400],
    ["a truncated PNG", pngBytes().slice(0, 14), 400],
    ["a PNG without dimensions", pngBytes(0, 0), 400],
  ])("rejects %s", async (name, bytes, status) => {
    expect((await upload(bytes)).status).toBe(status);
  });

  it("rejects bodies above the limit, declared or streamed", async () => {
    const big = pngBytes(10, 10, MAX_UPLOAD_BYTES);
    const response = await upload(big);
    expect(response.status).toBe(413);
    expect((await response.json()).error.message).toContain("1.5 MB");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const request = new Request(`${ORIGIN}/api/admin/media`, { method: "POST", body: stream, duplex: "half", headers: { cookie, origin: ORIGIN } });
    const ctx = createExecutionContext();
    const streamed = await worker.fetch(request, makeEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(streamed.status).toBe(413);
  });

  it("needs the owner", async () => {
    expect((await call("POST", "/api/admin/media", { raw: pngBytes() })).status).toBe(401);
    expect((await call("POST", "/api/admin/media", { raw: pngBytes(), headers: { cookie: await strangerCookie() } })).status).toBe(403);
  });
});

describe("serving", () => {
  it("serves the bytes immutable with an ETag and answers 304", async () => {
    const bytes = gifBytes(3, 4);
    const media = await (await upload(bytes)).json();
    const response = await call("GET", media.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe(`"${media.key}"`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    const cached = await call("GET", media.url, { headers: { "if-none-match": `"${media.key}"` } });
    expect(cached.status).toBe(304);
  });

  it("404s on a wrong extension, a malformed key or a missing file", async () => {
    const media = await (await upload(gifBytes())).json();
    expect((await call("GET", `/media/${media.key}.png`)).status).toBe(404);
    expect((await call("GET", "/media/nothex.webp")).status).toBe(404);
    expect((await call("GET", `/media/${"0".repeat(32)}.webp`)).status).toBe(404);
    expect((await call("GET", `/media/${media.key}.svg`)).status).toBe(404);
  });

  it("answers from the edge cache once warmed", async () => {
    const media = await (await upload(pngBytes(7, 7))).json();
    const edge = { EDGE_CACHE: "1" };
    expect((await call("GET", media.url, { env: edge })).status).toBe(200);
    await env.DB.prepare("DELETE FROM media").run();
    const hit = await call("GET", media.url, { env: edge });
    expect(hit.status).toBe(200);
    expect(hit.headers.get("etag")).toBe(`"${media.key}"`);
    await caches.default.delete(new Request(`${ORIGIN}${media.url}`));
  });
});

describe("library", () => {
  it("lists images with usage counts and warns before deleting a used one", async () => {
    const used = await (await upload(pngBytes(5, 5))).json();
    const free = await (await upload(gifBytes(5, 5))).json();
    await insertPost({ body_md: `![x](${used.url})`, status: "draft" });
    const list = await (await call("GET", "/api/admin/media", { headers: { cookie } })).json();
    expect(list.maxBytes).toBe(MAX_UPLOAD_BYTES);
    expect(Object.fromEntries(list.media.map((item) => [item.key, item.uses]))).toEqual({ [used.key]: 1, [free.key]: 0 });
    const blocked = await call("DELETE", `/api/admin/media/${used.key}`, { headers: { cookie } });
    expect(blocked.status).toBe(409);
    const body = await blocked.json();
    expect(body.error.code).toBe("in_use");
    expect(body.error.posts).toHaveLength(1);
    expect((await call("DELETE", `/api/admin/media/${used.key}?force=1`, { headers: { cookie } })).status).toBe(204);
    expect((await call("DELETE", `/api/admin/media/${free.key}`, { headers: { cookie } })).status).toBe(204);
    expect((await call("DELETE", `/api/admin/media/${free.key}`, { headers: { cookie } })).status).toBe(404);
  });

  it("counts a cover as a use", async () => {
    const cover = await (await upload(webpBytes(800, 400))).json();
    await insertPost({ cover_key: cover.key });
    expect((await call("DELETE", `/api/admin/media/${cover.key}`, { headers: { cookie } })).status).toBe(409);
  });
});
