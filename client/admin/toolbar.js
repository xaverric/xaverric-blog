import { h } from "./dom.js";
import { icon } from "./icons.js";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const shortcutLabel = (combo) =>
  combo
    ? combo
        .split("-")
        .map((part) => (part === "Mod" ? (isMac() ? "⌘" : "Ctrl") : part === "Alt" ? (isMac() ? "⌥" : "Alt") : part === "Shift" ? (isMac() ? "⇧" : "Shift") : part.toUpperCase()))
        .join(isMac() ? "" : "+")
    : "";

export const GROUPS = [
  [
    ["bold", "Bold", "Mod-b"],
    ["italic", "Italic", "Mod-i"],
    ["strike", "Strikethrough", "Mod-Shift-s"],
    ["code", "Inline code", "Mod-e"],
  ],
  [
    ["highlight", "Highlight", "Mod-Shift-h"],
    ["added", "Mark as added", "Mod-Shift-="],
    ["removed", "Mark as removed", "Mod-Shift--"],
  ],
  [
    ["bullet", "Bulleted list", "Mod-Shift-8"],
    ["ordered", "Numbered list", "Mod-Shift-7"],
    ["task", "Task list", "Mod-Shift-9"],
    ["quote", "Blockquote", "Mod-Shift-b"],
    ["callout", "Callout", null],
  ],
  [
    ["table", "Table", null],
    ["image", "Image", null],
    ["link", "Link", "Mod-k"],
    ["codeblock", "Code block", "Mod-Alt-c"],
    ["mermaid", "Mermaid diagram", null],
    ["math", "Math block", null],
    ["rule", "Divider", null],
  ],
];

export const BLOCK_TYPES = [
  ["p", "Normal"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["h4", "Heading 4"],
  ["h5", "Heading 5"],
  ["h6", "Heading 6"],
];

const toolButton = ([id, label, combo], run) =>
  h(
    "button",
    {
      class: "tool",
      type: "button",
      "data-tool": id,
      "aria-label": label,
      title: combo ? `${label} (${shortcutLabel(combo)})` : label,
      onmousedown: (event) => event.preventDefault(),
      onclick: () => run(id),
    },
    icon(id),
  );

export const buildToolbar = ({ onTool, onBlock, onMode, onWrap, fileMenu }) => {
  const block = h(
    "select",
    { class: "tool-select", "aria-label": "Block type", onchange: (event) => onBlock(event.target.value) },
    BLOCK_TYPES.map(([value, label]) => h("option", { value }, label)),
  );
  const wrap = h("button", { class: "tool", type: "button", "data-tool": "wrap", "aria-label": "Word wrap", title: "Word wrap", "aria-pressed": "true", onclick: () => onWrap() }, icon("wrap"));
  const modes = h(
    "div",
    { class: "modes", role: "group", "aria-label": "Editing mode" },
    h("button", { type: "button", "data-mode": "editor", "aria-pressed": "true", title: `Editor (${shortcutLabel("Mod-/")})`, onclick: () => onMode("editor") }, "Editor"),
    h("button", { type: "button", "data-mode": "code", "aria-pressed": "false", title: `Code (${shortcutLabel("Mod-/")})`, onclick: () => onMode("code") }, "Code"),
  );
  const root = h(
    "div",
    { class: "toolbar", role: "toolbar", "aria-label": "Formatting" },
    h("div", { class: "toolbar__group" }, fileMenu, block),
    GROUPS.map((group) => h("div", { class: "toolbar__group" }, group.map((item) => toolButton(item, onTool)))),
    h("div", { class: "toolbar__group toolbar__group--end" }, wrap, modes),
  );
  return {
    root,
    block,
    setActive: (active) => root.querySelectorAll("[data-tool]").forEach((button) => {
      if (button.dataset.tool === "wrap") return;
      const on = active.has(button.dataset.tool);
      if (on) button.setAttribute("aria-pressed", "true");
      else button.removeAttribute("aria-pressed");
    }),
    setBlock: (value) => {
      if (block.value !== value) block.value = value;
    },
    setMode: (mode) => modes.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode))),
    setWrap: (on) => wrap.setAttribute("aria-pressed", String(on)),
  };
};

export const menuButton = (label, items) => {
  const menu = h("div", { class: "menu", role: "menu", hidden: "" });
  const button = h("button", { class: "tool tool--text", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, label, icon("chevron"));
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
  };
  const outside = (event) => {
    if (!wrapper.contains(event.target)) close();
  };
  const open = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
    document.addEventListener("pointerdown", outside, true);
  };
  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Escape") {
      close();
      button.focus();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length].focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length].focus();
    }
  });
  items.forEach(([text, run]) =>
    menu.append(
      h("button", {
        type: "button",
        role: "menuitem",
        onclick: () => {
          close();
          run();
        },
      }, text),
    ),
  );
  const wrapper = h("div", { class: "menu-wrap" }, button, menu);
  return wrapper;
};
