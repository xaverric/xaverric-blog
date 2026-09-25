import katex from "katex";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import { INLINE_MARKS, markedBlockMath, markedCallout, markedInlineMark, markedInlineMath } from "../../shared/syntax.js";
import { readingMinutes, slugify, truncate } from "../../shared/text.js";
import { highlightCode } from "./highlight.js";
import { isSafeHref, isSafeImageSrc, sanitizeHtml } from "./sanitize.js";

export const RENDERER_VERSION = "1";

const TOC_MIN_HEADINGS = 3;
const MEDIA_PATH = /^\/media\/([0-9a-f]{32})\.(webp|jpg|png|gif)$/;
const CALLOUT_TITLES = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

export const escapeHtml = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]);

const renderMath = (tex, displayMode) => {
  try {
    return katex.renderToString(tex, { displayMode, output: "mathml", throwOnError: true, strict: "ignore", trust: false, maxExpand: 500, maxSize: 20 });
  } catch {
    return `<code class="math-error" title="Could not render this formula">${escapeHtml(tex)}</code>`;
  }
};

const mediaKey = (href) => MEDIA_PATH.exec(href)?.[1] ?? null;

export const isExternalImage = (href) => /^https?:\/\//i.test(href ?? "");

const uniqueId = (ids, text) => {
  const base = slugify(text, 60) || "section";
  const count = ids.get(base) ?? 0;
  ids.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
};

const imageTag = ({ href, alt, media, eager }) => {
  if (!isSafeImageSrc(href)) return escapeHtml(alt);
  const dims = media.get(mediaKey(href));
  const size = dims ? ` width="${dims.width}" height="${dims.height}"` : "";
  return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${size} loading="${eager ? "eager" : "lazy"}" decoding="async">`;
};

const createMarked = (state, { media, resolveImage }) => {
  const marked = new Marked({ gfm: true, breaks: false, async: true });
  marked.use(markedFootnote({ description: "Footnotes", backRefLabel: "Back to reference {0}" }));
  marked.use({
    extensions: [
      ...INLINE_MARKS.map((mark) => ({
        ...markedInlineMark(mark),
        renderer(token) {
          return `<${mark.tag}${mark.className ? ` class="${mark.className}"` : ""}>${this.parser.parseInline(token.tokens)}</${mark.tag}>`;
        },
      })),
      { ...markedInlineMath, renderer: (token) => renderMath(token.text, false) },
      { ...markedBlockMath, renderer: (token) => `<div class="math-block">${renderMath(token.text, true)}</div>\n` },
      {
        ...markedCallout,
        renderer(token) {
          return `<aside class="callout callout--${token.kind}" data-callout="${token.kind}" role="note"><p class="callout__title">${CALLOUT_TITLES[token.kind]}</p>${this.parser.parse(token.tokens)}</aside>\n`;
        },
      },
    ],
    async walkTokens(token) {
      if (token.type === "image" && isExternalImage(token.href)) token.href = await resolveImage(token.href);
    },
    renderer: {
      html: ({ text }) => escapeHtml(text),
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = stripTags(inner).trim();
        const id = uniqueId(state.ids, text);
        if (depth === 2 || depth === 3) state.toc.push({ id, text, depth });
        return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      code({ text, lang }) {
        const info = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
        if (info === "mermaid") {
          state.hasMermaid = true;
          return `<div class="mermaid-block" data-mermaid=""><pre class="mermaid-src"><code>${escapeHtml(text)}</code></pre></div>\n`;
        }
        if (info === "math" || info === "latex" || info === "katex") return `<div class="math-block">${renderMath(text, true)}</div>\n`;
        const { html, language } = highlightCode(text, info);
        const label = language ?? (info ? info.slice(0, 20) : "text");
        return `<figure class="code" data-lang="${escapeHtml(label)}"><figcaption class="code__bar"><span class="code__lang">${escapeHtml(label)}</span></figcaption><pre class="code__pre" tabindex="0"><code class="hljs${language ? ` language-${language}` : ""}">${html}</code></pre></figure>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!isSafeHref(href)) return inner;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href)}"${titleAttr}>${inner}</a>`;
      },
      image({ href, text }) {
        state.images += 1;
        return imageTag({ href, alt: text, media, eager: state.images === 1 && state.eagerFirst });
      },
      paragraph({ tokens }) {
        const meaningful = tokens.filter((token) => !(token.type === "text" && !token.text.trim()));
        if (meaningful.length === 1 && meaningful[0].type === "image" && isSafeImageSrc(meaningful[0].href)) {
          const image = meaningful[0];
          state.images += 1;
          const caption = image.title || image.text;
          const img = imageTag({ href: image.href, alt: image.text, media, eager: state.images === 1 && state.eagerFirst });
          return `<figure class="figure">${img}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>\n`;
        }
        const inner = this.parser.parseInline(tokens);
        if (!state.firstParagraph) state.firstParagraph = stripTags(inner).trim();
        return `<p>${inner}</p>\n`;
      },
      table(token) {
        const cell = (item, tag) => {
          const align = item.align ? ` align="${item.align}"` : "";
          const scope = tag === "th" ? ' scope="col"' : "";
          return `<${tag}${align}${scope}>${this.parser.parseInline(item.tokens)}</${tag}>`;
        };
        const head = `<thead><tr>${token.header.map((item) => cell(item, "th")).join("")}</tr></thead>`;
        const body = token.rows.length ? `<tbody>${token.rows.map((row) => `<tr>${row.map((item) => cell(item, "td")).join("")}</tr>`).join("")}</tbody>` : "";
        return `<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>${head}${body}</table></div>\n`;
      },
      listitem(item) {
        return `<li${item.task ? ' class="task"' : ""}>${this.parser.parse(item.tokens)}</li>\n`;
      },
    },
  });
  return marked;
};

const plainText = (md) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~=|{}+-]/g, " ");

export const renderMarkdown = async (markdown, { media = new Map(), resolveImage = async (href) => href, eagerFirstImage = false } = {}) => {
  const source = String(markdown ?? "");
  const state = { ids: new Map(), toc: [], hasMermaid: false, images: 0, eagerFirst: eagerFirstImage, firstParagraph: "" };
  const raw = await createMarked(state, { media, resolveImage }).parse(source);
  const html = await sanitizeHtml(raw);
  return {
    html,
    toc: state.toc.length >= TOC_MIN_HEADINGS ? state.toc : [],
    hasMermaid: state.hasMermaid,
    readingMinutes: readingMinutes(plainText(source)),
    summary: truncate(state.firstParagraph, 200),
  };
};

export const referencedMediaKeys = (markdown) => [...String(markdown ?? "").matchAll(/\/media\/([0-9a-f]{32})\.(?:webp|jpg|png|gif)/g)].map((m) => m[1]);
