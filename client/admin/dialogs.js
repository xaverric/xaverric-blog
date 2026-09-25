import { ApiError, api } from "./api.js";
import { clear, h } from "./dom.js";
import { formatBytes, plural } from "./format.js";
import { icon } from "./icons.js";
import { altFromName, prepareImage } from "./image.js";

const dialogShell = (title, className = "") => {
  const body = h("div", { class: "dialog__body" });
  const foot = h("div", { class: "dialog__foot" });
  const closeButton = h("button", { class: "tool", type: "button", "aria-label": "Close" }, icon("close"));
  const dialog = h("dialog", { class: `dialog ${className}`.trim(), "aria-label": title }, h("header", { class: "dialog__head" }, h("h2", { class: "dialog__title" }, title), closeButton), body, foot);
  closeButton.addEventListener("click", () => dialog.close("cancel"));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close("cancel");
  });
  dialog.addEventListener("close", () => setTimeout(() => dialog.remove(), 0));
  document.body.append(dialog);
  return { dialog, body, foot };
};

const field = (label, input, hint) => h("label", { class: "field" }, h("span", { class: "field__label" }, label), input, hint ? h("span", { class: "field__hint" }, hint) : null);

export const linkDialog = ({ href = "", text = "", showText = false }) =>
  new Promise((resolve) => {
    const { dialog, body, foot } = dialogShell("Link", "dialog--small");
    const url = h("input", { class: "field__input", type: "url", value: href, placeholder: "https://", required: "", autocomplete: "off" });
    const label = h("input", { class: "field__input", type: "text", value: text, placeholder: "Link text" });
    const form = h("form", { class: "dialog__form", method: "dialog" }, field("Address", url, "Use https://, a /path on this blog or #section."), showText ? field("Text", label) : null);
    body.append(form);
    const remove = h("button", { class: "btn-quiet btn-quiet--danger", type: "button", onclick: () => dialog.close("remove") }, "Remove link");
    const save = h("button", { class: "btn", type: "submit" }, href ? "Update link" : "Insert link");
    form.append(h("div", { class: "dialog__actions" }, href ? remove : null, save));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      dialog.close("save");
    });
    foot.remove();
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === "save" && url.value.trim()) resolve({ href: url.value.trim(), text: label.value.trim() });
      else if (dialog.returnValue === "remove") resolve({ href: "" });
      else resolve(null);
    });
    dialog.showModal();
    url.focus();
  });

export const confirmDialog = ({ title, message, confirm, danger = false, details = [] }) =>
  new Promise((resolve) => {
    const { dialog, body, foot } = dialogShell(title, "dialog--small");
    body.append(h("p", { class: "dialog__text" }, message), details.length ? h("ul", { class: "dialog__list" }, details.map((item) => h("li", {}, item))) : null);
    const cancel = h("button", { class: "btn-quiet", type: "button", onclick: () => dialog.close("cancel") }, "Cancel");
    const ok = h("button", { class: danger ? "btn btn--danger" : "btn", type: "button", onclick: () => dialog.close("ok") }, confirm);
    foot.append(cancel, ok);
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"));
    dialog.showModal();
    cancel.focus();
  });

export const uploadFiles = async (files, { onProgress = () => {} } = {}) => {
  const uploaded = [];
  for (const [index, file] of files.entries()) {
    onProgress(`Uploading ${files.length > 1 ? `${index + 1} of ${files.length}` : "image"}…`);
    const blob = await prepareImage(file);
    const media = await api.upload("/api/admin/media", blob);
    uploaded.push({ ...media, alt: altFromName(file.name) });
  }
  onProgress("");
  return uploaded;
};

export const mediaDialog = ({ purpose = "insert", toast }) =>
  new Promise((resolve) => {
    const { dialog, body, foot } = dialogShell(purpose === "cover" ? "Cover image" : "Insert image", "dialog--wide");
    const state = { media: [], selected: null, busy: false };
    const grid = h("ul", { class: "media-grid", "aria-label": "Uploaded images" });
    const status = h("p", { class: "media-status", role: "status" });
    const fileInput = h("input", { type: "file", accept: "image/webp,image/jpeg,image/png,image/gif", multiple: "", hidden: "" });
    const alt = h("input", { class: "field__input", type: "text", placeholder: "Describe the image for screen readers" });
    const caption = h("input", { class: "field__input", type: "text", placeholder: "Shown under the image" });
    const url = h("input", { class: "field__input", type: "url", placeholder: "https://example.com/image.png" });
    const drop = h(
      "div",
      { class: "dropzone", tabindex: "0", role: "button", "aria-label": "Upload images" },
      icon("upload"),
      h("span", {}, "Drop images here or ", h("strong", {}, "choose files")),
      h("span", { class: "dropzone__hint" }, "Resized to 1600 px, WebP, at most 1.5 MB. GIFs keep their animation."),
    );

    const pick = (item) => {
      state.selected = item;
      url.value = "";
      if (item && !alt.value) alt.value = item.alt ?? "";
      render();
    };

    const removeItem = async (item) => {
      try {
        await api.del(`/api/admin/media/${item.key}`);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "in_use")) {
          toast({ tone: "error", message: `Could not delete the image. ${error.message}` });
          return;
        }
        const posts = error.detail?.posts ?? [];
        const ok = await confirmDialog({
          title: "Image in use",
          message: `This image appears in ${plural(posts.length, "post")}. Deleting it leaves a broken image there.`,
          details: posts.map((post) => post.title || `/${post.slug}`),
          confirm: "Delete anyway",
          danger: true,
        });
        if (!ok) return;
        await api.del(`/api/admin/media/${item.key}?force=1`);
      }
      state.media = state.media.filter((media) => media.key !== item.key);
      if (state.selected?.key === item.key) state.selected = null;
      render();
    };

    const render = () => {
      clear(grid).append(
        ...(state.media.length
          ? state.media.map((item) =>
              h(
                "li",
                { class: "media-item", "aria-selected": String(state.selected?.key === item.key) },
                h("button", { class: "media-item__pick", type: "button", onclick: () => pick(item), "aria-label": `Select image ${item.width} by ${item.height}` }, h("img", { src: item.url, alt: "", loading: "lazy", width: item.width, height: item.height })),
                h(
                  "div",
                  { class: "media-item__meta" },
                  h("span", {}, `${item.width}×${item.height} · ${formatBytes(item.size)}`),
                  item.uses !== undefined ? h("span", {}, item.uses ? `Used ${item.uses}×` : "Unused") : null,
                  h("button", { class: "media-item__delete", type: "button", "aria-label": "Delete image", title: "Delete image", onclick: () => removeItem(item) }, icon("trash")),
                ),
              ),
            )
          : [h("li", { class: "media-empty" }, "No images uploaded yet.")]),
      );
      insert.disabled = !(state.selected || url.value.trim());
    };

    const upload = async (files) => {
      if (!files.length || state.busy) return;
      state.busy = true;
      try {
        const uploaded = await uploadFiles(files, { onProgress: (text) => (status.textContent = text) });
        uploaded.forEach((item) => {
          state.media = [{ ...item, uses: 0 }, ...state.media.filter((media) => media.key !== item.key)];
        });
        pick(uploaded.at(-1));
      } catch (error) {
        status.textContent = "";
        toast({ tone: "error", message: `Upload failed. ${error.message}` });
      } finally {
        state.busy = false;
      }
    };

    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.dataset.over = "true";
    });
    drop.addEventListener("dragleave", () => delete drop.dataset.over);
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      delete drop.dataset.over;
      upload([...event.dataTransfer.files].filter((file) => file.type.startsWith("image/")));
    });
    fileInput.addEventListener("change", () => upload([...fileInput.files]));
    url.addEventListener("input", () => {
      if (url.value.trim()) state.selected = null;
      render();
    });

    const insert = h("button", { class: "btn", type: "button", disabled: "", onclick: () => dialog.close("insert") }, purpose === "cover" ? "Use as cover" : "Insert image");
    const cancel = h("button", { class: "btn-quiet", type: "button", onclick: () => dialog.close("cancel") }, "Cancel");
    body.append(
      h(
        "div",
        { class: "media-layout" },
        h("div", { class: "media-layout__side" }, drop, fileInput, status, purpose === "insert" ? [field("Alt text", alt), field("Caption", caption, "Optional, stored as the image title."), field("Or an external image", url, "Served through the image proxy, readers never contact that host.")] : null),
        h("div", { class: "media-layout__grid" }, grid),
      ),
    );
    foot.append(cancel, insert);
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "insert") return resolve(null);
      const src = state.selected?.url ?? url.value.trim();
      resolve({ src, key: state.selected?.key ?? null, alt: alt.value.trim(), title: caption.value.trim() || null, media: state.selected });
    });
    dialog.showModal();
    render();
    api
      .get("/api/admin/media")
      .then(({ media }) => {
        state.media = media;
        render();
      })
      .catch((error) => toast({ tone: "error", message: `Could not load the images. ${error.message}` }));
  });

export const previewDialog = async ({ title, excerpt, bodyMd, toast }) => {
  const { dialog, body, foot } = dialogShell("Preview", "dialog--preview");
  foot.remove();
  const article = h("article", { class: "preview-article" }, h("p", { class: "preview-note" }, "Rendering with the public renderer…"));
  body.append(article);
  dialog.showModal();
  try {
    const rendered = await api.post("/api/admin/preview", { bodyMd });
    const prose = h("div", { class: "prose" });
    prose.innerHTML = rendered.html;
    clear(article).append(
      h("p", { class: "preview-meta" }, `${rendered.readingMinutes} min read${rendered.toc.length ? ` · ${plural(rendered.toc.length, "section")} in the contents` : ""}`),
      h("h1", { class: "preview-title" }, title || "Untitled"),
      excerpt ? h("p", { class: "preview-lede" }, excerpt) : null,
      prose,
    );
    const { attachCopyButton } = await import("../copy.js");
    prose.querySelectorAll("figure.code").forEach((figure) => attachCopyButton(figure));
    const diagrams = [...prose.querySelectorAll("[data-mermaid]")];
    if (diagrams.length) (await import("../mermaid.js")).renderAll(diagrams);
  } catch (error) {
    clear(article).append(h("p", { class: "preview-note" }, `Preview failed. ${error.message}`));
    toast({ tone: "error", message: `Preview failed. ${error.message}` });
  }
};
