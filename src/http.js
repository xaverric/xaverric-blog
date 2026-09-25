export const MAX_JSON_BYTES = 1024 * 1024;

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";

export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

export const PUBLIC_HTML_CACHE = "public, max-age=60, s-maxage=300";

export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
};

export const PRIVATE_ROBOTS = "noindex, nofollow";

export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const badRequest = (message) => new HttpError(400, "invalid_request", message);

export const notFoundError = (message = "Not found") => new HttpError(404, "not_found", message);

export const json = (data, { status = 200, headers = {} } = {}) => Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

export const errorResponse = (status, code, message, headers = {}) => json({ error: { code, message } }, { status, headers });

export const noContent = (headers = new Headers()) => {
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 204, headers });
};

export const redirect = (location, cookies = [], status = 302) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  cookies.forEach((cookie) => headers.append("set-cookie", cookie));
  return new Response(null, { status, headers });
};

export const html = (body, { status = 200, headers = {} } = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

const isJsonType = (value) => /^application\/json\s*(;|$)/i.test(value ?? "");

export const readLimited = async (request, max) => {
  if (Number(request.headers.get("content-length")) > max) throw new HttpError(413, "too_large", "Body too large");
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (!reader) return new Uint8Array();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, "too_large", "Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    buffer.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return buffer;
};

export const readJsonBody = async (request, max = MAX_JSON_BYTES) => {
  if (!isJsonType(request.headers.get("content-type"))) throw badRequest("Content-Type must be application/json");
  const buffer = await readLimited(request, max);
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw badRequest("Invalid JSON body");
  }
};

const isPrivatePath = (pathname) => /^\/(admin|api|auth)(\/|$)/.test(pathname);

export const withSecurityHeaders = (response, request) => {
  const secured = new Response(response.body, response);
  const url = new URL(request.url);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    if (name !== "content-security-policy" || !secured.headers.has(name)) secured.headers.set(name, value);
  });
  if (!secured.headers.has("cross-origin-resource-policy")) secured.headers.set("cross-origin-resource-policy", "same-origin");
  if (!secured.headers.has("referrer-policy")) secured.headers.set("referrer-policy", DEFAULT_REFERRER_POLICY);
  if (isPrivatePath(url.pathname)) secured.headers.set("x-robots-tag", PRIVATE_ROBOTS);
  if (url.protocol === "https:") secured.headers.set("strict-transport-security", STRICT_TRANSPORT_SECURITY);
  return secured;
};

export const toErrorResponse = (error) => {
  if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.headers);
  console.error("Unhandled worker error", error?.name ?? "Error", error?.message ?? "");
  return errorResponse(500, "internal", "Internal error");
};
