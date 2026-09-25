import { ApiError, api } from "./api.js";
import { clear, h } from "./dom.js";
import { toast } from "./toast.js";

const main = document.getElementById("main");
const slot = document.querySelector("[data-bar-slot]");

let teardown = () => {};

const gate = (title, message, ...actions) =>
  clear(main).append(h("section", { class: "gate" }, h("h1", { class: "gate__title" }, title), h("p", { class: "gate__text" }, message), h("div", { class: "gate__actions" }, ...actions)));

const signInHref = () => `/auth/github?next=${encodeURIComponent(location.pathname)}`;

const showMe = (me) => {
  const bar = document.querySelector("[data-me]");
  bar.querySelector("[data-me-login]").textContent = `@${me.login}`;
  bar.hidden = false;
};

export const navigate = (path, { replace = false } = {}) => {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  route();
};

const context = { main, slot, navigate, toast };

const route = async () => {
  teardown();
  teardown = () => {};
  clear(slot);
  const match = /^\/admin\/posts\/(\d+)$/.exec(location.pathname);
  try {
    if (match) {
      const { mountEditor } = await import("./edit.js");
      teardown = (await mountEditor({ ...context, id: Number(match[1]) })) ?? teardown;
    } else {
      const { mountList } = await import("./list.js");
      teardown = (await mountList(context)) ?? teardown;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      gate("Sign in to write", "Your session ended. Sign in with GitHub to continue.", h("a", { class: "btn", href: signInHref() }, "Sign in with GitHub"));
      return;
    }
    if (error instanceof ApiError && error.status === 404) {
      gate("Post not found", "It was deleted or never existed.", h("a", { class: "btn", href: "/admin", "data-nav": "" }, "Back to posts"));
      return;
    }
    gate("The admin could not load", error.message || "Unexpected error.", h("button", { class: "btn", type: "button", onclick: () => route() }, "Try again"));
  }
};

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-nav]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", () => route());

document.querySelector("[data-signout]").addEventListener("click", async () => {
  try {
    await api.post("/auth/logout");
  } finally {
    location.assign("/");
  }
});

const start = async () => {
  try {
    showMe(await api.get("/api/me"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      gate("Sign in to write", "Only the owner of blog.xaverric.cz can write here.", h("a", { class: "btn", href: signInHref() }, "Sign in with GitHub"));
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      gate("Not allowed", "This GitHub account cannot write on blog.xaverric.cz.", h("a", { class: "btn", href: "/" }, "Read the blog"));
      return;
    }
    gate("The admin could not load", error.message, h("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Try again"));
    return;
  }
  route();
};

start();
