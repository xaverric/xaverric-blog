import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminCookie, call, insertPost, resetDb } from "./helpers.js";

let cookie;

beforeEach(async () => {
  await resetDb();
  cookie = await adminCookie();
});

const api = (method, path, body, extra = {}) => call(method, path, { headers: { cookie, ...extra.headers }, body, ...extra });

const create = async (body) => (await api("POST", "/api/admin/posts", body)).json();

describe("create", () => {
  it("creates a draft with a slug from the title", async () => {
    const response = await api("POST", "/api/admin/posts", { title: "Hello, Wörld!", bodyMd: "## Hi\n\n```js\nlet a\n```", tags: ["Cloudflare Workers", "js", "js"] });
    expect(response.status).toBe(201);
    const post = await response.json();
    expect(post).toMatchObject({ slug: "hello-world", title: "Hello, Wörld!", status: "draft", tags: ["cloudflare-workers", "js"], publishedAt: null });
    const row = await env.DB.prepare("SELECT body_html, html_version FROM posts WHERE id = ?1").bind(post.id).first();
    expect(row.body_html).toContain('<h2 id="hi">');
    expect(row.body_html).toContain("hljs-keyword");
    expect(row.html_version).toMatch(/^1\./);
  });

  it("creates an untitled draft without a body", async () => {
    const response = await api("POST", "/api/admin/posts");
    expect(response.status).toBe(201);
    expect((await response.json()).slug).toBe("untitled");
    expect((await create({})).slug).toBe("untitled-2");
  });

  it("keeps slugs unique and avoids reserved words", async () => {
    await create({ title: "Same" });
    expect((await create({ title: "Same" })).slug).toBe("same-2");
    expect((await create({ title: "Admin" })).slug).toBe("admin-post");
    const taken = await api("POST", "/api/admin/posts", { title: "x", slug: "same" });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.message).toBe("slug: already taken");
  });

  it.each([
    [{ slug: "Bad Slug" }, "slug:"],
    [{ slug: "rss" }, "slug: reserved"],
    [{ title: 5 }, "title: must be a string"],
    [{ tags: "js" }, "tags: must be an array"],
    [{ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }, "tags: at most 8"],
    [{ publishedAt: "yesterday" }, "publishedAt:"],
    [{ coverKey: "nope" }, "coverKey:"],
    [{ extra: 1 }, "extra: unknown field"],
    [{ bodyMd: "x".repeat(500001) }, "bodyMd: at most"],
  ])("rejects %j", async (body, message) => {
    const response = await api("POST", "/api/admin/posts", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain(message);
  });
});

describe("read and list", () => {
  it("lists drafts and published posts with search and status filters", async () => {
    await create({ title: "Draft about Workers" });
    const published = await create({ title: "Published note" });
    await api("POST", `/api/admin/posts/${published.id}/publish`);
    const all = await (await api("GET", "/api/admin/posts")).json();
    expect(all.posts.map((post) => post.title)).toEqual(["Published note", "Draft about Workers"]);
    const drafts = await (await api("GET", "/api/admin/posts?status=draft")).json();
    expect(drafts.posts.map((post) => post.title)).toEqual(["Draft about Workers"]);
    const found = await (await api("GET", "/api/admin/posts?q=workers")).json();
    expect(found.posts).toHaveLength(1);
    expect((await api("GET", "/api/admin/posts?q=100%25")).status).toBe(200);
    expect((await api("GET", "/api/admin/posts?status=live")).status).toBe(400);
  });

  it("returns one post with its Markdown and 404 for unknown ids", async () => {
    const post = await create({ title: "One", bodyMd: "Body" });
    const loaded = await (await api("GET", `/api/admin/posts/${post.id}`)).json();
    expect(loaded.bodyMd).toBe("Body");
    expect((await api("GET", "/api/admin/posts/99999")).status).toBe(404);
    expect((await api("GET", "/api/admin/posts/abc")).status).toBe(404);
  });
});

describe("update", () => {
  it("updates fields, re-renders the body and bumps updatedAt", async () => {
    const post = await create({ title: "One" });
    const response = await api("PATCH", `/api/admin/posts/${post.id}`, { title: "Two", slug: "two", excerpt: "Short", bodyMd: "==marked==", tags: ["a"] });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated).toMatchObject({ title: "Two", slug: "two", excerpt: "Short", tags: ["a"], bodyMd: "==marked==" });
    const row = await env.DB.prepare("SELECT body_html FROM posts WHERE id = ?1").bind(post.id).first();
    expect(row.body_html).toContain("<mark>marked</mark>");
  });

  it("rejects a slug owned by another post", async () => {
    await create({ title: "Taken" });
    const post = await create({ title: "Mine" });
    const response = await api("PATCH", `/api/admin/posts/${post.id}`, { slug: "taken" });
    expect(response.status).toBe(409);
    expect((await api("PATCH", `/api/admin/posts/${post.id}`, { slug: "mine" })).status).toBe(200);
  });

  it("rejects empty and invalid patches", async () => {
    const post = await create({ title: "One" });
    expect((await api("PATCH", `/api/admin/posts/${post.id}`, {})).status).toBe(400);
    expect((await api("PATCH", `/api/admin/posts/${post.id}`, [])).status).toBe(400);
    expect((await api("PATCH", "/api/admin/posts/424242", { title: "x" })).status).toBe(404);
  });
});

describe("publish", () => {
  it("publishes with now, keeps the date on republish and accepts an explicit date", async () => {
    const post = await create({ title: "Pub" });
    const first = await (await api("POST", `/api/admin/posts/${post.id}/publish`)).json();
    expect(first.status).toBe("published");
    expect(Date.parse(first.publishedAt)).toBeGreaterThan(Date.now() - 60000);
    const draft = await (await api("POST", `/api/admin/posts/${post.id}/unpublish`)).json();
    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBe(first.publishedAt);
    const again = await (await api("POST", `/api/admin/posts/${post.id}/publish`, { publishedAt: "2024-02-03T10:00:00+01:00" })).json();
    expect(again.publishedAt).toBe("2024-02-03T09:00:00.000Z");
  });

  it("refuses to publish an untitled post", async () => {
    const post = await create({});
    const response = await api("POST", `/api/admin/posts/${post.id}/publish`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("title");
  });

  it("shows and hides the post publicly", async () => {
    const post = await create({ title: "Visible", bodyMd: "Text" });
    expect((await call("GET", "/visible")).status).toBe(404);
    await api("POST", `/api/admin/posts/${post.id}/publish`);
    expect((await call("GET", "/visible")).status).toBe(200);
    await api("POST", `/api/admin/posts/${post.id}/unpublish`);
    expect((await call("GET", "/visible")).status).toBe(404);
  });
});

describe("delete and restore", () => {
  it("soft deletes, hides and restores a post", async () => {
    const post = await create({ title: "Gone soon" });
    await api("POST", `/api/admin/posts/${post.id}/publish`);
    expect((await api("DELETE", `/api/admin/posts/${post.id}`)).status).toBe(204);
    expect((await call("GET", "/gone-soon")).status).toBe(404);
    expect((await api("GET", `/api/admin/posts/${post.id}`)).status).toBe(404);
    expect((await (await api("GET", "/api/admin/posts")).json()).posts).toHaveLength(0);
    expect((await api("DELETE", `/api/admin/posts/${post.id}`)).status).toBe(404);
    const restored = await api("POST", `/api/admin/posts/${post.id}/restore`);
    expect(restored.status).toBe(200);
    expect((await call("GET", "/gone-soon")).status).toBe(200);
    expect((await api("POST", `/api/admin/posts/${post.id}/restore`)).status).toBe(404);
  });

  it("purges posts deleted more than a week ago", async () => {
    const old = await insertPost({ deleted_at: new Date(Date.now() - 8 * 86400000).toISOString() });
    const post = await create({ title: "Now" });
    await api("DELETE", `/api/admin/posts/${post.id}`);
    expect(await env.DB.prepare("SELECT id FROM posts WHERE id = ?1").bind(old.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM posts WHERE id = ?1").bind(post.id).first()).not.toBeNull();
  });
});

describe("preview", () => {
  it("renders with the public renderer", async () => {
    const response = await api("POST", "/api/admin/preview", { bodyMd: "## A\n\n## B\n\n## C\n\n<script>x</script>\n\n```mermaid\ngraph TD\n```" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.html).toContain('<h2 id="a">');
    expect(body.html).not.toContain("<script");
    expect(body.toc).toHaveLength(3);
    expect(body.hasMermaid).toBe(true);
  });

  it("needs a string body and the owner", async () => {
    expect((await api("POST", "/api/admin/preview", {})).status).toBe(400);
    expect((await call("POST", "/api/admin/preview", { body: { bodyMd: "x" } })).status).toBe(401);
  });
});

describe("same-origin", () => {
  it("rejects cross-origin mutations even with a valid session", async () => {
    const post = await create({ title: "Safe" });
    const evil = { headers: { cookie, origin: "https://evil.example" } };
    expect((await call("POST", "/api/admin/posts", { ...evil, body: {} })).status).toBe(403);
    expect((await call("PATCH", `/api/admin/posts/${post.id}`, { ...evil, body: { title: "x" } })).status).toBe(403);
    expect((await call("DELETE", `/api/admin/posts/${post.id}`, evil)).status).toBe(403);
    expect((await call("POST", `/api/admin/posts/${post.id}/publish`, evil)).status).toBe(403);
    expect((await call("POST", "/api/admin/media", { ...evil, raw: new Uint8Array([1]) })).status).toBe(403);
  });

  it("accepts Sec-Fetch-Site same-origin without an Origin header", async () => {
    const response = await call("POST", "/api/admin/posts", { headers: { cookie, origin: undefined, "sec-fetch-site": "same-origin" }, body: {} });
    expect(response.status).toBe(201);
  });
});
