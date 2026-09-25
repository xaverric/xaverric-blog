# Deploying blog.xaverric.cz

Pushes to `main` run **Deploy** (`.github/workflows/deploy.yml`): lint, build and tests, then in the GitHub environment `production` `wrangler d1 migrations apply xaverric-blog --remote` and `wrangler deploy`. `wrangler deploy` runs `npm run build` itself (`[build]` in `wrangler.toml`), so the admin bundle in `public/build/` is always fresh and never committed. Without the Cloudflare secrets the deploy job ends with a "Deploy skipped" notice. A manual run (`workflow_dispatch`) deploys only from `main`.

Declared in `wrangler.toml`: the D1 database `xaverric-blog` (`7fe36508-ef49-4be6-bc48-c72b64623168`), the custom domain `blog.xaverric.cz`, the rate limiters `3001` and `3002`, the GitHub OAuth client id. There is no R2 bucket: images live in D1.

## One-time setup

### 1. GitHub OAuth App

Already created; its client id `Ov23liZb4HCufohBM0Ey` is in `wrangler.toml`. For reference, the values are:

| Field | Value |
|---|---|
| Application name | blog.xaverric.cz |
| Homepage URL | `https://blog.xaverric.cz` |
| Authorization callback URL | `https://blog.xaverric.cz/auth/github/callback` |
| Enable Device Flow | off |

The app requests no scopes.

### 2. Worker secrets

`GITHUB_CLIENT_SECRET`, `SESSION_SECRET` and `ADMIN_GITHUB_IDS` are already set on the Worker. To set or rotate them, from the repository root (`wrangler secret put` reads stdin, so nothing lands in the shell history):

```sh
pbpaste | npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
gh api user --jq .id | npx wrangler secret put ADMIN_GITHUB_IDS
```

- `SESSION_SECRET` must have at least 32 characters. Rotating it signs every session out and, unless `IMAGE_PROXY_SECRET` is set, also changes the image proxy key: posts re-render lazily on their next view, so old `/img/...` URLs in feed readers stop working.
- `ADMIN_GITHUB_IDS` is a comma-separated list of numeric GitHub user ids (`19148363` for `xaverric`). Anyone else who signs in gets "Not allowed" and no session. Removing an id locks its sessions out on the next request.
- Optional `IMAGE_PROXY_SECRET` (32+ characters) gives the image proxy its own key, so rotating `SESSION_SECRET` does not touch image URLs: `openssl rand -base64 32 | npx wrangler secret put IMAGE_PROXY_SECRET`. Either way the HMAC key is derived with HKDF (info `xaverric-blog/image-proxy/v1`), never used raw.

Clear the clipboard after pasting the client secret.

### 3. Cloudflare API token

Cloudflare dashboard > My Profile > API Tokens > Create Token > template **Edit Cloudflare Workers**, adjusted to:

| Scope | Permission | Why |
|---|---|---|
| Account > Workers Scripts | Edit | `wrangler deploy` (script and static assets) |
| Account > D1 | Edit | `wrangler d1 migrations apply --remote` |
| Account > Account Settings | Read | wrangler account lookup |
| User > User Details | Read | wrangler account lookup |
| Zone > Zone | Read | custom domain `blog.xaverric.cz` |
| Zone > Workers Routes | Edit | custom domain route in `wrangler.toml` |

Account Resources: only your account. Zone Resources: only `xaverric.cz`. Set an expiry and rotate it regularly. No R2 permission is needed.

### 4. GitHub environment `production`

Create the environment with a branch policy that allows only `main` and no required reviewers, so merges to `main` deploy automatically:

```sh
gh api -X PUT repos/xaverric/xaverric-blog/environments/production \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST repos/xaverric/xaverric-blog/environments/production/deployment-branch-policies -f name=main -f type=branch
```

Store the Cloudflare values as environment secrets (never repository secrets). `gh secret set` reads from stdin when `--body` is omitted:

```sh
pbpaste | gh secret set CLOUDFLARE_API_TOKEN --env production --repo xaverric/xaverric-blog
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo xaverric/xaverric-blog
```

### 5. First deploy

Push to `main` (or run **Deploy** manually). Check:

```sh
curl -sI https://blog.xaverric.cz/ | grep -iE "^(HTTP|cache-control|content-security-policy)"
curl -s https://blog.xaverric.cz/robots.txt
curl -s https://blog.xaverric.cz/rss.xml | head -5
```

Then sign in at https://blog.xaverric.cz/admin and write the first post. The overview shows "No posts yet." until something is published.

## Caching

Public HTML answers `Cache-Control: public, max-age=60, s-maxage=300` and is kept in the Worker's edge cache for five minutes. Publishing, unpublishing, deleting or editing a published post drops the copies in the colo that handled the request; other colos catch up within five minutes. Media (`/media/*`) and proxied images (`/img/*`) are immutable and edge cached. Admin and API responses are `no-store`.

## Rate limits

`AUTH_LIMITER` (30 requests per minute per IP) guards `/auth/*`. `API_LIMITER` (300 per minute) guards `/api/*` and image proxy cache misses. Public pages are not limited. The namespaces `3001` and `3002` are account-wide and must not collide with other Workers (leaderborder uses `1001` to `1003`, xaverric-go `2001` and `2002`).

## Rollback

```sh
npx wrangler deployments list
npx wrangler rollback
```

D1 migrations are forward only. Undo a schema change with a new migration, or restore with D1 Time Travel:

```sh
npx wrangler d1 time-travel restore xaverric-blog --timestamp "<ISO time before the deploy>"
```
