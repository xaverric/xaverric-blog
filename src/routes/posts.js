import { isAdmin } from "../access.js";
import { requireAdmin, sessionUser } from "../auth.js";
import { HttpError, badRequest, json, noContent, notFoundError, redirect } from "../http.js";
import { messagePage } from "../pages/layout.js";
import { baseSlug, parseDate, parsePostInput, toAdminPost, toListItem } from "../posts.js";
import { adminPosts, insertPost, postById, restorePost, slugTaken, softDeletePost, storeRendered, updatePost } from "../queries.js";
import { renderBody } from "../render/post.js";
import { dropCachedPages } from "../cache.js";

const MAX_SLUG_ATTEMPTS = 50;
const STATUSES = new Set(["draft", "published"]);
const ID = /^[1-9][0-9]{0,15}$/;

const postId = (params) => {
  if (!ID.test(params.id ?? "")) throw notFoundError("Post not found");
  return Number(params.id);
};

const loadPost = async (env, id) => {
  const row = await postById(env.DB, id);
  if (!row) throw notFoundError("Post not found");
  return row;
};

export const adminPage = async ({ request, env, url, now }) => {
  const user = await sessionUser(request, env, now);
  if (!user) return redirect(`/auth/github?next=${encodeURIComponent(url.pathname)}`);
  if (!isAdmin(user.github_id, env)) return messagePage(env, 403, "Not allowed", "This account cannot write on blog.xaverric.cz.");
  const asset = await env.ASSETS.fetch(new Request(new URL("/admin.html", url), request));
  const response = new Response(asset.body, asset);
  response.headers.set("cache-control", "no-store");
  return response;
};

export const getMe = async (context) => {
  const user = await requireAdmin(context);
  return json({ login: user.login, name: user.name });
};

export const listPosts = async (context) => {
  await requireAdmin(context);
  const q = (context.url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = context.url.searchParams.get("status") || null;
  if (status && !STATUSES.has(status)) throw badRequest("status: use draft or published");
  const rows = await adminPosts(context.env.DB, { q, status });
  return json({ posts: rows.map(toListItem) });
};

const freeSlug = async (db, base, exceptId = 0) => {
  for (let n = 1; n <= MAX_SLUG_ATTEMPTS; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 76)}-${n}`;
    if (!(await slugTaken(db, slug, exceptId))) return slug;
  }
  throw new HttpError(409, "conflict", "slug: could not find a free slug, set one by hand");
};

const fresh = async (env, id, status = 200) => json(toAdminPost(await loadPost(env, id)), { status });

const rerender = async (env, row) => {
  const rendered = await renderBody(env, row.body_md);
  await storeRendered(env.DB, row.id, rendered);
  return row;
};

export const createPost = async (context) => {
  await requireAdmin(context);
  const { env, now, body } = context;
  const input = parsePostInput(body ?? {});
  const title = input.title ?? "";
  const slug = input.slug ?? (await freeSlug(env.DB, baseSlug(title)));
  if (input.slug && (await slugTaken(env.DB, input.slug))) throw new HttpError(409, "conflict", "slug: already taken");
  const created = await insertPost(env.DB, { slug, title, nowIso: now.toISOString() });
  if (!created) throw new HttpError(409, "conflict", "slug: already taken");
  const rest = Object.fromEntries(Object.entries(input).filter(([name]) => !["title", "slug"].includes(name)));
  const row = Object.keys(rest).length ? await updatePost(env.DB, created.id, rest, now.toISOString()) : created;
  await rerender(env, row);
  return fresh(env, created.id, 201);
};

export const getPost = async (context) => {
  await requireAdmin(context);
  return json(toAdminPost(await loadPost(context.env, postId(context.params))));
};

const dropPublicCopies = (context, rows) => context.ctx?.waitUntil?.(dropCachedPages(context.env, rows).catch(() => {}));

export const patchPost = async (context) => {
  await requireAdmin(context);
  const { env, now, params, body } = context;
  const id = postId(params);
  const before = await loadPost(env, id);
  const input = parsePostInput(body);
  if (Object.keys(input).length === 0) throw badRequest("body: nothing to change");
  if (input.slug && input.slug !== before.slug && (await slugTaken(env.DB, input.slug, id))) throw new HttpError(409, "conflict", "slug: already taken");
  const row = await updatePost(env.DB, id, input, now.toISOString()).catch((error) => {
    if (/UNIQUE/i.test(error?.message ?? "")) throw new HttpError(409, "conflict", "slug: already taken");
    throw error;
  });
  if (!row) throw notFoundError("Post not found");
  const updated = input.bodyMd === undefined ? row : await rerender(env, row);
  if (before.status === "published") dropPublicCopies(context, [before, updated]);
  return fresh(env, id);
};

export const publishPost = async (context) => {
  await requireAdmin(context);
  const { env, now, params, body } = context;
  const id = postId(params);
  const before = await loadPost(env, id);
  if (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body))) throw badRequest("body: must be a JSON object");
  const requested = body?.publishedAt === undefined ? undefined : parseDate(body.publishedAt);
  if (!before.title.trim()) throw badRequest("title: a post needs a title before it is published");
  const publishedAt = requested ?? before.published_at ?? now.toISOString();
  const row = await updatePost(env.DB, id, { status: "published", publishedAt }, now.toISOString());
  dropPublicCopies(context, [row]);
  return fresh(env, id);
};

export const unpublishPost = async (context) => {
  await requireAdmin(context);
  const { env, now, params } = context;
  const before = await loadPost(env, postId(params));
  await updatePost(env.DB, before.id, { status: "draft" }, now.toISOString());
  dropPublicCopies(context, [before]);
  return fresh(env, before.id);
};

export const deletePost = async (context) => {
  await requireAdmin(context);
  const { env, now, params } = context;
  const before = await loadPost(env, postId(params));
  if (!(await softDeletePost(env.DB, before.id, now))) throw notFoundError("Post not found");
  if (before.status === "published") dropPublicCopies(context, [before]);
  return noContent();
};

export const undeletePost = async (context) => {
  await requireAdmin(context);
  const row = await restorePost(context.env.DB, postId(context.params));
  if (!row) throw notFoundError("Nothing to restore");
  if (row.status === "published") dropPublicCopies(context, [row]);
  return fresh(context.env, row.id);
};

export const previewPost = async (context) => {
  await requireAdmin(context);
  const { body, env } = context;
  if (!body || typeof body.bodyMd !== "string") throw badRequest("bodyMd: must be a string");
  const input = parsePostInput({ bodyMd: body.bodyMd });
  const rendered = await renderBody(env, input.bodyMd);
  return json({ html: rendered.html, toc: rendered.toc, readingMinutes: rendered.readingMinutes, hasMermaid: rendered.hasMermaid });
};
