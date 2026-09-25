import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { BLOCK_MATH_START, CALLOUT_START, CALLOUT_TYPES, FOOTNOTE_DEF_START, INLINE_MARKS, matchBlockMath, matchCallout, matchInlineMark, matchInlineMath, serializeBlockMath, serializeInlineMath } from "../../../shared/syntax.js";
import { codeBlockView, mathBlockView, mathInlineView } from "./views.js";

const indexOf = (src, needle) => {
  const at = src.indexOf(needle);
  return at < 0 ? -1 : at;
};

const SHORTCUTS = { highlight: "Mod-Shift-h", added: "Mod-Shift-=", removed: "Mod-Shift--" };

const inlineMark = (mark) =>
  Mark.create({
    name: mark.name,
    priority: 101,
    excludes: "code",
    parseHTML: () => [{ tag: mark.className ? `${mark.tag}.${mark.className}` : mark.tag }],
    renderHTML: ({ HTMLAttributes }) => [mark.tag, mergeAttributes(HTMLAttributes, mark.className ? { class: mark.className } : {}), 0],
    markdownTokenizer: {
      name: mark.name,
      level: "inline",
      start: (src) => indexOf(src, mark.open),
      tokenize: (src, tokens, lexer) => {
        const found = matchInlineMark(mark, src);
        return found ? { type: mark.name, raw: found.raw, text: found.text, tokens: lexer.inlineTokens(found.text) } : undefined;
      },
    },
    parseMarkdown: (token, helpers) => helpers.applyMark(mark.name, helpers.parseInline(token.tokens || [])),
    renderMarkdown: (node, helpers) => `${mark.open}${helpers.renderChildren(node)}${mark.close}`,
    addCommands() {
      return { [`toggle${mark.name[0].toUpperCase()}${mark.name.slice(1)}`]: () => ({ commands }) => commands.toggleMark(this.name) };
    },
    addKeyboardShortcuts() {
      return { [SHORTCUTS[mark.name]]: () => this.editor.commands.toggleMark(this.name) };
    },
  });

export const MarkExtensions = INLINE_MARKS.map(inlineMark);

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ tex: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-math-inline]", getAttrs: (el) => ({ tex: el.getAttribute("data-tex") ?? "" }) }],
  renderHTML: ({ node }) => ["span", { "data-math-inline": "", "data-tex": node.attrs.tex, class: "nv-math-inline" }],
  markdownTokenizer: {
    name: "mathInline",
    level: "inline",
    start: (src) => indexOf(src, "$"),
    tokenize: (src) => {
      const found = matchInlineMath(src);
      return found ? { type: "mathInline", raw: found.raw, text: found.text } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("mathInline", { tex: token.text }),
  renderMarkdown: (node) => serializeInlineMath(node.attrs?.tex ?? ""),
  addNodeView: () => mathInlineView,
  addCommands() {
    return {
      insertMathInline:
        (tex = "x^2") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { tex } }),
    };
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({ tex: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-math-block]", getAttrs: (el) => ({ tex: el.getAttribute("data-tex") ?? "" }) }],
  renderHTML: ({ node }) => ["div", { "data-math-block": "", "data-tex": node.attrs.tex, class: "nv-math" }],
  markdownTokenizer: {
    name: "mathBlock",
    level: "block",
    start: (src) => BLOCK_MATH_START(src) ?? -1,
    tokenize: (src) => {
      const found = matchBlockMath(src);
      return found ? { type: "mathBlock", raw: found.raw, text: found.text } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("mathBlock", { tex: token.text }),
  renderMarkdown: (node) => serializeBlockMath(node.attrs?.tex ?? ""),
  addNodeView: () => mathBlockView,
  addCommands() {
    return {
      insertMathBlock:
        (tex = "E = mc^2") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { tex } }),
    };
  },
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({ kind: { default: "note", parseHTML: (el) => el.getAttribute("data-callout") ?? "note" } }),
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ node }) => ["aside", { "data-callout": node.attrs.kind, class: `nv-callout nv-callout--${node.attrs.kind}` }, 0],
  markdownTokenizer: {
    name: "callout",
    level: "block",
    start: (src) => CALLOUT_START(src) ?? -1,
    tokenize: (src, tokens, lexer) => {
      const found = matchCallout(src);
      return found ? { type: "callout", raw: found.raw, kind: found.kind, tokens: lexer.blockTokens(found.body) } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("callout", { kind: token.kind }, helpers.parseChildren(token.tokens || [])),
  renderMarkdown: (node, helpers) => {
    const kind = CALLOUT_TYPES.includes(node.attrs?.kind) ? node.attrs.kind : "note";
    const body = (node.content ?? []).map((child, index) => helpers.renderChild(child, index)).join("\n\n");
    return [`> [!${kind.toUpperCase()}]`, ...body.split("\n").map((line) => (line.trim() ? `> ${line}` : ">"))].join("\n");
  },
  addCommands() {
    return {
      setCallout:
        (kind = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
    };
  },
});

const FOOTNOTE_REF = /^\[\^([^\]\s]{1,40})\]/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]{1,40})\]:[ \t]*([^\n]*)/;
const CONTINUATION = /^(?: {4}|\t)/;

export const matchFootnoteDef = (src) => {
  const head = FOOTNOTE_DEF.exec(src);
  if (!head) return null;
  const lines = src.slice(head[0].length).split("\n").slice(1);
  const count = lines.findIndex((line) => !CONTINUATION.test(line));
  const more = count < 0 ? lines : lines.slice(0, count);
  const consumed = [head[0], ...more].join("\n");
  const blank = /^\n*/.exec(src.slice(consumed.length))[0];
  const text = [head[2], ...more.map((line) => line.replace(CONTINUATION, ""))].join(" ").trim();
  return { raw: consumed + blank, label: head[1], text };
};

export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ label: { default: "1" } }),
  parseHTML: () => [{ tag: "sup[data-footnote-ref]", getAttrs: (el) => ({ label: el.getAttribute("data-label") ?? "1" }) }],
  renderHTML: ({ node }) => ["sup", { "data-footnote-ref": "", "data-label": node.attrs.label, class: "nv-footnote-ref" }, node.attrs.label],
  markdownTokenizer: {
    name: "footnoteRef",
    level: "inline",
    start: (src) => indexOf(src, "[^"),
    tokenize: (src) => {
      const match = FOOTNOTE_REF.exec(src);
      return match && src[match[0].length] !== ":" ? { type: "footnoteRef", raw: match[0], label: match[1] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("footnoteRef", { label: token.label }),
  renderMarkdown: (node) => `[^${node.attrs?.label ?? "1"}]`,
});

export const FootnoteDef = Node.create({
  name: "footnoteDef",
  group: "block",
  content: "inline*",
  addAttributes: () => ({ label: { default: "1" } }),
  parseHTML: () => [{ tag: "p[data-footnote-def]", getAttrs: (el) => ({ label: el.getAttribute("data-label") ?? "1" }) }],
  renderHTML: ({ node }) => ["p", { "data-footnote-def": "", "data-label": node.attrs.label, class: "nv-footnote-def" }, 0],
  markdownTokenizer: {
    name: "footnoteDef",
    level: "block",
    start: (src) => FOOTNOTE_DEF_START(src) ?? -1,
    tokenize: (src, tokens, lexer) => {
      const found = matchFootnoteDef(src);
      return found ? { type: "footnoteDef", raw: found.raw, label: found.label, tokens: lexer.inlineTokens(found.text) } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("footnoteDef", { label: token.label }, helpers.parseInline(token.tokens || [])),
  renderMarkdown: (node, helpers) => `[^${node.attrs?.label ?? "1"}]: ${helpers.renderChildren(node)}`,
});

const longestFence = (text) => Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));

export const CodeBlockWithPreview = CodeBlock.extend({
  addAttributes() {
    return { language: { default: null, parseHTML: (el) => el.getAttribute("data-language") } };
  },
  renderMarkdown: (node, helpers) => {
    const language = node.attrs?.language || "";
    const code = node.content ? helpers.renderChildren(node.content) : "";
    const fence = "`".repeat(longestFence(code) + 1);
    return `${fence}${language}\n${code}\n${fence}`;
  },
  addNodeView: () => codeBlockView,
});

const ALIGN_RULE = { left: ":---", right: "---:", center: ":---:" };

export const renderTable = (node, helpers) => {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      text: (cell.content ?? [])
        .map((child) => helpers.renderChildren(child))
        .join(" ")
        .replace(/\s*\n\s*/g, " ")
        .replace(/(?<!\\)\|/g, "\\|")
        .trim(),
      align: cell.attrs?.align ?? null,
    })),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row) => `| ${Array.from({ length: width }, (_, i) => row[i]?.text ?? "").join(" | ")} |`;
  const rule = `| ${Array.from({ length: width }, (_, i) => ALIGN_RULE[rows[0][i]?.align] ?? "---").join(" | ")} |`;
  return [line(rows[0]), rule, ...rows.slice(1).map(line)].join("\n");
};

const CompactTable = Table.extend({ renderMarkdown: renderTable });

export const MediaImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), title: { default: null } };
  },
}).configure({ inline: false, allowBase64: false });

export const editorExtensions = () => [
  StarterKit.configure({
    codeBlock: false,
    underline: false,
    link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: null, target: null } },
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    trailingNode: {},
  }),
  CodeBlockWithPreview,
  TableKit.configure({ table: false }),
  CompactTable.configure({ resizable: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  MediaImage,
  ...MarkExtensions,
  MathInline,
  MathBlock,
  Callout,
  FootnoteRef,
  FootnoteDef,
  Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
];
