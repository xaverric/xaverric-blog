import { api, postPath } from "./api.js";
import { clear, h } from "./dom.js";
import { formatDate, plural, relativeTime } from "./format.js";
import { icon } from "./icons.js";

const FILTERS = [
  ["", "All"],
  ["draft", "Drafts"],
  ["published", "Published"],
];

export const filterPosts = (posts, { query, status }) => {
  const q = query.trim().toLowerCase();
  return posts.filter((post) => (!status || post.status === status) && (!q || [post.title, post.slug, post.excerpt, ...post.tags].some((value) => value.toLowerCase().includes(q))));
};

export const mountList = async ({ main, navigate, toast }) => {
  const state = { posts: [], query: "", status: "" };
  const { posts } = await api.get("/api/admin/posts");
  state.posts = posts;

  const rows = h("ol", { class: "posts" });
  const count = h("p", { class: "posts-count", "aria-live": "polite" });

  const create = async (button) => {
    button.disabled = true;
    try {
      const post = await api.post("/api/admin/posts", {});
      navigate(`/admin/posts/${post.id}`);
    } catch (error) {
      button.disabled = false;
      toast({ tone: "error", message: `Could not create a post. ${error.message}` });
    }
  };

  const replace = (post) => {
    state.posts = state.posts.map((item) => (item.id === post.id ? { ...item, ...post } : item));
    render();
  };

  const toggle = async (post) => {
    try {
      replace(await api.post(postPath(post.id, post.status === "published" ? "unpublish" : "publish")));
    } catch (error) {
      toast({ tone: "error", message: `Could not change the status. ${error.message}` });
    }
  };

  const remove = async (post) => {
    const index = state.posts.findIndex((item) => item.id === post.id);
    state.posts = state.posts.filter((item) => item.id !== post.id);
    render();
    try {
      await api.del(postPath(post.id));
      toast({
        message: `Deleted "${post.title || "Untitled"}".`,
        timeout: 10000,
        action: {
          label: "Undo",
          run: async () => {
            try {
              const restored = await api.post(postPath(post.id, "restore"));
              state.posts.splice(Math.min(index, state.posts.length), 0, { ...post, ...restored });
              render();
            } catch (error) {
              toast({ tone: "error", message: `Could not restore the post. ${error.message}` });
            }
          },
        },
      });
    } catch (error) {
      state.posts.splice(index, 0, post);
      render();
      toast({ tone: "error", message: `Could not delete the post. ${error.message}` });
    }
  };

  const row = (post) =>
    h(
      "li",
      { class: "post-row", "data-status": post.status },
      h(
        "div",
        { class: "post-row__main" },
        h("a", { class: "post-row__title", href: `/admin/posts/${post.id}`, "data-nav": "" }, post.title || "Untitled"),
        h(
          "p",
          { class: "post-row__meta" },
          h("span", { class: `status status--${post.status}` }, post.status === "published" ? "Published" : "Draft"),
          h("span", {}, `/${post.slug}`),
          h("span", { title: new Date(post.updatedAt).toLocaleString() }, `Edited ${relativeTime(post.updatedAt)}`),
          post.publishedAt ? h("span", {}, formatDate(post.publishedAt)) : null,
        ),
      ),
      h(
        "div",
        { class: "post-row__actions" },
        post.status === "published" ? h("a", { class: "btn-quiet", href: `/${post.slug}`, target: "_blank", rel: "noopener" }, "View") : null,
        h("button", { class: "btn-quiet", type: "button", onclick: () => toggle(post) }, post.status === "published" ? "Unpublish" : "Publish"),
        h("button", { class: "btn-quiet btn-quiet--danger", type: "button", onclick: () => remove(post), "aria-label": `Delete ${post.title || "Untitled"}` }, icon("trash"), "Delete"),
      ),
    );

  const render = () => {
    const visible = filterPosts(state.posts, state);
    clear(rows).append(
      ...(visible.length
        ? visible.map(row)
        : [
            h(
              "li",
              { class: "posts-empty" },
              state.posts.length
                ? h("p", {}, "No posts match this filter.")
                : [h("p", { class: "posts-empty__title" }, "No posts yet."), h("p", {}, "Start the first one; it stays a draft until you publish it.")],
            ),
          ]),
    );
    const drafts = state.posts.filter((post) => post.status === "draft").length;
    count.textContent = `${plural(state.posts.length, "post")}, ${plural(drafts, "draft")}`;
    filters.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.status === state.status)));
  };

  const search = h("input", {
    class: "field__input",
    type: "search",
    placeholder: "Search titles, slugs, tags",
    "aria-label": "Search posts",
    oninput: (event) => {
      state.query = event.target.value;
      render();
    },
  });

  const filters = h(
    "div",
    { class: "segmented", role: "group", "aria-label": "Filter by status" },
    FILTERS.map(([status, label]) =>
      h("button", { type: "button", "data-status": status, "aria-pressed": "false", onclick: () => ((state.status = status), render()) }, label),
    ),
  );

  const newButton = h("button", { class: "btn", type: "button", onclick: (event) => create(event.currentTarget) }, icon("plus"), "New post");

  clear(main).append(
    h(
      "section",
      { class: "list" },
      h("header", { class: "list__head" }, h("h1", { class: "list__title" }, "Posts"), newButton),
      h("div", { class: "list__tools" }, search, filters, count),
      rows,
    ),
  );
  render();
  document.title = "Posts - xaverric/blog admin";
  return () => {};
};
