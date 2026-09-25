import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, adminCookie, call, insertPost, pngBytes, resetDb } from "./helpers.js";

beforeEach(resetDb);

const day = (n) => new Date(Date.UTC(2026, 0, n, 9)).toISOString();

const seedMany = async (count) => {
  for (let i = 1; i <= count; i++) await insertPost({ slug: `note-${i}`, title: `Note ${i}`, published_at: day(i), tags: i % 2 ? '["even-odd","odd"]' : '["even-odd"]' });
};

const text = async (path, options) => {
  const response = await call("GET", path, options);
  return { response, body: await response.text() };
};

describe("overview", () => {
  it("lists published posts newest first with meta and tags", async () => {
    await insertPost({ slug: "first", title: "First & best", excerpt: "An <intro>", published_at: day(1), tags: '["workers"]' });
    await insertPost({ slug: "second", title: "Second", published_at: day(2) });
    await insertPost({ slug: "hidden-draft", title: "Draft", status: "draft" });
    await insertPost({ slug: "gone", title: "Deleted", deleted_at: day(3) });
    const { response, body } = await text("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(body.indexOf("/second")).toBeLessThan(body.indexOf("/first"));
    expect(body).toContain("First &amp; best");
    expect(body).toContain("An &lt;intro&gt;");
    expect(body).toContain('<a href="/tags/workers">workers</a>');
    expect(body).toContain('<time datetime="2026-01-01T09:00:00.000Z">1 Jan 2026</time>');
    expect(body).not.toContain("hidden-draft");
    expect(body).not.toContain("Deleted");
    expect(body).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
  });

  it("shows an honest empty state", async () => {
    const { body } = await text("/");
    expect(body).toContain("No posts yet.");
  });

  it("paginates by ten", async () => {
    await seedMany(23);
    const first = await text("/");
    expect((first.body.match(/<li class="entry/g) ?? []).length).toBe(10);
    expect(first.body).toContain('href="/page/2"');
    expect(first.body).toContain("Page 1 of 3");
    const third = await text("/page/3");
    expect(third.response.status).toBe(200);
    expect((third.body.match(/<li class="entry/g) ?? []).length).toBe(3);
    expect(third.body).toContain('rel="prev" href="/page/2"');
    expect(third.body).toContain(`<link rel="canonical" href="${ORIGIN}/page/3">`);
    expect((await call("GET", "/page/4")).status).toBe(404);
    expect((await call("GET", "/page/1")).status).toBe(404);
    expect((await call("GET", "/page/0")).status).toBe(404);
    expect((await call("GET", "/page/x")).status).toBe(404);
  });

  it("filters by tag", async () => {
    await seedMany(12);
    const odd = await text("/tags/odd");
    expect(odd.response.status).toBe(200);
    expect((odd.body.match(/<li class="entry/g) ?? []).length).toBe(6);
    expect(odd.body).toContain("#odd");
    const both = await text("/tags/even-odd/page/2");
    expect((both.body.match(/<li class="entry/g) ?? []).length).toBe(2);
    expect((await call("GET", "/tags/nothing")).status).toBe(404);
    expect((await call("GET", "/tags/Odd")).status).toBe(404);
  });
});

describe("post detail", () => {
  it("renders a post with meta, OG tags, JSON-LD and the site script", async () => {
    await insertPost({ slug: "deep-dive", title: "A deep dive", excerpt: "Why it matters", body_md: "## One\n\nText", body_html: "", tags: '["infra"]', published_at: day(5) });
    const { response, body } = await text("/deep-dive");
    expect(response.status).toBe(200);
    expect(body).toContain('<h1 class="post__title">A deep dive</h1>');
    expect(body).toContain('<h2 id="one">');
    expect(body).toContain('<meta property="og:type" content="article">');
    expect(body).toContain('<meta property="og:title" content="A deep dive">');
    expect(body).toContain('<meta name="description" content="Why it matters">');
    expect(body).toContain(`<meta property="og:image" content="${ORIGIN}/og-default.png">`);
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain(`<link rel="canonical" href="${ORIGIN}/deep-dive">`);
    expect(body).toContain('"@type":"BlogPosting"');
    expect(body).toContain('<script type="module" src="/build/site.js"></script>');
    expect(body).not.toMatch(/<script>(?!<\/script>)/);
  });

  it("links the author's profiles below the post, in the site footer and in JSON-LD", async () => {
    await insertPost({ slug: "profiles", published_at: day(5) });
    const { body } = await text("/profiles");
    const profiles = '<li><a href="https://github.com/xaverric">GitHub</a></li><li><a href="https://www.linkedin.com/in/jilek-daniel/">LinkedIn</a></li><li><a href="https://buymeacoffee.com/xaverric">Buy me a coffee</a></li>';
    expect(body).toContain(`<ul class="post__profiles" aria-label="Daniel Jílek elsewhere">${profiles}</ul>`);
    expect(body).toMatch(new RegExp(`<footer class="mast">[\\s\\S]*<li><a href="https://xaverric.cz">xaverric.cz</a></li>${profiles.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}</ul>`));
    expect(body).toContain('"sameAs":["https://github.com/xaverric","https://www.linkedin.com/in/jilek-daniel/"]');
  });

  it("re-renders stale HTML lazily and stores it", async () => {
    const post = await insertPost({ slug: "stale", body_md: "==new==", body_html: "<p>old</p>", html_version: "0.old" });
    const { body } = await text("/stale");
    expect(body).toContain("<mark>new</mark>");
    const row = await env.DB.prepare("SELECT body_html, html_version FROM posts WHERE id = ?1").bind(post.id).first();
    expect(row.body_html).toContain("<mark>new</mark>");
    expect(row.html_version).not.toBe("0.old");
  });

  it("uses the cover for OG and shows a table of contents for long posts", async () => {
    const cookie = await adminCookie();
    const media = await (await call("POST", "/api/admin/media", { raw: pngBytes(1200, 630), headers: { cookie } })).json();
    await insertPost({ slug: "with-cover", cover_key: media.key, body_md: "## A\n\n## B\n\n### C", html_version: "" });
    const { body } = await text("/with-cover");
    expect(body).toContain(`<meta property="og:image" content="${ORIGIN}/media/${media.key}.png">`);
    expect(body).toContain(`<img src="/media/${media.key}.png" alt="" width="1200" height="630"`);
    expect(body).toContain('<nav class="toc"');
    expect(body).toContain('<a href="#c">C</a>');
  });

  it("hides drafts and deleted posts behind the 404 page", async () => {
    await insertPost({ slug: "draft-one", status: "draft" });
    await insertPost({ slug: "deleted-one", deleted_at: day(1) });
    for (const path of ["/draft-one", "/deleted-one", "/missing", "/Not-A-Slug", "/a/b/c"]) {
      const { response, body } = await text(path);
      expect(response.status).toBe(404);
      expect(body).toContain("Page not found");
      expect(body).toContain('<meta name="robots" content="noindex">');
    }
  });

  it("rejects writes to post paths", async () => {
    expect((await call("POST", "/some-post")).status).toBe(405);
  });
});

describe("feeds", () => {
  beforeEach(async () => {
    await insertPost({ slug: "feed-a", title: "Feed & A", excerpt: "About A", body_md: "![x](/media/0123456789abcdef0123456789abcdef.webp) [link](/feed-b)", body_html: "", tags: '["x"]', published_at: day(1) });
    await insertPost({ slug: "feed-b", title: "Feed B", body_md: "CDATA ]]> trap", body_html: "", published_at: day(2) });
    await insertPost({ slug: "feed-draft", title: "Secret draft", status: "draft" });
  });

  it("serves RSS 2.0 with full content and absolute URLs", async () => {
    const { response, body } = await text("/rss.xml");
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain("<title>Feed &amp; A</title>");
    expect(body).toContain(`<link>${ORIGIN}/feed-a</link>`);
    expect(body).toContain(`<atom:link href="${ORIGIN}/rss.xml" rel="self"`);
    expect(body).toContain(`href="${ORIGIN}/feed-b"`);
    expect(body).not.toContain("Secret draft");
    expect(body.indexOf("Feed B")).toBeLessThan(body.indexOf("Feed &amp; A"));
    expect((body.match(/<item>/g) ?? []).length).toBe(2);
    expect((body.match(/<\/item>/g) ?? []).length).toBe(2);
  });

  it("serves Atom and JSON Feed", async () => {
    const atom = await text("/atom.xml");
    expect(atom.response.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    expect(atom.body).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
    expect((atom.body.match(/<entry>/g) ?? []).length).toBe(2);
    const json = await (await call("GET", "/feed.json")).json();
    expect(json.version).toBe("https://jsonfeed.org/version/1.1");
    expect(json.items.map((item) => item.url)).toEqual([`${ORIGIN}/feed-b`, `${ORIGIN}/feed-a`]);
    expect(json.items[1].tags).toEqual(["x"]);
  });

  it("serves a sitemap with posts and tags", async () => {
    const { response, body } = await text("/sitemap.xml");
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(body).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(body).toContain(`<loc>${ORIGIN}/feed-a</loc>`);
    expect(body).toContain(`<loc>${ORIGIN}/tags/x</loc>`);
    expect(body).not.toContain("feed-draft");
  });

  it("serves robots.txt pointing at the sitemap", async () => {
    const { body } = await text("/robots.txt");
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe("edge cache", () => {
  it("serves the overview from the edge cache until it expires or is dropped", async () => {
    const edge = { EDGE_CACHE: "1" };
    await insertPost({ slug: "cached-one", title: "Cached one" });
    expect((await text("/", { env: edge })).body).toContain("Cached one");
    await insertPost({ slug: "cached-two", title: "Cached two" });
    expect((await text("/", { env: edge })).body).not.toContain("Cached two");
    const cookie = await adminCookie();
    const created = await (await call("POST", "/api/admin/posts", { headers: { cookie }, body: { title: "Cached three" }, env: edge })).json();
    await call("POST", `/api/admin/posts/${created.id}/publish`, { headers: { cookie }, env: edge });
    const fresh = await text("/", { env: edge });
    expect(fresh.body).toContain("Cached two");
    expect(fresh.body).toContain("Cached three");
    await caches.default.delete(new Request(`${ORIGIN}/`));
  });
});
