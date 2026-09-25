import { countWords } from "../../../shared/text.js";

const lineStartAt = (text, pos) => text.lastIndexOf("\n", pos - 1) + 1;

const lineEndAt = (text, pos) => {
  const end = text.indexOf("\n", pos);
  return end < 0 ? text.length : end;
};

export const wrapSelection = (text, from, to, open, close = open, placeholder = "text") => {
  const selected = text.slice(from, to);
  const before = text.slice(from - open.length, from);
  const after = text.slice(to, to + close.length);
  if (before === open && after === close) {
    return { text: text.slice(0, from - open.length) + selected + text.slice(to + close.length), from: from - open.length, to: to - open.length };
  }
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return { text: text.slice(0, from) + inner + text.slice(to), from, to: from + inner.length };
  }
  const inner = selected || placeholder;
  return { text: text.slice(0, from) + open + inner + close + text.slice(to), from: from + open.length, to: from + open.length + inner.length };
};

const HEADING = /^#{1,6}\s+/;

const mapLines = (text, from, to, transform) => {
  const start = lineStartAt(text, from);
  const end = lineEndAt(text, to);
  const lines = text.slice(start, end).split("\n");
  const next = transform(lines).join("\n");
  return { text: text.slice(0, start) + next + text.slice(end), from: start, to: start + next.length };
};

export const setHeading = (text, from, to, level) =>
  mapLines(text, from, to, (lines) => lines.map((line) => (level > 0 ? `${"#".repeat(level)} ${line.replace(HEADING, "")}` : line.replace(HEADING, ""))));

const PREFIXES = {
  bullet: { pattern: /^(\s*)[-*+]\s+(?!\[[ xX]\])/, make: () => "- " },
  ordered: { pattern: /^(\s*)\d+[.)]\s+/, make: (i) => `${i + 1}. ` },
  task: { pattern: /^(\s*)[-*+]\s+\[[ xX]\]\s+/, make: () => "- [ ] " },
  quote: { pattern: /^(\s*)>\s?/, make: () => "> " },
};

export const toggleLinePrefix = (text, from, to, kind) => {
  const { pattern, make } = PREFIXES[kind];
  return mapLines(text, from, to, (lines) => {
    const content = lines.filter((line) => line.trim());
    const all = content.length > 0 && content.every((line) => pattern.test(line));
    let index = 0;
    return lines.map((line) => {
      if (!line.trim()) return line;
      if (all) return line.replace(pattern, "$1");
      const stripped = Object.values(PREFIXES).reduce((current, prefix) => current.replace(prefix.pattern, "$1"), line);
      const indent = /^\s*/.exec(stripped)[0];
      return `${indent}${make(index++)}${stripped.slice(indent.length)}`;
    });
  });
};

export const insertBlock = (text, from, to, block, { selectFrom = 0, selectTo = 0 } = {}) => {
  const selected = text.slice(from, to);
  const content = typeof block === "function" ? block(selected) : block;
  const start = from;
  const before = text.slice(0, start);
  const after = text.slice(to);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${content}${trail}`;
  const base = start + lead.length;
  return { text: before + inserted + after, from: base + selectFrom, to: base + (selectTo || content.length) };
};

export const tableTemplate = (rows = 2, cols = 3) => {
  const header = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...Array.from({ length: rows }, () => line(header.map(() => " ")))].join("\n");
};

export const fencedBlock = (language, body) => {
  const fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}${language}\n${body}\n${fence}`;
};

export const linkMarkdown = (label, href, title) => `[${label || href}](${href}${title ? ` "${title.replace(/"/g, "'")}"` : ""})`;

export const imageMarkdown = (alt, src, title) => `![${alt.replace(/[[\]]/g, "")}](${src}${title ? ` "${title.replace(/"/g, "'")}"` : ""})`;

export const cursorInfo = (text, pos) => {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const column = pos - lineStartAt(text, pos) + 1;
  return { line, column, lines: text.split("\n").length, words: countWords(text) };
};
