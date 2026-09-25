# Plan

Personal blog at https://blog.xaverric.cz. One Cloudflare Worker: server-rendered public pages, a JSON admin API, static assets, D1 for posts, sessions and uploaded images. Only the GitHub id in `ADMIN_GITHUB_IDS` can write.

## Design

Hallmark, default Design flow, context given by the owner: audience = developers and readers of Daniel's technical writing, use case = read posts and browse the overview, admin = write comfortably, tone = brutalist.

- **Macrostructure: Long Document.** The post is the product: one column, measure 66ch, generous leading, section heads out of the flow. Differs from leaderborder (Stat-Led), xaverric-site (Typographic Card / Marquee Hero) and xaverric-go (Index-First).
- **Theme: custom brutal variant** ("raw paper, heavy ink, one signal yellow"). Light paper `oklch(97.2% 0.008 95)`, ink `oklch(17% 0.012 95)`, accent signal yellow `oklch(89% 0.17 100)` used only as a fill behind ink (highlights, link hover, active state, `==marks==`). Dark mode keeps the hue: paper `oklch(16.5% 0.01 95)`, ink `oklch(94% 0.01 95)`, same yellow at lower chroma.
- **Axes:** light / display-heavy / chromatic-yellow. Differs from xaverric-site (light / roman-serif / warm) on display style and accent hue, from xaverric-go and leaderborder (light / geometric-sans / cool-blue) on display style and accent hue.
- **Type:** Bricolage Grotesque 800 at width 78 for display, Newsreader (optical size) for body, JetBrains Mono for code and meta. All self-hosted (OFL), latin + latin-ext.
- **Brutal moves, tuned for reading:** 3 px ink rules, zero radius, hard 4 px offset shadow only on the primary button, uppercase mono meta rows, tabular dates. No cards around posts: the overview is a ledger of heavy titles separated by thick rules, with the date and reading time in a mono column. Post detail: huge title, meta row, then prose. Long posts get a table of contents (in flow on mobile, sticky left rail from 75rem).
- **Nav N7 Brutal slab** (wordmark + Posts / RSS), **footer Ft1 Mast-headed** (wordmark, one line, RSS / Atom / JSON Feed / GitHub).
- **Admin** shares the tokens and rules but drops the shouting: sans UI at body size, one thick rule under the bar, quiet toolbars, a yellow fill only for the active mode and the saving indicator.
- Motion: none on public pages except instant state changes; admin uses 90 to 160 ms colour changes. Reduced motion respected.

## Libraries

| Need | Choice | Why |
|---|---|---|
| Markdown on the server | `marked` 18 + `marked-footnote` | Fast, pure ESM, runs in Workers, extension API with custom inline/block tokenizers. |
| WYSIWYG editor | **TipTap 3** (ProseMirror) + `@tiptap/markdown` | The official markdown package parses with the same `marked` lexer and serializes per node. Custom syntax is a `markdownTokenizer` with the exact shape of a `marked` extension, so `==mark==`, `{+added+}`, `{-removed-}`, `$math$` and `$$math$$` are defined once in `shared/syntax.js` and reused by the server renderer and the editor. Tables, task lists, fenced code with language and images are first-class. |
| Code mode | **CodeMirror 6** + `@codemirror/lang-markdown` | Best plain-text editor on the web, line wrapping as a compartment, CSP friendly (styles via adoptedStyleSheets). |
| Code highlighting | `highlight.js` core with 20 languages, on the server | Class-only output, no inline styles, cheap at save time. |
| Math | `katex` with `output: "mathml"`, on the server | MathML is rendered natively by current browsers and carries no inline styles, so the strict CSP stays. |
| Diagrams | `mermaid` 11 (client, lazy) | Loaded with a dynamic import only when a post contains a `mermaid` block. While it renders, its `<style>` goes into a constructable stylesheet and its `style=""` attributes into CSSOM, so `style-src 'self'` holds without a single violation. Theme follows `prefers-color-scheme`. |
| Sanitizing | `HTMLRewriter` (built into Workers) with a tag + attribute allowlist | Real HTML parser, zero dependencies, streams. Raw HTML in Markdown is escaped before that. |

**Considered.** Milkdown / Crepe: the best pure remark round-trip, but every custom mark needs a micromark syntax extension plus a remark plugin plus a ProseMirror schema, and the server would then have to run remark too to stay identical. Lexical (used by the reference editor) has a weaker Markdown story (transformers, lossy tables). TipTap's markdown package sharing `marked` with the server is the decisive advantage: one tokenizer, two consumers.

## Markdown conventions

GFM (tables, task lists, strikethrough, autolinks), footnotes `[^1]`, callouts `> [!NOTE]` (NOTE, TIP, IMPORTANT, WARNING, CAUTION), `==highlight==`, `{+added+}`, `{-removed-}` (same as the owner's reference editor), inline math `$a^2$` (no space inside the dollars, not followed by a digit), block math `$$ ... $$`, fenced ```` ```mermaid ```` diagrams. Images alone in a paragraph become figures; the title (or the alt text) is the caption. Raw HTML is shown as text.

## Images

No R2. Uploads are stored in D1:

- The editor downscales before upload (canvas / OffscreenCanvas, long edge at most 1600 px, WebP q 0.82, JPEG fallback). A GIF of at most 1.5 MB is uploaded unchanged so it keeps its animation. Anything still above 1.5 MB is rejected (D1 rows cap at 2 MB).
- `POST /api/admin/media` takes the raw bytes, checks magic bytes (WebP, JPEG, PNG, GIF, never SVG), reads width and height from the header, keys by the first 32 hex characters of SHA-256 and stores a BLOB.
- `GET /media/<hash>.<ext>` serves it immutable (`max-age=31536000, immutable`, ETag = hash, `nosniff`, `inline`) through the edge Cache API.
- External images in posts are rewritten to `/img/<sig>/<base64url(url)>`. `sig` is HMAC-SHA256 truncated to 16 bytes, key derived with HKDF from `IMAGE_PROXY_SECRET` or `SESSION_SECRET` (info `xaverric-blog/image-proxy/v1`). The proxy only fetches public `https:` hosts on default ports, re-validates every redirect (at most 3), requires an `image/*` type other than SVG, streams at most 8 MB and caches at the edge. Readers never contact third-party hosts; `img-src 'self' data:`.

## Data

`posts (id, slug unique, title, excerpt, body_md, body_html, html_version, toc_json, reading_minutes, has_mermaid, cover_key, tags json, status, published_at, created_at, updated_at, deleted_at)`, `media (key, content_type, size, width, height, data blob, created_at)`, `users`, `web_sessions`. HTML is rendered on save; `html_version` (renderer version + proxy key fingerprint) lets public requests re-render lazily after a renderer change or a key rotation. Delete is soft (`deleted_at`) so the admin can undo; rows older than 7 days are purged on the next delete.

## Caching

Public HTML: `Cache-Control: public, max-age=60, s-maxage=300` and the Worker's edge Cache API, no purge needed (at most five minutes stale; publish also drops the local colo copies). Media and proxied images: immutable, edge cached. Admin and API: `no-store`.

## Autosave

Drafts autosave (1.2 s debounce) with a Saved / Saving / Unsaved / Error indicator. Published posts save explicitly (Update, Ctrl/Cmd+S) so half-written edits never go live; the indicator shows unsaved changes and the page warns before leaving.

## Strict CSP in the admin

`script-src 'self'; style-src 'self'` everywhere, admin included. TipTap runs with `injectCSS: false` (its base rules live in `admin.css`), CodeMirror is mounted in a shadow root so its style-mod sheets become adopted stylesheets instead of `<style>` tags, KaTeX renders MathML, and Mermaid goes through the CSSOM shim above.

## Build

`scripts/build.js` bundles `client/` with esbuild (ESM, code splitting, minified) into `public/build/`, which is gitignored and never committed. `wrangler.toml` runs it as `[build] command`, so `wrangler dev`, `wrangler deploy` and the deploy workflow always ship a fresh bundle. CI runs it too to catch bundling errors. Fonts and the default OG image are committed assets, not build output.

## TDD plan

Workers pool (vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.22, migrations applied):

1. `shared/syntax` and renderer: headings and anchors, TOC, code highlight, mermaid passthrough, math inline and block, tables, task lists, callouts, footnotes, marks, figures, sanitization (script, iframe, `javascript:`, event handlers, raw HTML), external image rewriting.
2. Media: magic bytes, dimensions, size limits, auth, same-origin, serving headers, ETag / 304, edge cache.
3. Image proxy: signature valid / invalid / tampered, blocked schemes, ports, hosts (IP literals, localhost, `.local`, `*.xaverric.cz`), non-image and SVG types, redirect re-validation, size cap, caching.
4. Public routes: overview, pagination, tag filter, detail, drafts and deleted hidden, 404 page, RSS / Atom / JSON Feed / sitemap validity, robots, cache headers, OG meta.
5. Auth: GitHub OAuth with PKCE and state cookie, sessions, logout, dev login gating, `/admin` gate (anon redirect, non-admin 403, admin 200), API 401 / 403.
6. Posts API: CRUD, slug generation and uniqueness, reserved slugs, validation, publish / unpublish, soft delete and restore, preview uses the public renderer.
7. Security: headers on every response type, `_headers` parity, rate limits, body limits, internal errors hide details.

happy-dom project: editor Markdown round-trip (Markdown to TipTap to Markdown is idempotent and renders the same HTML), pure helpers (text commands for Code mode, image downscale sizing, slug, word count, debounce).
