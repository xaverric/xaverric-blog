import katex from "katex";

const LANGUAGES = ["mermaid", "js", "ts", "json", "bash", "html", "css", "python", "java", "kotlin", "sql", "yaml", "go", "rust", "diff", "markdown", "dockerfile", "toml", "c", "cpp", "csharp", "php", "ruby", "swift", "graphql", "nginx", "http", "powershell", "text"];

let diagramRenderer = null;

export const setDiagramRenderer = (renderer) => {
  diagramRenderer = renderer;
};

export const renderTex = (tex, displayMode) => {
  try {
    return { html: katex.renderToString(tex || "\\square", { displayMode, output: "mathml", throwOnError: true, strict: "ignore" }), error: null };
  } catch (error) {
    return { html: "", error: error?.message ?? "Invalid formula" };
  }
};

const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text !== undefined) node.textContent = text;
  return node;
};

const setMarkup = (editor, getPos, attrs) => {
  const pos = typeof getPos === "function" ? getPos() : null;
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
};

const paint = (target, tex, displayMode) => {
  const { html, error } = renderTex(tex, displayMode);
  target.innerHTML = html;
  target.dataset.error = error ? "true" : "false";
  if (error) target.textContent = tex ? `Check the formula: ${error.replace(/^KaTeX parse error: /, "")}` : "Empty formula";
};

export const mathBlockView = ({ node, editor, getPos }) => {
  const dom = el("div", { class: "nv-math", "data-math-block": "", contenteditable: "false" });
  const preview = el("div", { class: "nv-math__preview", "aria-hidden": "true" });
  const label = el("label", { class: "nv-math__label" }, "TeX");
  const source = el("textarea", { class: "nv-math__src", rows: "2", spellcheck: "false", "aria-label": "Formula in TeX" });
  source.value = node.attrs.tex;
  label.append(source);
  dom.append(preview, label);
  paint(preview, node.attrs.tex, true);
  const fit = () => {
    source.rows = Math.min(12, Math.max(2, source.value.split("\n").length));
  };
  fit();
  source.addEventListener("input", () => {
    fit();
    paint(preview, source.value, true);
    setMarkup(editor, getPos, { tex: source.value });
  });
  source.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      const pos = getPos();
      editor.chain().focus().setTextSelection(pos + node.nodeSize).run();
    }
  });
  preview.addEventListener("click", () => source.focus());
  return {
    dom,
    update(next) {
      if (next.type.name !== "mathBlock") return false;
      if (source.value !== next.attrs.tex) {
        source.value = next.attrs.tex;
        fit();
        paint(preview, next.attrs.tex, true);
      }
      node = next;
      return true;
    },
    selectNode: () => {
      dom.classList.add("is-selected");
      source.focus();
    },
    deselectNode: () => dom.classList.remove("is-selected"),
    stopEvent: (event) => event.target === source,
    ignoreMutation: () => true,
  };
};

export const mathInlineView = ({ node, editor, getPos }) => {
  const dom = el("span", { class: "nv-math-inline", "data-math-inline": "", contenteditable: "false", title: "Click to edit the formula" });
  const preview = el("span", { class: "nv-math-inline__preview" });
  const input = el("input", { class: "nv-math-inline__src", type: "text", spellcheck: "false", "aria-label": "Inline formula in TeX", hidden: "" });
  dom.append(preview, input);
  paint(preview, node.attrs.tex, false);
  const open = () => {
    input.hidden = false;
    input.value = node.attrs.tex;
    input.size = Math.max(4, input.value.length + 1);
    preview.hidden = true;
    input.focus();
    input.select();
  };
  const close = (commit) => {
    if (input.hidden) return;
    input.hidden = true;
    preview.hidden = false;
    if (commit && input.value !== node.attrs.tex) setMarkup(editor, getPos, { tex: input.value.trim() || node.attrs.tex });
  };
  dom.addEventListener("click", (event) => {
    if (event.target !== input) open();
  });
  input.addEventListener("input", () => {
    input.size = Math.max(4, input.value.length + 1);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      close(true);
      editor.commands.focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(false);
      editor.commands.focus();
    }
  });
  input.addEventListener("blur", () => close(true));
  return {
    dom,
    update(next) {
      if (next.type.name !== "mathInline") return false;
      node = next;
      paint(preview, next.attrs.tex, false);
      return true;
    },
    selectNode: () => dom.classList.add("is-selected"),
    deselectNode: () => dom.classList.remove("is-selected"),
    stopEvent: (event) => event.target === input,
    ignoreMutation: () => true,
  };
};

export const codeBlockView = ({ node, editor, getPos }) => {
  const dom = el("figure", { class: "nv-code" });
  const bar = el("div", { class: "nv-code__bar", contenteditable: "false" });
  const lang = el("input", { class: "nv-code__lang", type: "text", list: "nv-languages", placeholder: "language", spellcheck: "false", "aria-label": "Code language" });
  const pre = el("pre", { class: "nv-code__pre" });
  const code = el("code");
  const preview = el("div", { class: "nv-code__preview", contenteditable: "false", "aria-label": "Diagram preview" });
  pre.append(code);
  bar.append(lang);
  dom.append(bar, pre, preview);
  if (!document.getElementById("nv-languages")) {
    const list = el("datalist", { id: "nv-languages" });
    LANGUAGES.forEach((name) => list.append(el("option", { value: name })));
    document.body.append(list);
  }
  let timer = null;
  let current = node;
  const refresh = () => {
    const language = current.attrs.language ?? "";
    lang.value = language;
    dom.dataset.language = language;
    const mermaid = language === "mermaid";
    preview.hidden = !mermaid;
    clearTimeout(timer);
    if (mermaid && diagramRenderer) timer = setTimeout(() => diagramRenderer(preview, current.textContent), 450);
  };
  lang.addEventListener("change", () => setMarkup(editor, getPos, { language: lang.value.trim().toLowerCase() || null }));
  lang.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setMarkup(editor, getPos, { language: lang.value.trim().toLowerCase() || null });
      editor.commands.focus();
    }
  });
  refresh();
  return {
    dom,
    contentDOM: code,
    update(next) {
      if (next.type.name !== current.type.name) return false;
      const changed = next.textContent !== current.textContent || next.attrs.language !== current.attrs.language;
      current = next;
      if (changed) refresh();
      return true;
    },
    stopEvent: (event) => bar.contains(event.target) || preview.contains(event.target),
    ignoreMutation: (mutation) => mutation.type !== "selection" && !code.contains(mutation.target),
    destroy: () => clearTimeout(timer),
  };
};
