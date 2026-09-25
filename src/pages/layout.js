import { escapeHtml } from "../render/markdown.js";

export const SITE = {
  name: "xaverric/blog",
  author: "Daniel Jílek",
  description: "Technical writing by Daniel Jílek: software, systems and the tools around them.",
  language: "en",
  github: "https://github.com/xaverric",
  home: "https://xaverric.cz",
};

const STYLES = ["/css/tokens.css", "/css/base.css", "/css/site.css", "/css/prose.css"];

const meta = (name, content) => (content ? `<meta name="${name}" content="${escapeHtml(content)}">` : "");

const property = (name, content) => (content ? `<meta property="${name}" content="${escapeHtml(content)}">` : "");

export const absoluteUrl = (env, path) => new URL(path, env.APP_URL).href;

const socialMeta = (env, { title, description, canonical, image, type, publishedAt, updatedAt }) =>
  [
    property("og:type", type ?? "website"),
    property("og:site_name", SITE.name),
    property("og:title", title),
    property("og:description", description),
    property("og:url", canonical),
    property("og:image", absoluteUrl(env, image ?? "/og-default.png")),
    property("og:image:alt", title),
    property("article:published_time", publishedAt),
    property("article:modified_time", updatedAt),
    property("article:author", type === "article" ? SITE.author : null),
    meta("twitter:card", "summary_large_image"),
    meta("twitter:title", title),
    meta("twitter:description", description),
    meta("twitter:image", absoluteUrl(env, image ?? "/og-default.png")),
  ].join("");

const feeds = () =>
  [
    `<link rel="alternate" type="application/rss+xml" title="${SITE.name} (RSS)" href="/rss.xml">`,
    `<link rel="alternate" type="application/atom+xml" title="${SITE.name} (Atom)" href="/atom.xml">`,
    `<link rel="alternate" type="application/feed+json" title="${SITE.name} (JSON Feed)" href="/feed.json">`,
  ].join("");

export const slabNav = (current) => `<header class="slab">
  <a class="slab__mark" href="/"><span class="slab__name">xaverric</span><span class="slab__sep" aria-hidden="true">/</span><span class="slab__section">blog</span></a>
  <nav class="slab__nav" aria-label="Primary"><ul>
    <li><a href="/"${current === "home" ? ' aria-current="page"' : ""}>Posts</a></li>
    <li><a href="/rss.xml">RSS</a></li>
  </ul></nav>
</header>`;

export const mastFooter = () => `<footer class="mast">
  <p class="mast__mark">xaverric/blog</p>
  <p class="mast__line">Written by ${escapeHtml(SITE.author)}. Software, systems and the tools around them.</p>
  <ul class="mast__links">
    <li><a href="/rss.xml">RSS</a></li>
    <li><a href="/atom.xml">Atom</a></li>
    <li><a href="/feed.json">JSON Feed</a></li>
    <li><a href="${SITE.home}">xaverric.cz</a></li>
    <li><a href="${SITE.github}">GitHub</a></li>
  </ul>
</footer>`;

export const page = (env, { title, description, canonicalPath, current, body, robots, image, type, publishedAt, updatedAt, scripts = ["/build/site.js"], jsonLd }) => {
  const canonical = canonicalPath ? absoluteUrl(env, canonicalPath) : null;
  const fullTitle = title ? `${title} - ${SITE.name}` : SITE.name;
  return `<!doctype html>
<html lang="${SITE.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(fullTitle)}</title>
${meta("description", description ?? SITE.description)}
${meta("author", SITE.author)}
${meta("robots", robots)}
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f4ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16150f" media="(prefers-color-scheme: dark)">
${socialMeta(env, { title: title ?? SITE.name, description: description ?? SITE.description, canonical, image, type, publishedAt, updatedAt })}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/Bricolage-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Newsreader-latin.woff2" as="font" type="font/woff2" crossorigin>
${STYLES.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}
${feeds()}
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
${scripts.map((src) => `<script type="module" src="${src}"></script>`).join("")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${slabNav(current)}
<main id="main" tabindex="-1">
${body}
</main>
${mastFooter()}
</body>
</html>`;
};

export const messageBody = (title, message, action = { href: "/", label: "Read the latest posts" }) => `<section class="message">
  <p class="message__code" aria-hidden="true">${escapeHtml(title.code ?? "")}</p>
  <h1 class="message__title">${escapeHtml(title.text)}</h1>
  <p class="message__text">${escapeHtml(message)}</p>
  <p><a class="btn" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a></p>
</section>`;

export const messagePage = (env, status, title, message, { action, headers = {} } = {}) =>
  new Response(page(env, { title, body: messageBody({ code: String(status), text: title }, message, action), robots: "noindex", scripts: [] }), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers },
  });
