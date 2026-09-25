import { keyFingerprint, signImageUrl } from "../proxy.js";
import { mediaDimensions } from "../queries.js";
import { RENDERER_VERSION, referencedMediaKeys, renderMarkdown } from "./markdown.js";

export const htmlVersion = async (env) => `${RENDERER_VERSION}.${await keyFingerprint(env)}`;

export const renderBody = async (env, markdown) => {
  const media = await mediaDimensions(env.DB, referencedMediaKeys(markdown));
  const rendered = await renderMarkdown(markdown, {
    media,
    eagerFirstImage: true,
    resolveImage: async (href) => (await signImageUrl(env, href)) ?? "",
  });
  return { ...rendered, version: await htmlVersion(env) };
};
