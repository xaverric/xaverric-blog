import { MAX_SLUG_LENGTH, isSlugText, slugify } from "../shared/text.js";
import { badRequest } from "./http.js";
import { MEDIA_KEY, mediaPath } from "./media.js";

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 400;
export const MAX_BODY = 500000;
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 32;
export const PAGE_SIZE = 10;

const RESERVED = new Set([
  "admin", "api", "auth", "media", "img", "tags", "page", "css", "js", "fonts", "build", "feed", "rss", "atom",
  "rss-xml", "atom-xml", "feed-json", "sitemap", "sitemap-xml", "robots-txt", "favicon", "og-default", "about", "search",
]);

const ISO_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_ZONE = /(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = new Set(["title", "slug", "excerpt", "tags", "coverKey", "bodyMd", "publishedAt"]);

export const isReservedSlug = (slug) => RESERVED.has(slug);

export const validateSlug = (value) => {
  if (!isSlugText(value)) {
    return `slug: use lowercase letters, digits and single hyphens, at most ${MAX_SLUG_LENGTH} characters`;
  }
  if (isReservedSlug(value)) return "slug: reserved, pick another";
  return null;
};

export const isPublicSlug = (value) => isSlugText(value) && !isReservedSlug(value);

export const normalizeTag = (value) => slugify(value, MAX_TAG_LENGTH);

export const parseTags = (value) => {
  if (!Array.isArray(value)) throw badRequest("tags: must be an array of strings");
  if (value.some((tag) => typeof tag !== "string")) throw badRequest("tags: must be an array of strings");
  const tags = [...new Set(value.map(normalizeTag).filter(Boolean))];
  if (tags.length > MAX_TAGS) throw badRequest(`tags: at most ${MAX_TAGS}`);
  return tags;
};

export const readTags = (text) => {
  try {
    const tags = JSON.parse(text ?? "[]");
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
};

const stringField = (body, name, max) => {
  if (body[name] === undefined) return undefined;
  if (typeof body[name] !== "string") throw badRequest(`${name}: must be a string`);
  if (body[name].length > max) throw badRequest(`${name}: at most ${max} characters`);
  return name === "bodyMd" ? body[name] : body[name].trim();
};

export const parseDate = (value, name = "publishedAt") => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 40 || !ISO_START.test(value) || !ISO_ZONE.test(value)) throw badRequest(`${name}: must be an ISO 8601 timestamp with a time zone`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`${name}: invalid date`);
  return date.toISOString();
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export const parsePostInput = (body) => {
  if (!isObject(body)) throw badRequest("body: must be a JSON object");
  const unknown = Object.keys(body).find((key) => !FIELDS.has(key));
  if (unknown) throw badRequest(`${unknown}: unknown field`);
  const input = {
    title: stringField(body, "title", MAX_TITLE),
    excerpt: stringField(body, "excerpt", MAX_EXCERPT),
    bodyMd: stringField(body, "bodyMd", MAX_BODY),
  };
  if (body.slug !== undefined) {
    const error = validateSlug(body.slug);
    if (error) throw badRequest(error);
    input.slug = body.slug;
  }
  if (body.tags !== undefined) input.tags = parseTags(body.tags);
  if (body.coverKey !== undefined) {
    if (body.coverKey !== null && (typeof body.coverKey !== "string" || !MEDIA_KEY.test(body.coverKey))) throw badRequest("coverKey: must be a media key or null");
    input.coverKey = body.coverKey;
  }
  if (body.publishedAt !== undefined) input.publishedAt = parseDate(body.publishedAt);
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
};

export const baseSlug = (title) => {
  const slug = slugify(title) || "untitled";
  return isReservedSlug(slug) ? `${slug}-post` : slug;
};

export const toAdminPost = (row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt,
  bodyMd: row.body_md,
  coverKey: row.cover_key,
  coverUrl: row.cover_key && row.cover_type ? mediaPath(row.cover_key, row.cover_type) : null,
  tags: readTags(row.tags),
  status: row.status,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  readingMinutes: row.reading_minutes,
});

export const toListItem = (row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt,
  tags: readTags(row.tags),
  status: row.status,
  publishedAt: row.published_at,
  updatedAt: row.updated_at,
  readingMinutes: row.reading_minutes,
});
