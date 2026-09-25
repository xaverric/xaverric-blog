import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "../../client/admin/autosave.js";
import { altFromName, fitWithin, keepsOriginal } from "../../client/admin/image.js";
import { cursorInfo, fencedBlock, imageMarkdown, insertBlock, linkMarkdown, setHeading, tableTemplate, toggleLinePrefix, wrapSelection } from "../../client/admin/editor/text-commands.js";
import { activeHeading } from "../../client/toc.js";
import { attachCopyButton } from "../../client/copy.js";
import { countWords, readingMinutes, slugify, truncate } from "../../shared/text.js";

describe("text commands", () => {
  it("wraps, unwraps and uses a placeholder", () => {
    expect(wrapSelection("a word b", 2, 6, "**")).toEqual({ text: "a **word** b", from: 4, to: 8 });
    expect(wrapSelection("a **word** b", 4, 8, "**")).toEqual({ text: "a word b", from: 2, to: 6 });
    expect(wrapSelection("a **word** b", 2, 10, "**")).toEqual({ text: "a word b", from: 2, to: 6 });
    expect(wrapSelection("x ", 2, 2, "{+", "+}")).toEqual({ text: "x {+text+}", from: 4, to: 8 });
  });

  it("sets and clears headings on every selected line", () => {
    expect(setHeading("one\ntwo", 0, 5, 2).text).toBe("## one\n## two");
    expect(setHeading("### one", 3, 3, 1).text).toBe("# one");
    expect(setHeading("### one", 3, 3, 0).text).toBe("one");
  });

  it("toggles list and quote prefixes", () => {
    expect(toggleLinePrefix("a\nb", 0, 3, "bullet").text).toBe("- a\n- b");
    expect(toggleLinePrefix("- a\n- b", 0, 7, "bullet").text).toBe("a\nb");
    expect(toggleLinePrefix("a\n\nb", 0, 4, "ordered").text).toBe("1. a\n\n2. b");
    expect(toggleLinePrefix("- a", 0, 3, "ordered").text).toBe("1. a");
    expect(toggleLinePrefix("a", 0, 1, "task").text).toBe("- [ ] a");
    expect(toggleLinePrefix("> a", 0, 3, "quote").text).toBe("a");
  });

  it("inserts blocks separated by blank lines", () => {
    expect(insertBlock("para", 4, 4, "---").text).toBe("para\n\n---");
    expect(insertBlock("a\n\nb", 3, 3, "X").text).toBe("a\n\nX\n\nb");
    expect(insertBlock("", 0, 0, "X")).toEqual({ text: "X", from: 0, to: 1 });
  });

  it("builds tables, fences, links and images", () => {
    expect(tableTemplate(1, 2)).toBe("| Column 1 | Column 2 |\n| --- | --- |\n|   |   |");
    expect(fencedBlock("md", "```js\nx\n```")).toBe("````md\n```js\nx\n```\n````");
    expect(linkMarkdown("site", "https://x.cz", 'a "b"')).toBe("[site](https://x.cz \"a 'b'\")");
    expect(imageMarkdown("a [b]", "/media/x.webp")).toBe("![a b](/media/x.webp)");
  });

  it("reports cursor position, lines and words", () => {
    expect(cursorInfo("one two\nthree", 10)).toEqual({ line: 2, column: 3, lines: 2, words: 3 });
    expect(cursorInfo("", 0)).toEqual({ line: 1, column: 1, lines: 1, words: 0 });
  });
});

describe("text helpers", () => {
  it("slugifies with diacritics", () => {
    expect(slugify("Příliš žluťoučký kůň -- úpěl!")).toBe("prilis-zlutoucky-kun-upel");
    expect(slugify("   ")).toBe("");
    expect(slugify("a".repeat(100)).length).toBe(80);
  });

  it("counts words and reading time", () => {
    expect(countWords("It's a well-known fact, 42 times.")).toBe(6);
    expect(readingMinutes("word ".repeat(10))).toBe(1);
    expect(readingMinutes("word ".repeat(1100))).toBe(5);
  });

  it("truncates on a word boundary", () => {
    expect(truncate("one two three four", 12)).toBe("one two…");
    expect(truncate("short", 12)).toBe("short");
  });
});

describe("images", () => {
  it("fits the long edge within 1600 px", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(900, 3200)).toEqual({ width: 450, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("derives alt text from file names and keeps small GIFs", () => {
    expect(altFromName("my_screenshot-final.PNG")).toBe("my screenshot final");
    expect(keepsOriginal({ type: "image/gif", size: 1000 })).toBe(true);
    expect(keepsOriginal({ type: "image/gif", size: 2 * 1048576 })).toBe(false);
    expect(keepsOriginal({ type: "image/png", size: 10 })).toBe(false);
  });
});

describe("autosave", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces, merges patches and reports states", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ ok: true });
    const states = [];
    const autosave = createAutosave({ save, delay: 1000, onState: (state) => states.push(state) });
    autosave.queue({ title: "a" });
    autosave.queue({ bodyMd: "b" });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledWith({ title: "a", bodyMd: "b" });
    expect(states).toEqual(["dirty", "dirty", "saving", "saved"]);
  });

  it("keeps failed changes and retries them with newer ones", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const autosave = createAutosave({ save, delay: 10 });
    await autosave.queue({ title: "a" }, { immediate: true });
    expect(autosave.state()).toBe("error");
    autosave.queue({ bodyMd: "b" });
    await autosave.flush();
    expect(save).toHaveBeenLastCalledWith({ title: "a", bodyMd: "b" });
    expect(autosave.state()).toBe("saved");
  });
});

describe("public helpers", () => {
  it("picks the top-most visible heading", () => {
    const entry = (id, top, isIntersecting = true) => ({ target: { id }, boundingClientRect: { top }, isIntersecting });
    expect(activeHeading([entry("b", 300), entry("a", 100)], null)).toBe("a");
    expect(activeHeading([entry("a", 100, false)], "z")).toBe("z");
  });

  it("adds a copy button that copies the code", async () => {
    document.body.innerHTML = '<figure class="code" data-lang="js"><figcaption class="code__bar"></figcaption><pre><code>let a = 1;</code></pre></figure>';
    const clipboard = { writeText: vi.fn().mockResolvedValue() };
    const button = attachCopyButton(document.querySelector("figure"), clipboard);
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(clipboard.writeText).toHaveBeenCalledWith("let a = 1;");
    expect(button.dataset.state).toBe("copied");
    expect(attachCopyButton(document.querySelector("figure"), clipboard)).toBeNull();
  });
});

describe("admin helpers", () => {
  it("moves inline styles out of the way of the CSP", async () => {
    const { deferInlineStyles } = await import("../../client/csp-styles.js");
    expect(deferInlineStyles('<svg style="max-width: 10px"><g style="fill:red" class="style"></g></svg>')).toBe('<svg data-csp-style="max-width: 10px"><g data-csp-style="fill:red" class="style"></g></svg>');
  });

  it("filters posts by status and query", async () => {
    const { filterPosts } = await import("../../client/admin/list.js");
    const posts = [
      { title: "Workers at the edge", slug: "workers", excerpt: "", tags: ["cloudflare"], status: "published" },
      { title: "Draft", slug: "draft", excerpt: "about D1", tags: [], status: "draft" },
    ];
    expect(filterPosts(posts, { query: "", status: "draft" }).map((post) => post.slug)).toEqual(["draft"]);
    expect(filterPosts(posts, { query: "CLOUDFLARE", status: "" }).map((post) => post.slug)).toEqual(["workers"]);
    expect(filterPosts(posts, { query: "d1", status: "published" })).toEqual([]);
  });

  it("computes minimal CodeMirror changes", async () => {
    const { minimalChange } = await import("../../client/admin/editor/code.js");
    expect(minimalChange("hello world", "hello **world**")).toEqual({ from: 6, to: 11, insert: "**world**" });
    expect(minimalChange("same", "same")).toEqual({ from: 4, to: 4, insert: "" });
  });

  it("parses footnote definitions with continuation lines", async () => {
    const { matchFootnoteDef } = await import("../../client/admin/editor/extensions.js");
    expect(matchFootnoteDef("[^note]: First line\n    second line\n\nNext")).toEqual({ raw: "[^note]: First line\n    second line\n\n", label: "note", text: "First line second line" });
    expect(matchFootnoteDef("[^1] not a definition")).toBeNull();
  });
});
