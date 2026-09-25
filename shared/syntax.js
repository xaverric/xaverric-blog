export const INLINE_MARKS = [
  { name: "highlight", open: "==", close: "==", tag: "mark", pattern: /^==(?=[^\s=])([^\n]*?[^\s=])==(?!=)/ },
  { name: "added", open: "{+", close: "+}", tag: "ins", className: "added", pattern: /^\{\+(?=\S)([^\n]*?\S)\+\}/ },
  { name: "removed", open: "{-", close: "-}", tag: "del", className: "removed", pattern: /^\{-(?=\S)([^\n]*?\S)-\}/ },
];

const INLINE_MATH = /^\$(?![\s$])((?:\\.|[^\\$\n])*?[^\s\\])\$(?![\d$])/;
const BLOCK_MATH = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n+|$)/;
const BLOCK_MATH_LINE = /^ {0,3}\$\$([^\n$]+?)\$\$[ \t]*(?:\n+|$)/;
const CALLOUT_HEAD = /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const QUOTE_LINE = /^ {0,3}>/;

export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"];

export const matchInlineMark = (mark, src) => {
  const match = mark.pattern.exec(src);
  return match ? { raw: match[0], text: match[1] } : null;
};

export const matchInlineMath = (src) => {
  const match = INLINE_MATH.exec(src);
  return match ? { raw: match[0], text: match[1] } : null;
};

export const matchBlockMath = (src) => {
  const match = BLOCK_MATH.exec(src) ?? BLOCK_MATH_LINE.exec(src);
  return match ? { raw: match[0], text: match[1].trim() } : null;
};

export const matchCallout = (src) => {
  const head = CALLOUT_HEAD.exec(src);
  if (!head) return null;
  const rest = src.slice(head[0].length).split("\n");
  const count = rest.findIndex((line) => !QUOTE_LINE.test(line));
  const lines = count < 0 ? rest : rest.slice(0, count);
  const consumed = lines.join("\n");
  const trailing = count < 0 ? "" : "\n";
  const body = lines.map((line) => line.replace(/^ {0,3}> ?/, "")).join("\n");
  return { raw: head[0] + consumed + (lines.length ? trailing : ""), kind: head[1].toLowerCase(), body };
};

const indexOf = (src, needle) => {
  const at = src.indexOf(needle);
  return at < 0 ? undefined : at;
};

const firstLineMatch = (regex) => (src) => {
  const match = regex.exec(src);
  return match ? match.index + match[1].length : undefined;
};

export const BLOCK_MATH_START = firstLineMatch(/(^|\n) {0,3}\$\$/);
export const CALLOUT_START = firstLineMatch(/(^|\n) {0,3}> ?\[!/);
export const FOOTNOTE_DEF_START = firstLineMatch(/(^|\n) {0,3}\[\^[^\]\s]+\]:/);

export const markedInlineMark = (mark) => ({
  name: mark.name,
  level: "inline",
  start: (src) => indexOf(src, mark.open),
  tokenizer(src) {
    const found = matchInlineMark(mark, src);
    return found ? { type: mark.name, raw: found.raw, text: found.text, tokens: this.lexer.inlineTokens(found.text) } : undefined;
  },
});

export const markedInlineMath = {
  name: "mathInline",
  level: "inline",
  start: (src) => indexOf(src, "$"),
  tokenizer(src) {
    const found = matchInlineMath(src);
    return found ? { type: "mathInline", raw: found.raw, text: found.text } : undefined;
  },
};

export const markedBlockMath = {
  name: "mathBlock",
  level: "block",
  start: BLOCK_MATH_START,
  tokenizer(src) {
    const found = matchBlockMath(src);
    return found ? { type: "mathBlock", raw: found.raw, text: found.text } : undefined;
  },
};

export const markedCallout = {
  name: "callout",
  level: "block",
  tokenizer(src) {
    const found = matchCallout(src);
    return found ? { type: "callout", raw: found.raw, kind: found.kind, tokens: this.lexer.blockTokens(found.body) } : undefined;
  },
};

export const serializeInlineMark = (mark, content) => `${mark.open}${content}${mark.close}`;

export const serializeInlineMath = (tex) => `$${tex}$`;

export const serializeBlockMath = (tex) => `$$\n${tex}\n$$`;

export const serializeCallout = (kind, body) =>
  [`> [!${kind.toUpperCase()}]`, ...body.split("\n").map((line) => (line ? `> ${line}` : ">"))].join("\n");
