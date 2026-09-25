import { mediaPath } from "./media.js";
import { SITE, absoluteUrl } from "./pages/layout.js";
import { readTags } from "./posts.js";

export const FEED_SIZE = 20;

const isXmlChar = (ch) => {
  const code = ch.codePointAt(0);
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
};

const xml = (text) =>
  [...String(text ?? "")]
    .filter(isXmlChar)
    .join("")
    .replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);

const cdata = (text) => `<![CDATA[${String(text ?? "").replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

const absolutizeHtml = (env, html) => html.replace(/(\s(?:src|href))="\/(?!\/)/g, `$1="${new URL(env.APP_URL).origin}/`);

const postUrl = (env, post) => absoluteUrl(env, `/${post.slug}`);

const latestUpdate = (posts, now) => posts.reduce((max, post) => (post.updated_at > max ? post.updated_at : max), posts[0]?.updated_at ?? now.toISOString());

const coverUrl = (env, post) => (post.cover_key ? absoluteUrl(env, mediaPath(post.cover_key, post.cover_type ?? "image/webp")) : null);

export const rssFeed = (env, posts, now) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${xml(SITE.name)}</title>
<link>${xml(absoluteUrl(env, "/"))}</link>
<description>${xml(SITE.description)}</description>
<language>${SITE.language}</language>
<lastBuildDate>${new Date(latestUpdate(posts, now)).toUTCString()}</lastBuildDate>
<atom:link href="${xml(absoluteUrl(env, "/rss.xml"))}" rel="self" type="application/rss+xml"/>
${posts
  .map(
    (post) => `<item>
<title>${xml(post.title)}</title>
<link>${xml(postUrl(env, post))}</link>
<guid isPermaLink="true">${xml(postUrl(env, post))}</guid>
<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
<dc:creator>${xml(SITE.author)}</dc:creator>
${readTags(post.tags).map((tag) => `<category>${xml(tag)}</category>`).join("")}
<description>${xml(post.excerpt)}</description>
<content:encoded>${cdata(absolutizeHtml(env, post.body_html))}</content:encoded>
</item>`,
  )
  .join("\n")}
</channel>
</rss>
`;

export const atomFeed = (env, posts, now) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${SITE.language}">
<title>${xml(SITE.name)}</title>
<subtitle>${xml(SITE.description)}</subtitle>
<id>${xml(absoluteUrl(env, "/"))}</id>
<link href="${xml(absoluteUrl(env, "/"))}"/>
<link rel="self" type="application/atom+xml" href="${xml(absoluteUrl(env, "/atom.xml"))}"/>
<updated>${new Date(latestUpdate(posts, now)).toISOString()}</updated>
<author><name>${xml(SITE.author)}</name><uri>${xml(SITE.home)}</uri></author>
${posts
  .map(
    (post) => `<entry>
<title>${xml(post.title)}</title>
<id>${xml(postUrl(env, post))}</id>
<link href="${xml(postUrl(env, post))}"/>
<published>${new Date(post.published_at).toISOString()}</published>
<updated>${new Date(post.updated_at).toISOString()}</updated>
${readTags(post.tags).map((tag) => `<category term="${xml(tag)}"/>`).join("")}
<summary>${xml(post.excerpt)}</summary>
<content type="html">${xml(absolutizeHtml(env, post.body_html))}</content>
</entry>`,
  )
  .join("\n")}
</feed>
`;

export const jsonFeed = (env, posts) => ({
  version: "https://jsonfeed.org/version/1.1",
  title: SITE.name,
  home_page_url: absoluteUrl(env, "/"),
  feed_url: absoluteUrl(env, "/feed.json"),
  description: SITE.description,
  language: SITE.language,
  authors: [{ name: SITE.author, url: SITE.home }],
  items: posts.map((post) => ({
    id: postUrl(env, post),
    url: postUrl(env, post),
    title: post.title,
    summary: post.excerpt || undefined,
    content_html: absolutizeHtml(env, post.body_html),
    image: coverUrl(env, post) ?? undefined,
    date_published: new Date(post.published_at).toISOString(),
    date_modified: new Date(post.updated_at).toISOString(),
    tags: readTags(post.tags),
  })),
});

export const sitemap = (env, rows) => {
  const tags = new Map();
  rows.forEach((row) => readTags(row.tags).forEach((tag) => tags.set(tag, row.updated_at > (tags.get(tag) ?? "") ? row.updated_at : tags.get(tag))));
  const urls = [
    { loc: absoluteUrl(env, "/"), lastmod: rows[0]?.updated_at },
    ...rows.map((row) => ({ loc: absoluteUrl(env, `/${row.slug}`), lastmod: row.updated_at })),
    ...[...tags].map(([tag, lastmod]) => ({ loc: absoluteUrl(env, `/tags/${tag}`), lastmod })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `<url><loc>${xml(url.loc)}</loc>${url.lastmod ? `<lastmod>${new Date(url.lastmod).toISOString()}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
};

export const robots = (env) => `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /auth/

Sitemap: ${absoluteUrl(env, "/sitemap.xml")}
`;
