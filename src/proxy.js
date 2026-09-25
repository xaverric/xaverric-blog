import { base64urlDecode, base64urlEncode, fromUtf8, utf8 } from "./encoding.js";
import { TYPES, sniffImage } from "./media.js";

export const PROXY_MAX_BYTES = 8 * 1024 * 1024;
export const PROXY_MAX_REDIRECTS = 3;
export const PROXY_TIMEOUT_MS = 10000;
export const MAX_PROXY_URL = 2048;
export const SIGNATURE_BYTES = 16;

const HKDF_SALT = "xaverric-blog";
const HKDF_INFO = "xaverric-blog/image-proxy/v1";
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".onion", ".test", ".invalid", ".example"];
const LOOP_DOMAIN = "xaverric.cz";
const LABEL = /^[a-z0-9-]{1,63}$/;

const isIpv4 = (host) => /^[\d.]+$/.test(host);

const isHostname = (host) => {
  const labels = host.split(".");
  return host.length <= 253 && labels.length >= 2 && labels.every((label) => LABEL.test(label) && !label.startsWith("-") && !label.endsWith("-"));
};
const PROXY_TYPES = new Set(["webp", "jpeg", "png", "gif", "avif"]);

const keys = new Map();

const proxySecret = (env) => env.IMAGE_PROXY_SECRET || env.SESSION_SECRET;

export const proxyKey = async (env) => {
  const secret = proxySecret(env);
  if (typeof secret !== "string" || secret.length < 32) throw new Error("image proxy secret missing");
  if (!keys.has(secret)) {
    const base = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"]);
    keys.set(
      secret,
      crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: utf8(HKDF_SALT), info: utf8(HKDF_INFO) },
        base,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"],
      ),
    );
  }
  return keys.get(secret);
};

const signBytes = async (env, text) => new Uint8Array(await crypto.subtle.sign("HMAC", await proxyKey(env), utf8(text))).slice(0, SIGNATURE_BYTES);

export const keyFingerprint = async (env) => base64urlEncode(await signBytes(env, "fingerprint")).slice(0, 8);

export const isPublicImageUrl = (value) => {
  if (typeof value !== "string" || value.length > MAX_PROXY_URL) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpv4(host) || host.startsWith("[") || !isHostname(host)) return false;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (host === LOOP_DOMAIN || host.endsWith(`.${LOOP_DOMAIN}`)) return false;
  return true;
};

export const signImageUrl = async (env, value) => {
  if (!isPublicImageUrl(value)) return null;
  const href = new URL(value).href;
  return `/img/${base64urlEncode(await signBytes(env, href))}/${base64urlEncode(utf8(href))}`;
};

export const verifyImagePath = async (env, sig, payload) => {
  const signature = base64urlDecode(sig);
  const bytes = base64urlDecode(payload);
  if (!signature || signature.length !== SIGNATURE_BYTES || !bytes || bytes.length > MAX_PROXY_URL) return null;
  const href = fromUtf8(bytes);
  const expected = await signBytes(env, href);
  if (!crypto.subtle.timingSafeEqual(expected, signature)) return null;
  return isPublicImageUrl(href) ? href : null;
};

class ProxyFailure extends Error {}

const fail = (message) => {
  throw new ProxyFailure(message);
};

const readCapped = async (body, max) => {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      fail("too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return bytes;
};

const isRedirect = (status) => [301, 302, 303, 307, 308].includes(status);

const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp|avif|apng)\s*(;|$)/i;

const fetchUpstream = async (href, fetcher) => {
  let current = href;
  for (let hop = 0; hop <= PROXY_MAX_REDIRECTS; hop++) {
    const response = await fetcher(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9", "user-agent": "xaverric-blog-image-proxy" },
    });
    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      const next = location ? new URL(location, current).href : null;
      await response.body?.cancel();
      if (!next || !isPublicImageUrl(next)) fail("redirect blocked");
      current = next;
      continue;
    }
    return response;
  }
  return fail("too many redirects");
};

export const fetchProxiedImage = async (href, fetcher = fetch) => {
  try {
    const response = await fetchUpstream(href, fetcher);
    if (!response.ok || !response.body) fail(`upstream ${response.status}`);
    if (!IMAGE_TYPE.test(response.headers.get("content-type") ?? "")) fail("not an image");
    if (Number(response.headers.get("content-length")) > PROXY_MAX_BYTES) fail("too large");
    const bytes = await readCapped(response.body, PROXY_MAX_BYTES);
    const type = sniffImage(bytes);
    if (!PROXY_TYPES.has(type)) fail("unknown image format");
    return { ok: true, bytes, contentType: TYPES[type].contentType };
  } catch (error) {
    return { ok: false, reason: error instanceof ProxyFailure ? error.message : "fetch failed" };
  }
};
