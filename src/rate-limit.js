import { HttpError } from "./http.js";

const clientKey = (request) => request.headers.get("cf-connecting-ip") || "local";

export const limitWith = async (limiter, request) => {
  if (!limiter) return;
  if (!(await limiter.limit({ key: clientKey(request) })).success) {
    throw new HttpError(429, "rate_limited", "Too many requests, retry later", { "retry-after": "60" });
  }
};

const limiterFor = (env, pathname) => {
  if (pathname.startsWith("/auth/")) return env.AUTH_LIMITER;
  if (pathname.startsWith("/api/")) return env.API_LIMITER;
  return null;
};

export const limitRequest = (request, env, pathname) => limitWith(limiterFor(env, pathname), request);
