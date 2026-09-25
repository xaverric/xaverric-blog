import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "../../client/admin/editor/extensions.js";

const fixture = fs.readFileSync(path.join(import.meta.dirname, "fixture.md"), "utf8").trimEnd();

let editors = [];

const load = (markdown) => {
  const editor = new Editor({ element: document.createElement("div"), extensions: editorExtensions(), content: markdown, contentType: "markdown" });
  editors.push(editor);
  return editor;
};

const roundTrip = (markdown) => load(markdown).getMarkdown();

afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

describe("markdown round trip", () => {
  it("keeps the fixture byte for byte", () => {
    expect(roundTrip(fixture)).toBe(fixture);
  });

  it("is idempotent", () => {
    const once = roundTrip(fixture);
    expect(roundTrip(once)).toBe(once);
  });

  it("builds the expected document nodes", () => {
    const json = load(fixture).getJSON();
    const types = new Set();
    const walk = (node) => {
      types.add(node.type);
      node.marks?.forEach((mark) => types.add(`mark:${mark.type}`));
      node.content?.forEach(walk);
    };
    walk(json);
    ["heading", "bulletList", "orderedList", "taskList", "blockquote", "callout", "codeBlock", "mathBlock", "mathInline", "table", "image", "horizontalRule", "footnoteRef", "footnoteDef"].forEach((type) => expect(types).toContain(type));
    ["mark:bold", "mark:italic", "mark:strike", "mark:code", "mark:link", "mark:highlight", "mark:added", "mark:removed"].forEach((type) => expect(types).toContain(type));
  });
});

describe("round trip edge cases", () => {
  it.each([
    ["nested marks", "Some ==**bold** highlight== and {+*new*+} text."],
    ["escaped characters", "Literal \\*stars\\* and \\_underscores\\_ stay literal."],
    ["prices next to math", "It costs $5, $10 or $x^2$ units."],
    ["a fence inside code", "````md\n```js\nx\n```\n````"],
    ["a multi-paragraph callout", "> [!TIP]\n> First paragraph.\n>\n> Second with `code`."],
    ["all heading levels", "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six"],
    ["aligned table", "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |"],
    ["pipes in table cells", "| Expr |\n| --- |\n| a \\| b |"],
    ["an image title with a caption", '![Alt text](https://example.com/x.png "Caption")'],
    ["a footnote reference mid sentence", "One[^a] and two[^b].\n\n[^a]: First.\n\n[^b]: Second."],
  ])("keeps %s", (name, markdown) => {
    const once = roundTrip(markdown);
    expect(once).toBe(markdown);
  });

  it("normalizes a one-line block formula to the fenced form", () => {
    expect(roundTrip("$$a^2 + b^2 = c^2$$")).toBe("$$\na^2 + b^2 = c^2\n$$");
  });

  it("serializes marks applied in the editor", () => {
    const editor = load("plain words here");
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleHighlight().setTextSelection({ from: 7, to: 12 }).toggleAdded().run();
    editor.chain().setTextSelection({ from: 13, to: 17 }).toggleRemoved().run();
    expect(editor.getMarkdown()).toBe("==plain== {+words+} {-here-}");
  });

  it("inserts math, callouts and tables through commands", () => {
    const editor = load("Start");
    editor.chain().focus("end").insertMathInline("a+b").run();
    editor.chain().focus("end").insertMathBlock("x^2").run();
    expect(editor.getMarkdown()).toContain("Start$a+b$");
    expect(editor.getMarkdown()).toContain("$$\nx^2\n$$");
    const table = load("");
    table.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    expect(table.getMarkdown()).toMatch(/^\| {2}\| {2}\|\n\| --- \| --- \|\n\| {2}\| {2}\|/);
  });
});
