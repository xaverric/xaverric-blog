import { mediaPath } from "../media.js";
import { readTags } from "../posts.js";
import { escapeHtml } from "../render/markdown.js";
import { PROFILES, SITE, absoluteUrl, linkList, page } from "./layout.js";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "");

const coverPath = (post) => (post.cover_key ? mediaPath(post.cover_key, post.cover_type ?? "image/webp") : null);

const tagList = (tags, className = "tags") =>
  tags.length ? `<ul class="${className}" aria-label="Tags">${tags.map((tag) => `<li><a href="/tags/${escapeHtml(tag)}">${escapeHtml(tag)}</a></li>`).join("")}</ul>` : "";

const meta = (post) =>
  `<p class="meta"><time datetime="${escapeHtml(post.published_at)}">${formatDate(post.published_at)}</time><span class="meta__sep" aria-hidden="true">/</span><span>${post.reading_minutes} min read</span></p>`;

const entry = (post) => {
  const tags = readTags(post.tags);
  const cover = coverPath(post);
  return `<li class="entry${cover ? " entry--cover" : ""}">
  <div class="entry__text">
    ${meta(post)}
    <h2 class="entry__title"><a href="/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
    ${post.excerpt ? `<p class="entry__excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
    ${tagList(tags)}
  </div>
  ${cover ? `<a class="entry__cover" href="/${escapeHtml(post.slug)}" tabindex="-1" aria-hidden="true"><img src="${cover}" alt="" loading="lazy" decoding="async" width="${post.cover_width ?? 1600}" height="${post.cover_height ?? 900}"></a>` : ""}
</li>`;
};

const pageHref = (base, n) => (n <= 1 ? base : `${base === "/" ? "" : base}/page/${n}`);

const pagination = (base, current, pages) => {
  if (pages <= 1) return "";
  const prev = current > 1 ? `<a class="pager__link" rel="prev" href="${pageHref(base, current - 1)}">Newer posts</a>` : `<span class="pager__link" aria-hidden="true"></span>`;
  const next = current < pages ? `<a class="pager__link pager__link--next" rel="next" href="${pageHref(base, current + 1)}">Older posts</a>` : `<span class="pager__link" aria-hidden="true"></span>`;
  return `<nav class="pager" aria-label="Pagination">${prev}<span class="pager__count">Page ${current} of ${pages}</span>${next}</nav>`;
};

const emptyState = (tag) =>
  tag
    ? `<div class="empty"><p class="empty__title">Nothing tagged ${escapeHtml(tag)}.</p><p><a href="/">See all posts</a></p></div>`
    : `<div class="empty"><p class="empty__title">No posts yet.</p><p>The first one is on its way. Subscribe to the <a href="/rss.xml">RSS feed</a> to get it when it lands.</p></div>`;

export const overviewPage = (env, { posts, total, current, pages, tag }) => {
  const base = tag ? `/tags/${tag}` : "/";
  const heading = tag
    ? `<header class="ledger__head"><p class="ledger__kicker"><a href="/">All posts</a></p><h1 class="ledger__title">#${escapeHtml(tag)}</h1><p class="ledger__count">${total} ${total === 1 ? "post" : "posts"}</p></header>`
    : `<header class="ledger__head"><h1 class="ledger__title">Writing</h1><p class="ledger__lede">${escapeHtml(SITE.description)}</p></header>`;
  const list = posts.length ? `<ol class="ledger__list" reversed start="${total - (current - 1) * posts.length}">${posts.map(entry).join("")}</ol>` : emptyState(tag);
  const body = `<div class="ledger">${heading}${list}${pagination(base, current, pages)}</div>`;
  const title = tag ? `Posts tagged ${tag}` : current > 1 ? `Posts, page ${current}` : null;
  return page(env, {
    title,
    description: tag ? `Posts tagged ${tag} on ${SITE.name}.` : SITE.description,
    canonicalPath: pageHref(base, current),
    current: tag ? "tag" : "home",
    body,
    robots: tag && !posts.length ? "noindex" : null,
  });
};

const toc = (items) =>
  items.length
    ? `<nav class="toc" aria-labelledby="toc-title"><p class="toc__title" id="toc-title">Contents</p><ol>${items
        .map((item) => `<li class="toc__item toc__item--${item.depth}"><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`)
        .join("")}</ol></nav>`
    : "";

export const postPage = (env, post, rendered) => {
  const tags = readTags(post.tags);
  const cover = coverPath(post);
  const tocItems = rendered.toc ?? [];
  const description = post.excerpt || rendered.summary || SITE.description;
  const titleClass = post.title.length > 50 ? "post__title post__title--long" : "post__title";
  const body = `<article class="post${tocItems.length ? " post--toc" : ""}">
  <header class="post__head">
    ${meta(post)}
    <h1 class="${titleClass}">${escapeHtml(post.title)}</h1>
    ${post.excerpt ? `<p class="post__lede">${escapeHtml(post.excerpt)}</p>` : ""}
    ${tagList(tags, "tags tags--head")}
  </header>
  ${cover ? `<figure class="post__cover"><img src="${cover}" alt="" width="${post.cover_width ?? 1600}" height="${post.cover_height ?? 900}" fetchpriority="high" decoding="async"></figure>` : ""}
  <div class="post__body">
    ${toc(tocItems)}
    <div class="prose">
${rendered.html}
    </div>
  </div>
  <footer class="post__foot">
    <div class="post__author">
      <p class="post__signoff">Written by ${escapeHtml(SITE.author)}${post.published_at ? `, ${formatDate(post.published_at)}` : ""}.</p>
      ${linkList("post__profiles", PROFILES, `${SITE.author} elsewhere`)}
    </div>
    ${tagList(tags)}
    <p class="post__more"><a class="btn" href="/">More posts</a><a class="post__rss" href="/rss.xml">Follow via RSS</a></p>
  </footer>
</article>`;
  const canonicalPath = `/${post.slug}`;
  return page(env, {
    title: post.title,
    description,
    canonicalPath,
    current: "post",
    body,
    image: cover,
    type: "article",
    publishedAt: post.published_at,
    updatedAt: post.updated_at,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description,
      datePublished: post.published_at,
      dateModified: post.updated_at,
      author: { "@type": "Person", name: SITE.author, url: SITE.home, sameAs: [SITE.github, SITE.linkedin] },
      mainEntityOfPage: absoluteUrl(env, canonicalPath),
      image: absoluteUrl(env, cover ?? "/og-default.png"),
      keywords: tags.join(", ") || undefined,
    },
  });
};
