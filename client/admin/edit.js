import { slugify } from "../../shared/text.js";
import { ApiError, api, postPath } from "./api.js";
import { createAutosave } from "./autosave.js";
import { linkDialog, mediaDialog, previewDialog, uploadFiles } from "./dialogs.js";
import { clear, h } from "./dom.js";
import { formatDate, formatTime, fromLocalInput, toLocalInput } from "./format.js";
import { icon } from "./icons.js";
import { buildToolbar, menuButton } from "./toolbar.js";
import { applyTextCommand, createCodeEditor } from "./editor/code.js";
import { cursorInfo, fencedBlock, imageMarkdown, insertBlock, linkMarkdown, setHeading, tableTemplate, toggleLinePrefix, wrapSelection } from "./editor/text-commands.js";
import { setDiagramRenderer } from "./editor/views.js";
import { createRichEditor, currentBlock } from "./editor/wysiwyg.js";
import { countWords, readingMinutes } from "../../shared/text.js";

const MODE_KEY = "blog-admin-mode";
const WRAP_KEY = "blog-admin-wrap";
const MERMAID_SAMPLE = "flowchart LR\n  Draft --> Review --> Publish";
const MARKS = { bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], code: ["`", "`"], highlight: ["==", "=="], added: ["{+", "+}"], removed: ["{-", "-}"] };

const readPref = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const writePref = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
};

const SAVE_TEXT = { saved: "Saved", saving: "Saving…", dirty: "Unsaved changes", error: "Not saved" };

export const mountEditor = async ({ main, slot, navigate, toast, id }) => {
  let post = await api.get(postPath(id));
  const state = {
    mode: readPref(MODE_KEY, "editor") === "code" ? "code" : "editor",
    wrap: readPref(WRAP_KEY, "on") !== "off",
    bodyMd: post.bodyMd,
    loadedMd: post.bodyMd,
    richDirty: false,
    slugAuto: post.slug === slugify(post.title) || post.slug.startsWith("untitled"),
    liveDirty: false,
    uploading: "",
    savedAt: null,
  };

  const isPublished = () => post.status === "published";

  setDiagramRenderer(async (target, source) => {
    const { renderDiagram } = await import("../mermaid.js");
    clear(target).append(h("pre", { class: "mermaid-src" }, h("code", {}, source)));
    await renderDiagram(target, source);
  });

  const saveIndicator = h("p", { class: "save-state", role: "status", "data-state": "saved" }, "Saved");
  const publishButton = h("button", { class: "btn", type: "button" });
  const previewButton = h("button", { class: "btn-quiet", type: "button", title: "Preview with the public renderer" }, icon("eye"), "Preview");
  slot.append(h("a", { class: "bar__link", href: "/admin", "data-nav": "" }, icon("back"), "Posts"), saveIndicator, previewButton, publishButton);

  const showSave = (next, detail) => {
    const text = next === "saved" && state.savedAt ? `Saved ${formatTime(state.savedAt)}` : SAVE_TEXT[next];
    saveIndicator.dataset.state = next;
    clear(saveIndicator).append(text);
    if (next === "error") {
      saveIndicator.append(h("button", { class: "save-state__retry", type: "button", onclick: () => autosave.flush() }, "Retry"));
      const message = detail instanceof ApiError ? detail.message : "Check your connection.";
      if (detail instanceof ApiError && detail.message.startsWith("slug:")) slugError.textContent = detail.message.replace(/^slug: /, "");
      else toast({ tone: "error", message: `Could not save. ${message}` });
    }
  };

  const applyPost = (next) => {
    post = { ...post, ...next };
    renderStatus();
  };

  const autosave = createAutosave({
    delay: 1200,
    save: async (patch) => {
      slugError.textContent = "";
      const next = await api.patch(postPath(id), patch);
      state.savedAt = new Date();
      applyPost(next);
      return next;
    },
    onState: (next, detail) => {
      if (next === "saved") state.liveDirty = false;
      showSave(next, detail);
      renderStatus();
    },
  });

  const change = (patch) => {
    if (isPublished()) {
      state.pending = { ...(state.pending ?? {}), ...patch };
      state.liveDirty = true;
      showSave("dirty");
      renderStatus();
      return;
    }
    autosave.queue(patch);
  };

  const saveNow = async () => {
    pushBody();
    if (isPublished() && state.pending) {
      const pending = state.pending;
      state.pending = null;
      autosave.queue(pending, { immediate: true });
      await autosave.flush();
      return;
    }
    await autosave.flush();
  };

  const title = h("textarea", { class: "doc-title", rows: "1", placeholder: "Title", "aria-label": "Title", maxlength: "200" });
  title.value = post.title;
  const fitTitle = () => {
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  };
  title.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusBody();
    }
  });

  const slug = h("input", { class: "field__input field__input--mono", type: "text", value: post.slug, spellcheck: "false", autocomplete: "off", maxlength: "80", "aria-describedby": "slug-hint" });
  const slugError = h("span", { class: "field__error", role: "alert" });
  const slugHint = h("span", { class: "field__hint", id: "slug-hint" });
  const excerpt = h("textarea", { class: "field__input", rows: "4", maxlength: "400", placeholder: "One or two sentences for the overview, feeds and link previews." });
  excerpt.value = post.excerpt;
  const excerptCount = h("span", { class: "field__hint" });
  const tags = h("input", { class: "field__input", type: "text", value: post.tags.join(", "), placeholder: "workers, d1, javascript", autocomplete: "off" });
  const publishedAt = h("input", { class: "field__input", type: "datetime-local", value: toLocalInput(post.publishedAt) });
  const coverBox = h("div", { class: "cover" });
  const statusBox = h("div", { class: "status-box" });

  const renderSlugHint = () => {
    slugHint.textContent = `blog.xaverric.cz/${slug.value || "…"}`;
  };

  const renderExcerptCount = () => {
    excerptCount.textContent = `${excerpt.value.length} / 400`;
  };

  const renderCover = () => {
    clear(coverBox).append(
      post.coverKey && post.coverUrl ? h("img", { class: "cover__img", src: post.coverUrl, alt: "" }) : h("p", { class: "cover__empty" }, "No cover. The default image is used for link previews."),
      h(
        "div",
        { class: "cover__actions" },
        h("button", { class: "btn-quiet", type: "button", onclick: chooseCover }, post.coverKey ? "Change" : "Choose cover"),
        post.coverKey ? h("button", { class: "btn-quiet btn-quiet--danger", type: "button", onclick: () => setCover(null) }, "Remove") : null,
      ),
    );
  };

  const setCover = (media) => {
    post = { ...post, coverKey: media?.key ?? null, coverUrl: media?.url ?? null };
    renderCover();
    change({ coverKey: post.coverKey });
  };

  const chooseCover = async () => {
    const picked = await mediaDialog({ purpose: "cover", toast });
    if (picked?.key) setCover(picked.media);
    else if (picked) toast({ tone: "error", message: "A cover must be an uploaded image." });
  };

  const renderStatus = () => {
    const published = isPublished();
    publishButton.textContent = published ? (state.liveDirty ? "Update post" : "Published") : "Publish";
    publishButton.disabled = published && !state.liveDirty;
    publishButton.title = published ? "Save your changes to the live post" : "Make this post public";
    clear(statusBox).append(
      h("p", { class: "status-box__line" }, h("span", { class: `status status--${post.status}` }, published ? "Published" : "Draft"), published && post.publishedAt ? h("span", {}, formatDate(post.publishedAt)) : null),
      published
        ? h("p", { class: "status-box__hint" }, state.liveDirty ? "Changes are not live until you update the post." : "Edits to a published post wait for Update.")
        : h("p", { class: "status-box__hint" }, "Drafts save automatically and stay private."),
      h(
        "div",
        { class: "status-box__actions" },
        published ? h("a", { class: "btn-quiet", href: `/${post.slug}`, target: "_blank", rel: "noopener" }, icon("external"), "View live") : null,
        published ? h("button", { class: "btn-quiet", type: "button", onclick: unpublish }, "Unpublish") : null,
        h("button", { class: "btn-quiet btn-quiet--danger", type: "button", onclick: removePost }, icon("trash"), "Delete"),
      ),
    );
  };

  const publish = async () => {
    if (isPublished()) return saveNow();
    if (!title.value.trim()) {
      toast({ tone: "error", message: "Add a title before publishing." });
      title.focus();
      return;
    }
    publishButton.disabled = true;
    try {
      pushBody();
      await autosave.flush();
      const body = publishedAt.value ? { publishedAt: fromLocalInput(publishedAt.value) } : {};
      applyPost(await api.post(postPath(id, "publish"), body));
      publishedAt.value = toLocalInput(post.publishedAt);
      toast({ message: "Published.", action: { label: "View", run: () => window.open(`/${post.slug}`, "_blank", "noopener") } });
    } catch (error) {
      toast({ tone: "error", message: `Could not publish. ${error.message}` });
    } finally {
      renderStatus();
    }
  };

  const unpublish = async () => {
    try {
      await saveNow();
      applyPost(await api.post(postPath(id, "unpublish")));
      state.liveDirty = false;
      showSave("saved");
    } catch (error) {
      toast({ tone: "error", message: `Could not unpublish. ${error.message}` });
    }
  };

  const removePost = async () => {
    try {
      autosave.cancel();
      await api.del(postPath(id));
      navigate("/admin");
      toast({
        message: `Deleted "${post.title || "Untitled"}".`,
        timeout: 10000,
        action: {
          label: "Undo",
          run: async () => {
            await api.post(postPath(id, "restore"));
            navigate(`/admin/posts/${id}`);
          },
        },
      });
    } catch (error) {
      toast({ tone: "error", message: `Could not delete. ${error.message}` });
    }
  };

  publishButton.addEventListener("click", publish);
  previewButton.addEventListener("click", () => previewDialog({ title: title.value, excerpt: excerpt.value, bodyMd: currentMarkdown(), toast }));

  title.addEventListener("input", () => {
    fitTitle();
    const patch = { title: title.value };
    if (state.slugAuto && !isPublished()) {
      const next = slugify(title.value) || post.slug;
      if (next !== slug.value) {
        slug.value = next;
        patch.slug = next;
        renderSlugHint();
      }
    }
    change(patch);
  });
  slug.addEventListener("input", () => {
    state.slugAuto = false;
    slugError.textContent = "";
    renderSlugHint();
  });
  slug.addEventListener("change", () => {
    const next = slugify(slug.value);
    slug.value = next;
    renderSlugHint();
    if (next) change({ slug: next });
    else slugError.textContent = "Use letters, digits and hyphens.";
  });
  excerpt.addEventListener("input", () => {
    renderExcerptCount();
    change({ excerpt: excerpt.value });
  });
  tags.addEventListener("change", () => change({ tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean) }));
  publishedAt.addEventListener("change", () => {
    if (publishedAt.value) change({ publishedAt: fromLocalInput(publishedAt.value) });
  });

  const surface = h("div", { class: "surface", "data-mode": state.mode, "data-wrap": String(state.wrap) });
  const richHost = h("div", { class: "surface__rich" });
  const codeHost = h("div", { class: "surface__code" });
  surface.append(richHost, codeHost);
  const statusLeft = h("span", { class: "statusbar__pos" });
  const statusRight = h("span", { class: "statusbar__info" });
  const statusbar = h("footer", { class: "statusbar", "aria-live": "off" }, statusLeft, statusRight);
  const tableBar = h("div", { class: "table-tools", hidden: "" });

  let rich = null;
  let code = null;

  const currentMarkdown = () => {
    if (state.mode === "editor" && rich && state.richDirty) state.bodyMd = rich.getMarkdown();
    return state.bodyMd;
  };

  let bodyTimer = null;
  const pushBody = () => {
    clearTimeout(bodyTimer);
    if (!state.bodyPending) return;
    state.bodyPending = false;
    change({ bodyMd: currentMarkdown() });
  };
  const bodyChanged = () => {
    state.bodyPending = true;
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(pushBody, 250);
  };

  const refreshStatus = () => {
    if (state.mode === "code" && code) {
      const info = cursorInfo(code.view.state.doc.toString(), code.view.state.selection.main.head);
      statusLeft.textContent = `Line ${info.line}, Column ${info.column}`;
      statusRight.textContent = `${info.lines} lines · ${info.words} words`;
    } else if (rich) {
      const text = rich.getText();
      const words = countWords(text);
      statusLeft.textContent = currentBlock(rich) === "p" ? "Paragraph" : `Heading ${currentBlock(rich).slice(1)}`;
      statusRight.textContent = `${words} words · ${readingMinutes(text)} min read`;
    }
    if (state.uploading) statusRight.textContent = `${state.uploading} · ${statusRight.textContent}`;
  };

  const richActive = () => {
    if (!rich) return new Set();
    const checks = {
      bold: () => rich.isActive("bold"),
      italic: () => rich.isActive("italic"),
      strike: () => rich.isActive("strike"),
      code: () => rich.isActive("code"),
      highlight: () => rich.isActive("highlight"),
      added: () => rich.isActive("added"),
      removed: () => rich.isActive("removed"),
      bullet: () => rich.isActive("bulletList"),
      ordered: () => rich.isActive("orderedList"),
      task: () => rich.isActive("taskList"),
      quote: () => rich.isActive("blockquote"),
      callout: () => rich.isActive("callout"),
      link: () => rich.isActive("link"),
      codeblock: () => rich.isActive("codeBlock") && rich.getAttributes("codeBlock").language !== "mermaid",
      mermaid: () => rich.isActive("codeBlock", { language: "mermaid" }),
      math: () => rich.isActive("mathBlock"),
      table: () => rich.isActive("table"),
    };
    return new Set(Object.entries(checks).filter(([, check]) => check()).map(([name]) => name));
  };

  const syncToolbar = () => {
    if (state.mode === "editor" && rich) {
      toolbar.setActive(richActive());
      toolbar.setBlock(currentBlock(rich));
      tableBar.hidden = !rich.isActive("table");
    } else if (code) {
      const text = code.view.state.doc.toString();
      const head = code.view.state.selection.main.head;
      const line = text.slice(text.lastIndexOf("\n", head - 1) + 1).split("\n")[0];
      const level = /^(#{1,6})\s/.exec(line)?.[1].length;
      toolbar.setBlock(level ? `h${level}` : "p");
      toolbar.setActive(new Set());
      tableBar.hidden = true;
    }
    refreshStatus();
  };

  const insertImages = async (files, pos) => {
    try {
      const uploaded = await uploadFiles(files, {
        onProgress: (text) => {
          state.uploading = text;
          refreshStatus();
        },
      });
      uploaded.forEach((media) => {
        if (state.mode === "editor") {
          rich.chain().focus().insertContentAt(pos ?? rich.state.selection.from, { type: "image", attrs: { src: media.url, alt: media.alt, title: null } }).run();
        } else {
          applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, imageMarkdown(media.alt, media.url)));
        }
      });
    } catch (error) {
      toast({ tone: "error", message: `Upload failed. ${error.message}` });
    } finally {
      state.uploading = "";
      refreshStatus();
    }
  };

  const chooseImage = async () => {
    const picked = await mediaDialog({ purpose: "insert", toast });
    if (!picked?.src) return;
    if (state.mode === "editor") rich.chain().focus().setImage({ src: picked.src, alt: picked.alt, title: picked.title }).run();
    else applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, imageMarkdown(picked.alt, picked.src, picked.title)));
  };

  const editLink = async () => {
    if (state.mode === "editor") {
      const current = rich.getAttributes("link").href ?? "";
      const empty = rich.state.selection.empty;
      const result = await linkDialog({ href: current, showText: empty && !current });
      if (!result) return rich.commands.focus();
      if (!result.href) return rich.chain().focus().extendMarkRange("link").unsetLink().run();
      if (empty && !current) return rich.chain().focus().insertContent({ type: "text", text: result.text || result.href, marks: [{ type: "link", attrs: { href: result.href } }] }).run();
      return rich.chain().focus().extendMarkRange("link").setLink({ href: result.href }).run();
    }
    const { from, to } = code.view.state.selection.main;
    const selected = code.view.state.doc.sliceString(from, to);
    const result = await linkDialog({ href: "", text: selected, showText: !selected });
    if (!result?.href) return code.view.focus();
    return applyTextCommand(code.view, (text) => {
      const md = linkMarkdown(selected || result.text, result.href);
      return { text: text.slice(0, from) + md + text.slice(to), from: from + md.length, to: from + md.length };
    });
  };

  const richCommands = {
    bold: () => rich.chain().focus().toggleBold().run(),
    italic: () => rich.chain().focus().toggleItalic().run(),
    strike: () => rich.chain().focus().toggleStrike().run(),
    code: () => rich.chain().focus().toggleCode().run(),
    highlight: () => rich.chain().focus().toggleHighlight().run(),
    added: () => rich.chain().focus().toggleAdded().run(),
    removed: () => rich.chain().focus().toggleRemoved().run(),
    bullet: () => rich.chain().focus().toggleBulletList().run(),
    ordered: () => rich.chain().focus().toggleOrderedList().run(),
    task: () => rich.chain().focus().toggleTaskList().run(),
    quote: () => rich.chain().focus().toggleBlockquote().run(),
    callout: () => (rich.isActive("callout") ? rich.chain().focus().lift("callout").run() : rich.chain().focus().setCallout("note").run()),
    table: () => rich.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    codeblock: () => rich.chain().focus().toggleCodeBlock().run(),
    mermaid: () =>
      rich.isActive("codeBlock")
        ? rich.chain().focus().updateAttributes("codeBlock", { language: "mermaid" }).run()
        : rich.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: MERMAID_SAMPLE }] }).run(),
    math: () => rich.chain().focus().insertMathBlock("E = mc^2").run(),
    rule: () => rich.chain().focus().setHorizontalRule().run(),
  };

  const codeCommands = {
    ...Object.fromEntries(Object.entries(MARKS).map(([name, [open, close]]) => [name, () => applyTextCommand(code.view, (text, from, to) => wrapSelection(text, from, to, open, close))])),
    bullet: () => applyTextCommand(code.view, (text, from, to) => toggleLinePrefix(text, from, to, "bullet")),
    ordered: () => applyTextCommand(code.view, (text, from, to) => toggleLinePrefix(text, from, to, "ordered")),
    task: () => applyTextCommand(code.view, (text, from, to) => toggleLinePrefix(text, from, to, "task")),
    quote: () => applyTextCommand(code.view, (text, from, to) => toggleLinePrefix(text, from, to, "quote")),
    callout: () => applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, (selected) => `> [!NOTE]\n> ${selected || "Worth knowing."}`)),
    table: () => applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, tableTemplate())),
    codeblock: () => applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, (selected) => fencedBlock("", selected || "code"))),
    mermaid: () => applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, fencedBlock("mermaid", MERMAID_SAMPLE))),
    math: () => applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, (selected) => `$$\n${selected || "E = mc^2"}\n$$`)),
    rule: () => applyTextCommand(code.view, (text, from, to) => insertBlock(text, from, to, "---")),
  };

  const runTool = (name) => {
    if (name === "image") return chooseImage();
    if (name === "link") return editLink();
    const command = (state.mode === "editor" ? richCommands : codeCommands)[name];
    command?.();
    syncToolbar();
    return null;
  };

  const setBlock = (value) => {
    const level = value === "p" ? 0 : Number(value.slice(1));
    if (state.mode === "editor") {
      if (level) rich.chain().focus().setHeading({ level }).run();
      else rich.chain().focus().setParagraph().run();
    } else {
      applyTextCommand(code.view, (text, from, to) => setHeading(text, from, to, level));
    }
    syncToolbar();
  };

  const setMode = (mode) => {
    if (mode === state.mode) return;
    if (mode === "code") {
      const markdown = state.richDirty ? rich.getMarkdown() : state.loadedMd;
      state.bodyMd = markdown;
      code.setDoc(markdown);
    } else {
      state.bodyMd = code.view.state.doc.toString();
      state.loadedMd = state.bodyMd;
      state.richDirty = false;
      rich.commands.setContent(state.bodyMd, { contentType: "markdown", emitUpdate: false });
    }
    state.mode = mode;
    surface.dataset.mode = mode;
    toolbar.setMode(mode);
    writePref(MODE_KEY, mode);
    focusBody();
    syncToolbar();
  };

  const setWrap = () => {
    state.wrap = !state.wrap;
    surface.dataset.wrap = String(state.wrap);
    code?.setWrap(state.wrap);
    toolbar.setWrap(state.wrap);
    writePref(WRAP_KEY, state.wrap ? "on" : "off");
  };

  const downloadMarkdown = () => {
    const blob = new Blob([currentMarkdown()], { type: "text/markdown;charset=utf-8" });
    const link = h("a", { href: URL.createObjectURL(blob), download: `${post.slug || "post"}.md` });
    document.body.append(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);
  };

  const importMarkdown = () => {
    const input = h("input", { type: "file", accept: ".md,.markdown,text/markdown,text/plain", hidden: "" });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      const text = await file.text();
      if (state.mode === "editor") {
        rich.commands.setContent(text, { contentType: "markdown" });
      } else {
        applyTextCommand(code.view, () => ({ text, from: 0, to: 0 }));
      }
      toast({ message: `Replaced the body with ${file.name}. Undo with ${navigator.platform.includes("Mac") ? "⌘Z" : "Ctrl+Z"}.` });
    });
    document.body.append(input);
    input.click();
  };

  const createPost = async () => {
    await saveNow().catch(() => {});
    const created = await api.post("/api/admin/posts", {});
    navigate(`/admin/posts/${created.id}`);
  };

  const fileMenu = menuButton("File", [
    ["New post", createPost],
    ["Import Markdown file…", importMarkdown],
    ["Download as .md", downloadMarkdown],
    ["Copy Markdown", () => navigator.clipboard.writeText(currentMarkdown()).then(() => toast({ message: "Markdown copied." }))],
    ["Preview", () => previewButton.click()],
    ["Back to posts", () => navigate("/admin")],
  ]);

  const toolbar = buildToolbar({ onTool: runTool, onBlock: setBlock, onMode: setMode, onWrap: setWrap, fileMenu });
  toolbar.setMode(state.mode);
  toolbar.setWrap(state.wrap);

  const shared = {
    "Mod-s": () => (saveNow(), true),
    "Mod-/": () => (setMode(state.mode === "editor" ? "code" : "editor"), true),
    "Mod-k": () => (editLink(), true),
  };

  rich = createRichEditor({
    element: richHost,
    markdown: state.bodyMd,
    keys: { ...shared, "Mod-Shift-9": () => richCommands.task() },
    onChange: () => {
      state.richDirty = true;
      bodyChanged();
      syncToolbar();
    },
    onSelection: () => syncToolbar(),
    onFiles: insertImages,
  });

  const codeKeys = [
    ...Object.entries({ ...shared, "Mod-b": () => codeCommands.bold(), "Mod-i": () => codeCommands.italic(), "Mod-e": () => codeCommands.code(), "Mod-Shift-s": () => codeCommands.strike(), "Mod-Shift-h": () => codeCommands.highlight() }).map(([key, run]) => ({
      key,
      run: () => {
        run();
        return true;
      },
      preventDefault: true,
    })),
  ];

  code = createCodeEditor({
    parent: codeHost,
    doc: state.bodyMd,
    wrap: state.wrap,
    keys: codeKeys,
    onChange: (text) => {
      state.bodyMd = text;
      bodyChanged();
    },
    onCursor: () => syncToolbar(),
    onFiles: (files) => insertImages(files),
  });

  tableBar.append(
    ...[
      ["Row above", () => rich.chain().focus().addRowBefore().run()],
      ["Row below", () => rich.chain().focus().addRowAfter().run()],
      ["Column left", () => rich.chain().focus().addColumnBefore().run()],
      ["Column right", () => rich.chain().focus().addColumnAfter().run()],
      ["Delete row", () => rich.chain().focus().deleteRow().run()],
      ["Delete column", () => rich.chain().focus().deleteColumn().run()],
      ["Delete table", () => rich.chain().focus().deleteTable().run()],
    ].map(([label, run]) => h("button", { class: "btn-quiet", type: "button", onmousedown: (event) => event.preventDefault(), onclick: run }, label)),
  );

  const focusBody = () => (state.mode === "editor" ? rich.view.focus() : code.view.focus());

  const fields = h(
    "aside",
    { class: "fields", "aria-label": "Post settings" },
    h("section", { class: "fields__section" }, h("h2", { class: "fields__title" }, "Status"), statusBox),
    h(
      "section",
      { class: "fields__section" },
      h("h2", { class: "fields__title" }, "Details"),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Slug"), slug, slugHint, slugError),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Excerpt"), excerpt, excerptCount),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Tags"), tags, h("span", { class: "field__hint" }, "Comma separated, lowercase with hyphens.")),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Published date"), publishedAt, h("span", { class: "field__hint" }, "Set on first publish when left empty.")),
    ),
    h("section", { class: "fields__section" }, h("h2", { class: "fields__title" }, "Cover"), coverBox),
  );

  clear(main).append(h("div", { class: "edit" }, h("section", { class: "doc" }, title, toolbar.root, tableBar, surface, statusbar), fields));
  fitTitle();
  renderSlugHint();
  renderExcerptCount();
  renderCover();
  renderStatus();
  syncToolbar();
  document.title = `${post.title || "Untitled"} - xaverric/blog admin`;
  if (!post.title) title.focus();

  const beforeUnload = (event) => {
    if (autosave.hasPending() || state.liveDirty || state.bodyPending) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  const onResize = () => fitTitle();
  window.addEventListener("resize", onResize);

  return () => {
    pushBody();
    if (!isPublished()) autosave.flush();
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("resize", onResize);
    rich?.destroy();
    code?.destroy();
    setDiagramRenderer(null);
  };
};
