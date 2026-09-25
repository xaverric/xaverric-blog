# xaverric-blog

Personal blog at https://blog.xaverric.cz. One Cloudflare Worker renders the public site on the server, serves a JSON admin API and static assets, and keeps posts, sessions and uploaded images in D1. Only the owner writes.

- `/` lists published posts (title, date, reading time, tags, excerpt, optional cover), ten per page (`/page/2`), with tag pages at `/tags/:tag`.
- `/:slug` renders a post: heading anchors, a table of contents from three h2/h3 headings on, server-side code highlighting with a copy button, Mermaid diagrams (loaded only when a post has one, light and dark), KaTeX math as MathML, tables, task lists, callouts, footnotes and figures.
- `/rss.xml`, `/atom.xml`, `/feed.json`, `/sitemap.xml`, `/robots.txt`, Open Graph and Twitter cards, canonical URLs, JSON-LD, a custom 404.
- `/admin` is a WYSIWYG + Markdown editor behind GitHub sign-in. Only GitHub user ids listed in `ADMIN_GITHUB_IDS` get a session.

## Layout

| Path | What |
|---|---|
| `src/` | Worker: routing, OAuth and sessions, posts and media API, Markdown renderer, sanitizer, image proxy, feeds, page templates |
| `shared/` | Markdown syntax extensions and text helpers used by both the Worker and the editor |
| `client/` | Browser code bundled by esbuild: `site.js` (copy buttons, contents highlight, lazy Mermaid) and `admin/` (TipTap + CodeMirror editor) |
| `public/` | CSS, fonts (OFL, `public/fonts/OFL.txt`), `admin.html`, favicon, default OG image. `public/build/` is generated and gitignored |
| `migrations/` | D1 schema |
| `scripts/build.js` | esbuild bundle into `public/build/`, run by `npm run build` and by wrangler's `[build]` |
| `test/worker/` | Vitest suites in the Workers runtime with the migrations applied |
| `test/editor/` | Vitest suites in happy-dom: Markdown round trip through the editor, pure helpers |
| `docs/plan.md` | Design, library choices and test plan |
| `docs/DEPLOY.md` | One-time owner setup and deploy |

## Markdown

GFM plus footnotes `[^1]`, callouts `> [!NOTE]` (NOTE, TIP, IMPORTANT, WARNING, CAUTION), `==highlight==`, `{+added+}`, `{-removed-}`, inline math `$a^2$`, block math `$$ ... $$` or a `math` fence, and `mermaid` fences. A paragraph holding only an image becomes a figure with the title (or alt text) as caption. Raw HTML is shown as text and the rendered HTML passes an allowlist sanitizer.

The editor's Editor and Code modes share one Markdown string. Switching modes without edits gives back the stored text unchanged; the WYSIWYG serializer writes the same syntax the renderer reads (`test/editor/roundtrip.test.js`).

## Images

Uploads are resized in the browser to at most 1600 px on the long edge and encoded as WebP (JPEG fallback), at most 1.5 MB, and stored in D1 under a content hash: `/media/<hash>.webp`. Only WebP, JPEG, PNG and GIF pass the magic-byte check, never SVG. External images in Markdown are served through a signed proxy at `/img/<sig>/<url>`, so readers never contact other hosts and the CSP stays `img-src 'self' data:`.

## Admin API

All routes need the session cookie and the owner id. Mutations also need a same-origin request. Errors are `{ "error": { "code", "message" } }`.

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/me` | |
| GET | `/api/admin/posts` | `?q=`, `?status=draft\|published` |
| POST | `/api/admin/posts` | `{ title?, slug?, excerpt?, tags?, coverKey?, bodyMd?, publishedAt? }`, slug from the title when omitted |
| GET | `/api/admin/posts/:id` | |
| PATCH | `/api/admin/posts/:id` | same fields as create |
| DELETE | `/api/admin/posts/:id` | soft delete, purged after 7 days |
| POST | `/api/admin/posts/:id/restore` | undo a delete |
| POST | `/api/admin/posts/:id/publish` | `{ publishedAt? }` |
| POST | `/api/admin/posts/:id/unpublish` | |
| POST | `/api/admin/preview` | `{ bodyMd }`, answers the public renderer's HTML |
| GET | `/api/admin/media` | images with usage counts |
| POST | `/api/admin/media` | raw image bytes |
| DELETE | `/api/admin/media/:key` | `409 in_use` with the posts that use it, `?force=1` to delete anyway |

Slugs are lowercase letters, digits and single hyphens, at most 80 characters, unique across posts (including deleted ones until they are purged). Reserved: `admin`, `api`, `auth`, `media`, `img`, `tags`, `page`, `css`, `js`, `fonts`, `build`, `feed`, `rss`, `atom`, `sitemap`, `favicon`, `about`, `search` and a few more in `src/posts.js`.

## Local development

Node 22.

```sh
npm ci
npm run lint
npm run build
npm test
```

Run the Worker locally with a dev login. Create `.dev.vars` (gitignored):

```sh
cat > .dev.vars <<VARS
SESSION_SECRET=$(openssl rand -hex 24)
DEV_LOGIN=1
APP_URL=http://localhost:8790
ADMIN_GITHUB_IDS=19148363
EDGE_CACHE=0
VARS
npx wrangler d1 migrations apply xaverric-blog --local
npx wrangler dev --local --port 8790 --local-upstream localhost:8790
```

`wrangler dev` runs the build and rebuilds when `client/` or `shared/` change. `--local-upstream` keeps the request host at `localhost`; without it the custom-domain route rewrites it to `blog.xaverric.cz`. `EDGE_CACHE=0` turns the edge cache off so edits show at once. Then open http://localhost:8790/auth/dev?login=xaverric&next=/admin. The dev login only exists when `DEV_LOGIN=1` and `APP_URL` is `http://localhost`, and the dev user counts as admin only under the same condition. The local database starts empty; nothing ships sample content.

## License

MIT
