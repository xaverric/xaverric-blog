const HTML_TAGS = [
  "a", "abbr", "aside", "b", "blockquote", "br", "code", "del", "div", "em", "figcaption", "figure", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "mark", "ol", "p", "pre", "s", "section", "span", "strong",
  "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
];

const MATH_TAGS = [
  "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms", "mtext", "mspace", "msup", "msub", "msubsup", "mfrac",
  "msqrt", "mroot", "mtable", "mtr", "mtd", "mlabeledtr", "munder", "mover", "munderover", "mstyle", "mpadded", "mphantom",
  "menclose", "mmultiscripts", "mprescripts", "none",
];

const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "template", "noscript", "svg", "form", "textarea",
  "select", "option", "button", "link", "meta", "base", "title", "head", "audio", "video", "source", "track", "canvas",
  "applet", "portal", "xmp", "noembed", "noframes", "plaintext",
]);

const ALLOWED_TAGS = new Set([...HTML_TAGS, ...MATH_TAGS]);

const MATH_ATTRIBUTES = [
  "display", "xmlns", "encoding", "mathvariant", "stretchy", "fence", "separator", "lspace", "rspace", "minsize", "maxsize",
  "movablelimits", "accent", "accentunder", "columnalign", "rowalign", "rowspacing", "columnspacing", "width", "height", "depth",
  "scriptlevel", "displaystyle", "linethickness", "notation", "voffset", "form", "largeop", "symmetric", "columnlines",
  "rowlines", "frame", "framespacing", "equalrows", "equalcolumns", "side", "columnspan", "rowspan",
];

const TOKEN = /^[\w\s-]{0,200}$/;
const ID = /^[\w-]{1,120}$/;
const NUMBER = /^\d{1,5}$/;
const MATH_VALUE = /^[\w\s.,%#:/+-]{0,120}$/;

const GLOBAL_ATTRIBUTES = {
  class: TOKEN,
  id: ID,
  title: /^[^<>]{0,300}$/,
  "aria-label": /^[^<>]{0,200}$/,
  "aria-describedby": ID,
  "aria-hidden": /^true$/,
  role: /^(region|note|doc-footnote|doc-noteref|doc-backlink)$/,
  tabindex: /^0$/,
  "data-lang": /^[\w+#.-]{1,40}$/,
  "data-mermaid": /^$/,
  "data-callout": /^[a-z]{1,20}$/,
  "data-footnote-ref": /^$/,
  "data-footnote-backref": /^$/,
  "data-footnotes": /^$/,
};

const TAG_ATTRIBUTES = {
  a: { href: "href", rel: /^[\w\s-]{0,60}$/ },
  img: { src: "src", alt: /^[^<>]{0,500}$/, width: NUMBER, height: NUMBER, loading: /^(lazy|eager)$/, decoding: /^(async|auto|sync)$/, fetchpriority: /^(high|low|auto)$/ },
  input: { type: /^checkbox$/, checked: /^$/, disabled: /^$/ },
  ol: { start: NUMBER },
  td: { align: /^(left|center|right)$/, colspan: NUMBER, rowspan: NUMBER },
  th: { align: /^(left|center|right)$/, colspan: NUMBER, rowspan: NUMBER, scope: /^(col|row)$/ },
  code: {},
};

const MEDIA_SRC = /^\/media\/[0-9a-f]{32}\.(webp|jpg|png|gif)$/;
const PROXY_SRC = /^\/img\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{1,4000}$/;
const DATA_SRC = /^data:image\/(png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]{1,200000}$/;

export const isSafeHref = (value) => {
  const text = String(value ?? "").trim();
  if (!text || /[\s<>"'`\\]/.test(text) || [...text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return false;
  if (text.startsWith("#")) return true;
  if (text.startsWith("/")) return !text.startsWith("//");
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
};

export const isSafeImageSrc = (value) => MEDIA_SRC.test(value) || PROXY_SRC.test(value) || DATA_SRC.test(value);

const MATH_TAG_SET = new Set(MATH_TAGS);

const allowedAttribute = (tag, name, value) => {
  const rule = TAG_ATTRIBUTES[tag]?.[name] ?? GLOBAL_ATTRIBUTES[name] ?? (MATH_TAG_SET.has(tag) && MATH_ATTRIBUTES.includes(name) ? MATH_VALUE : null);
  if (!rule) return false;
  if (rule === "href") return isSafeHref(value);
  if (rule === "src") return isSafeImageSrc(value);
  return rule.test(value);
};

const cleanElement = (el) => {
  const tag = el.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return el.remove();
  if (!ALLOWED_TAGS.has(tag)) return el.removeAndKeepContent();
  const names = [...el.attributes].map(([name]) => name);
  names.forEach((name) => {
    const value = el.getAttribute(name) ?? "";
    if (!allowedAttribute(tag, name.toLowerCase(), value)) el.removeAttribute(name);
  });
  if (tag === "img" && !el.hasAttribute("src")) el.remove();
  if (tag === "input" && el.getAttribute("type") !== "checkbox") el.remove();
  if (tag === "input") el.setAttribute("disabled", "");
};

export const sanitizeHtml = async (html) =>
  new HTMLRewriter()
    .on("*", { element: cleanElement })
    .onDocument({ comments: (comment) => comment.remove(), doctype: () => {} })
    .transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }))
    .text();
