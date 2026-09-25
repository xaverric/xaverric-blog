import mermaid from "mermaid";
import { deferInlineStyles } from "./csp-styles.js";

const FONT = '"Bricolage Grotesque", ui-sans-serif, sans-serif';
const sheets = new Map();
let initialized = null;

const darkQuery = () => matchMedia("(prefers-color-scheme: dark)");

const themeName = () => (darkQuery().matches ? "dark" : "neutral");

const configure = (theme) => {
  if (initialized === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
    fontFamily: FONT,
    flowchart: { htmlLabels: false },
    themeVariables: { fontFamily: FONT, fontSize: "16px" },
  });
  initialized = theme;
};

const adoptStyles = (id, css) => {
  const sheet = sheets.get(id) ?? new CSSStyleSheet();
  sheet.replaceSync(css);
  if (!sheets.has(id)) {
    sheets.set(id, sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
};

export const toCspSafeSvg = (svgText, id) => {
  const doc = new DOMParser().parseFromString(deferInlineStyles(svgText), "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName !== "svg") throw new Error("Mermaid returned no SVG");
  const css = [...svg.querySelectorAll("style")].map((style) => {
    const text = style.textContent;
    style.remove();
    return text;
  });
  const inline = [...(svg.hasAttribute("data-csp-style") ? [svg] : []), ...svg.querySelectorAll("[data-csp-style]")].map((el) => {
    const value = el.getAttribute("data-csp-style");
    el.removeAttribute("data-csp-style");
    return [el, value];
  });
  svg.querySelectorAll("script, foreignObject iframe").forEach((el) => el.remove());
  const node = document.importNode(svg, true);
  const imported = [node, ...node.querySelectorAll("*")];
  const original = [svg, ...svg.querySelectorAll("*")];
  inline.forEach(([el, value]) => {
    const index = original.indexOf(el);
    if (index >= 0) imported[index].style.cssText = value;
  });
  if (css.length) adoptStyles(id, css.join("\n"));
  return node;
};

const withCspSafeDom = async (sheetId, run) => {
  const { setAttribute } = Element.prototype;
  const { insertBefore, appendChild } = Node.prototype;
  const { parseFromString } = DOMParser.prototype;
  DOMParser.prototype.parseFromString = function (markup, type) {
    return parseFromString.call(this, deferInlineStyles(String(markup)), type);
  };
  const isStyle = (node) => node?.nodeName?.toLowerCase() === "style";
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === "style") {
      this.style.cssText = String(value);
      return undefined;
    }
    return setAttribute.call(this, name, value);
  };
  Node.prototype.insertBefore = function (node, child) {
    if (!isStyle(node)) return insertBefore.call(this, node, child);
    adoptStyles(sheetId, node.textContent);
    return node;
  };
  Node.prototype.appendChild = function (node) {
    if (!isStyle(node)) return appendChild.call(this, node);
    adoptStyles(sheetId, node.textContent);
    return node;
  };
  try {
    return await run();
  } finally {
    Element.prototype.setAttribute = setAttribute;
    Node.prototype.insertBefore = insertBefore;
    Node.prototype.appendChild = appendChild;
    DOMParser.prototype.parseFromString = parseFromString;
  }
};

let counter = 0;
let queue = Promise.resolve();

export const renderDiagram = (block, source) => {
  const task = queue.then(() => draw(block, source));
  queue = task.catch(() => {});
  return task;
};

const draw = async (block, source) => {
  configure(themeName());
  counter += 1;
  const id = `mermaid-${Date.now().toString(36)}-${counter}`;
  const sheetId = block.dataset.sheet ?? id;
  block.dataset.sheet = sheetId;
  try {
    const { svg } = await withCspSafeDom(sheetId, () => mermaid.render(id, source));
    const node = toCspSafeSvg(svg, sheetId);
    block.querySelector("svg")?.remove();
    block.append(node);
    block.dataset.state = "ready";
  } catch {
    block.dataset.state = "failed";
  } finally {
    document.getElementById(`d${id}`)?.remove();
    const stray = document.getElementById(id);
    if (stray && !block.contains(stray)) stray.remove();
  }
};

export const renderAll = async (blocks) => {
  for (const block of blocks) {
    const source = block.querySelector(".mermaid-src code")?.textContent ?? "";
    await renderDiagram(block, source);
  }
};

export const watchScheme = (blocks) => darkQuery().addEventListener("change", () => renderAll(blocks));
