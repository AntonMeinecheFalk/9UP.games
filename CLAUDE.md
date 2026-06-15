# CLAUDE.md — 9UP Games website

Self-hosted, editorial-first marketing site for the indie studio **9UP Games**.
Node + Express, **SQLite** (`better-sqlite3`) for structured content, **local-file**
media (`sharp` thumbnails). Designed to run on a **Raspberry Pi**. The whole site
is edited in the browser (no CMS, no build step, no framework). See `README.md`
for the full content model and env-var reference; this file covers how it's put
together, the design conventions, and how it's deployed.

## Commands
- `npm start` — run the server (`node src/server.js`) → `http://127.0.0.1:3000`
- `npm run dev` — same with `node --watch` (auto-restart on file change)
- No build, no tests, no linter. Static assets are served straight from `public/`.

## Architecture
- `src/server.js` — Express app, middleware, error handling, graceful shutdown.
- `src/config.js` — `.env` loading + `config`/`ROOT` exports.
- `src/db.js` — SQLite schema, migrations (auto-applied on boot), WAL mode.
- `src/models.js` — CRUD + `parseDisplay`/`DEFAULT_DISPLAY` (per-game hero/logo layout), theme.
- `src/render.js` — server-rendered HTML components (`layout`, `renderHero`, sections, etc.).
- `src/pages.js` / `src/deckpage.js` — full-page composition / pitch-deck viewer+editor.
- `src/auth.js` — secret check + signed-cookie edit sessions.
- `src/media.js` — upload pipeline (multer + sharp), serving paths.
- `public/css/styles.css` — the entire design system (one file).
- `public/js/` — `app.js` (public: carousels, press flow, **hamburger nav**, **hero parallax**), `edit.js` (edit mode), `deck.js`/`deck-edit.js`.
- Content lives in `data/site.db` + `media/` — **git-ignored**; they travel with the data, not the code.

## Edit mode
Visit `/edit/<EDIT_SECRET>` (value is in `.env`, never committed) → sets an
HttpOnly+Secure signed cookie → editing controls appear site-wide. `/logout` to exit.
A wrong secret returns a plain 404.

## Design system & responsive conventions
- **Theme** is data-driven: colors/fonts in SQLite → CSS custom properties via
  `themeStyle()` in `render.js` (`--bg`, `--accent`, `--btn-shadow`, etc.). Editable live in edit mode (🎨 panel).
- **Shared design tokens** in `:root`: `--shadow-panel` (the floating-panel cast shadow),
  `--blur-sm/md/lg` (used for **both** `backdrop-filter` and `-webkit-backdrop-filter` — always
  emit both prefixes), `--shadow`/`--text-shadow*`. Reuse these rather than re-hardcoding.
- **"Glass" treatment** (header, elevator-pitch box, hamburger dropdown, carousel frame): transparent/
  tinted bg + `var(--blur-lg)`, a screen-blend rim light (`border-top/bottom: 2px solid var(--btn-highlight); mix-blend-mode: screen`), `box-shadow: var(--shadow-panel)`, ~20–28px radius.
  - ⚠️ **Backdrop-filter nesting:** an ancestor with `backdrop-filter` is a "backdrop root", so a
    nested element's own blur has nothing left to filter (and it fails entirely at a negative
    z-index). That's why the mobile dropdown (`.site-nav-drop`) is rendered as a fixed sibling
    **outside** `<header>` (the header keeps its own `backdrop-filter`), and why glass layers use
    non-negative z-index.
  - Horizontal dividers fade out toward **both** ends (`transparent → highlight → transparent`).
- **`.glass-arrow`** (`public/css/styles.css`) is the single shared circular arrow used by BOTH the
  image carousel and the pitch-deck viewer: frosted disc + rim + triangle, hover punches the triangle
  out of a white disc (the `--arrow-hole` mask). Size via `--arrow-size`/`--tri-size`, direction via
  `--prev`/`--next`. Markup adds `glass-arrow glass-arrow--prev/next` + a context class for position
  (`carousel__prev/next`, `deck-arrow`). The triangle SVG comes from `triSvg()` exported by `render.js`.
- **Per-game hero framing** is stored in each game's `display` JSON (`parseDisplay`), with
  **separate desktop and mobile controls** (edit mode → "Adjust hero & logo"):
  - Desktop: `heroPosX/heroPosY` (object-position focus), `heroZoom`.
  - Mobile: `mHeroZoom`, `mHeroX` (object-position pan, gap-free), `mHeroY` (translateY pan).
  - Logo: `logoScale/logoX/logoY`; on mobile the logo is force-centered horizontally.
- **Mobile / compact layout** (`@media (max-width: 820px)`):
  - Nav collapses to a **hamburger dropdown** (toggled in `app.js`).
  - Hero art is full-bleed behind a content-hugging translucent panel; logo/buttons/pitch centered.
  - The near-square key art is reframed for portrait via `transform` (object-position can't crop a
    square image in a portrait box). **Edge-extension layers** (`.hero__bg::before/::after`) repeat the
    top/bottom edge pixels (blurred) so vertical panning/parallax never reveals a gap.
  - Scroll-driven **parallax** is wired into the mobile transform (`--m-parallax-y` from `app.js`).
- **iOS safe areas:** `viewport-fit=cover` + `env(safe-area-inset-*)`.
  - ⚠️ Safari **drops `env()` inside negative-margin/subtraction `calc()`** but honors plain/additive
    `env()`. The header is `position: fixed` so the hero fills from the true top with no env-in-calc.
  - ⚠️ In a Safari **tab**, `safe-area-inset-top` is **0** — you cannot render content under the
    portrait status bar. We color it with `<meta name="theme-color">` (`#4990ab`, the glass tone) and
    blend it into the header top; the real art-bleed only happens in **standalone/Add-to-Home-Screen**
    (apple-mobile-web-app meta tags enable it).
- **Cache-busting:** `assetUrl()` in `render.js` appends `?v=<mtime>` to CSS/JS so deploys are picked
  up immediately (Cloudflare stamps a multi-hour browser cache otherwise). Use it for any new static asset.

## Deployment (live at https://9up.games)
Runs on a Raspberry Pi (Debian, ARM64), reached over the internet via a **Cloudflare Tunnel**
(no port-forwarding, hides home IP, free TLS).

- **Pi:** `ssh anton2609@Raspberry.local` (key-based). App at `/home/anton2609/9up-games`.
- **Services (systemd):** `9up-games` (the Node app, bound to `127.0.0.1:3000`) and `cloudflared`
  (the tunnel → `127.0.0.1:3000`). Both `enable`d, auto-restart, survive reboot.
- **DNS:** the domain (registered at **one.com**) uses **Cloudflare nameservers**
  (`lucy`/`patrick.ns.cloudflare.com`). `9up.games` + `www` are proxied CNAMEs to the tunnel.
  **Email stays on one.com** — the MX / SPF / DMARC records are mirrored in Cloudflare as DNS-only;
  do not proxy or remove them.
- **HTTPS:** app 301-redirects plain HTTP → HTTPS (via `X-Forwarded-Proto`) and sends HSTS.
  `.env` has `HOST=127.0.0.1` and `SECURE_COOKIES=true`.

### Shipping an update from a dev machine
Code is *not* deployed via GitHub push (pushing to `main` is gated). Sync changed files over SSH
and restart:
```bash
scp src/render.js public/css/styles.css anton2609@Raspberry.local:~/9up-games/<same path>
ssh anton2609@Raspberry.local "sudo -n systemctl restart 9up-games"   # only needed for src/ changes
```
- CSS/JS in `public/` are static — no restart needed (but `assetUrl` re-stats per render, so the
  `?v=` bumps automatically once the file lands).
- A **scoped passwordless-sudo** rule (`/etc/sudoers.d/anton2609-deploy`) allows only
  `systemctl restart/status` of the two services + their `journalctl` — nothing else.
- Content (`data/`, `media/`) is copied with `tar | ssh ... tar x` (rsync isn't on the Windows dev box).

### Verifying the live site without local DNS
The dev machine's resolver may lag DNS changes. Force the Cloudflare edge:
```
curl --resolve 9up.games:443:172.67.190.229 https://9up.games/
```
For visual checks, headless Chrome with `--host-resolver-rules="MAP 9up.games 172.67.190.229"`.

## Gotchas / lessons
- Safari `env()`-in-`calc()` and `backdrop-filter` nesting (see Design system above).
- Headless Chrome renders `backdrop-filter`/blend-modes differently than iOS Safari — sample target
  colors from real screenshots/mockups (e.g. `sharp` pixel sampling), don't trust headless for glass color.
- A nameserver migration has an unavoidable propagation tail (resolvers cache the old delegation up to
  ~48h); the site is correct as soon as the registry delegates to Cloudflare — stragglers just need their cache to expire.
