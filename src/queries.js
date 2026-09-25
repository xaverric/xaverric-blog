const qualify = (names) => names.split(", ").map((name) => `posts.${name}`).join(", ");
const LIST_NAMES = "id, slug, title, excerpt, tags, status, published_at, updated_at, reading_minutes, cover_key";
const POST_NAMES = `${LIST_NAMES}, body_md, body_html, html_version, toc_json, has_mermaid, created_at, deleted_at`;
const COVER = "m.content_type AS cover_type, m.width AS cover_width, m.height AS cover_height";
const LIST_COLUMNS = `${qualify(LIST_NAMES)}, ${COVER}`;
const POST_COLUMNS = `${qualify(POST_NAMES)}, ${COVER}`;
const FROM = "FROM posts LEFT JOIN media m ON m.key = posts.cover_key";
const RETURNING = POST_NAMES;
const PUBLIC_WHERE = "posts.status = 'published' AND posts.deleted_at IS NULL";
const PUBLIC_ORDER = "ORDER BY posts.published_at DESC, posts.id DESC";
const HAS_TAG = "EXISTS (SELECT 1 FROM json_each(posts.tags) WHERE json_each.value = ?1)";
const PURGE_AFTER_MS = 7 * 86400000;

export const publicPosts = async (db, { limit, offset, tag }) => {
  const where = tag ? `${PUBLIC_WHERE} AND ${HAS_TAG}` : PUBLIC_WHERE;
  const binds = tag ? [tag] : [];
  const n = binds.length;
  const [rows, count] = await db.batch([
    db.prepare(`SELECT ${LIST_COLUMNS} ${FROM} WHERE ${where} ${PUBLIC_ORDER} LIMIT ?${n + 1} OFFSET ?${n + 2}`).bind(...binds, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM posts WHERE ${where}`).bind(...binds),
  ]);
  return { posts: rows.results, total: count.results[0].total };
};

export const feedPosts = async (db, limit) =>
  (await db.prepare(`SELECT ${POST_COLUMNS} ${FROM} WHERE ${PUBLIC_WHERE} ${PUBLIC_ORDER} LIMIT ?1`).bind(limit).all()).results;

export const sitemapRows = async (db) => (await db.prepare(`SELECT posts.slug, posts.tags, posts.updated_at, posts.published_at FROM posts WHERE ${PUBLIC_WHERE} ${PUBLIC_ORDER}`).all()).results;

export const publicPostBySlug = (db, slug) => db.prepare(`SELECT ${POST_COLUMNS} ${FROM} WHERE posts.slug = ?1 AND ${PUBLIC_WHERE}`).bind(slug).first();

export const postById = (db, id) => db.prepare(`SELECT ${POST_COLUMNS} ${FROM} WHERE posts.id = ?1 AND posts.deleted_at IS NULL`).bind(id).first();

export const adminPosts = async (db, { q, status }) => {
  const clauses = ["posts.deleted_at IS NULL"];
  const binds = [];
  if (status) {
    binds.push(status);
    clauses.push(`posts.status = ?${binds.length}`);
  }
  if (q) {
    binds.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    clauses.push(`(posts.title LIKE ?${binds.length} ESCAPE '\\' OR posts.slug LIKE ?${binds.length} ESCAPE '\\' OR posts.excerpt LIKE ?${binds.length} ESCAPE '\\')`);
  }
  return (await db.prepare(`SELECT ${LIST_COLUMNS} ${FROM} WHERE ${clauses.join(" AND ")} ORDER BY posts.updated_at DESC, posts.id DESC`).bind(...binds).all()).results;
};

export const slugTaken = async (db, slug, exceptId = 0) => Boolean(await db.prepare("SELECT 1 FROM posts WHERE slug = ?1 AND id != ?2").bind(slug, exceptId).first());

export const insertPost = (db, { slug, title, nowIso }) =>
  db
    .prepare(`INSERT INTO posts (slug, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ON CONFLICT (slug) DO NOTHING RETURNING ${RETURNING}`)
    .bind(slug, title, nowIso)
    .first();

const COLUMN_FOR = {
  title: "title",
  slug: "slug",
  excerpt: "excerpt",
  bodyMd: "body_md",
  coverKey: "cover_key",
  tags: "tags",
  publishedAt: "published_at",
  status: "status",
  bodyHtml: "body_html",
  htmlVersion: "html_version",
  toc: "toc_json",
  readingMinutes: "reading_minutes",
  hasMermaid: "has_mermaid",
};

const encode = (name, value) => {
  if (name === "tags" || name === "toc") return JSON.stringify(value);
  if (name === "hasMermaid") return value ? 1 : 0;
  return value;
};

export const updatePost = (db, id, fields, nowIso) => {
  const entries = Object.entries(fields).filter(([name]) => COLUMN_FOR[name]);
  const sets = entries.map(([name], i) => `${COLUMN_FOR[name]} = ?${i + 3}`);
  return db
    .prepare(`UPDATE posts SET ${[...sets, "updated_at = ?2"].join(", ")} WHERE id = ?1 AND deleted_at IS NULL RETURNING ${RETURNING}`)
    .bind(id, nowIso, ...entries.map(([name, value]) => encode(name, value)))
    .first();
};

export const storeRendered = (db, id, rendered) =>
  db
    .prepare("UPDATE posts SET body_html = ?2, html_version = ?3, toc_json = ?4, reading_minutes = ?5, has_mermaid = ?6 WHERE id = ?1")
    .bind(id, rendered.html, rendered.version, JSON.stringify(rendered.toc), rendered.readingMinutes, rendered.hasMermaid ? 1 : 0)
    .run();

export const softDeletePost = async (db, id, now) => {
  const [, result] = await db.batch([
    db.prepare("DELETE FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < ?1").bind(new Date(now.getTime() - PURGE_AFTER_MS).toISOString()),
    db.prepare("UPDATE posts SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL").bind(id, now.toISOString()),
  ]);
  return result.meta.changes > 0;
};

export const restorePost = (db, id) => db.prepare(`UPDATE posts SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL RETURNING ${RETURNING}`).bind(id).first();

export const mediaDimensions = async (db, keys) => {
  if (!keys.length) return new Map();
  const unique = [...new Set(keys)].slice(0, 100);
  const rows = (await db.prepare(`SELECT key, width, height FROM media WHERE key IN (${unique.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...unique).all()).results;
  return new Map(rows.map((row) => [row.key, { width: row.width, height: row.height }]));
};

export const insertMedia = (db, { key, contentType, size, width, height, bytes, nowIso }) =>
  db
    .prepare(
      `INSERT INTO media (key, content_type, size, width, height, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (key) DO UPDATE SET key = excluded.key RETURNING key, content_type, size, width, height, created_at`,
    )
    .bind(key, contentType, size, width, height, bytes, nowIso)
    .first();

export const mediaUsage = async (db, key) =>
  (
    await db
      .prepare("SELECT id, slug, title FROM posts WHERE deleted_at IS NULL AND (cover_key = ?1 OR instr(body_md, ?2) > 0) ORDER BY updated_at DESC")
      .bind(key, `/media/${key}.`)
      .all()
  ).results;

export const listMedia = async (db) =>
  (
    await db
      .prepare(
        `SELECT m.key, m.content_type, m.size, m.width, m.height, m.created_at,
           (SELECT COUNT(*) FROM posts p WHERE p.deleted_at IS NULL AND (p.cover_key = m.key OR instr(p.body_md, '/media/' || m.key || '.') > 0)) AS uses
         FROM media m ORDER BY m.created_at DESC, m.key LIMIT 500`,
      )
      .all()
  ).results;

export const mediaFile = (db, key) => db.prepare("SELECT key, content_type, size, data FROM media WHERE key = ?1").bind(key).first();

export const deleteMedia = async (db, key) => (await db.prepare("DELETE FROM media WHERE key = ?1").bind(key).run()).meta.changes > 0;

export const upsertUser = (db, { githubId, login, name, avatarUrl }, nowIso) =>
  db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url
       RETURNING id`,
    )
    .bind(githubId, login, name, avatarUrl, nowIso)
    .first();

export const upsertDevUser = async (db, login, nowIso) =>
  (await db.prepare("SELECT id FROM users WHERE login = ?1 AND github_id < 0").bind(login).first()) ??
  db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at)
       VALUES ((SELECT MIN(0, COALESCE(MIN(github_id), 0)) - 1 FROM users), ?1, ?1, NULL, ?2) RETURNING id`,
    )
    .bind(login, nowIso)
    .first();
