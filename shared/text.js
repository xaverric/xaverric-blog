export const MAX_SLUG_LENGTH = 80;
export const WORDS_PER_MINUTE = 220;

export const slugify = (text, max = MAX_SLUG_LENGTH) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");

export const isSlugText = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_SLUG_LENGTH && /^[a-z0-9-]+$/.test(value) && !value.startsWith("-") && !value.endsWith("-") && !value.includes("--");

export const countWords = (text) => (String(text ?? "").replace(/(?<=[\p{L}\p{N}])['’-](?=[\p{L}\p{N}])/gu, "").match(/[\p{L}\p{N}]+/gu) ?? []).length;

export const readingMinutes = (text) => Math.max(1, Math.round(countWords(text) / WORDS_PER_MINUTE));

export const truncate = (text, max) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
};
