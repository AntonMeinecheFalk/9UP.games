# 9UP Games — self-hosted studio website

A small, editorial-first website for the indie studio **9UP Games**, designed to
run entirely on a **Raspberry Pi**. The Pi is both the web host and the data
store: structured content lives in a single **SQLite** file, and uploaded
images/videos live as **files on local disk**. No external database, no cloud
object storage.

The whole site is edited **in the browser** by the team — add/edit/reorder/
delete games, sections, team members, slides, and the featured game — with no
code changes and no AI in the loop.

---

## Highlights

- **Tiny footprint:** Node + Express, SQLite (`better-sqlite3`), local-file
  media. Comfortable on a Pi 4/5.
- **No login form.** Edit mode is unlocked by visiting `/edit/<SECRET>` (the
  secret is an env var, never shown in the UI or client source). A short-lived,
  HMAC-signed cookie then enables editing controls site-wide.
- **Reusable `Game` pages:** a big hero (image + title overlay + Pitch Deck and
  Steam buttons) followed by an ordered list of **predetermined section types**
  (Text, Image Carousel, Video, Buttons) — no freeform design tool.
- **Hosted pitch decks:** a simple Google-Slides-style editor per game and a
  full-screen public viewer. **Slide images are served at full resolution — no
  recompression** (the main reason this isn't Google Slides).
- **Press Kit flow:** press-type selection → adaptive Steam-key request form →
  saved to SQLite **and** emailed to `contact@9up.games` via a transactional
  email API. Downloadable press assets are an editable section.
- **Unified design system** so the site stays coherent no matter who edits it.

---

## Project layout

```
src/
  server.js     Express app + middleware + error handling
  config.js     Env/.env loading and config object
  db.js         SQLite schema, migrations, seed, settings helpers
  models.js     CRUD for games, sections, team, slides, submissions
  auth.js       Secret check + signed-cookie edit sessions
  media.js      Upload pipeline (multer + sharp thumbnails), serving paths
  email.js      Transactional email (Resend/Postmark/SendGrid via fetch)
  sanitize.js   Rich-text sanitization + URL/HTML escaping
  render.js     HTML components (hero, sections, team card, slide blocks)
  pages.js      Full-page composition (home, about, press, game, admin)
  deckpage.js   Pitch-deck viewer + editor markup
public/
  css/styles.css   Unified design system
  js/app.js        Public: carousel + press-kit flow
  js/edit.js       Edit mode: CRUD, reorder, upload, rich text
  js/deck.js       Public deck presentation viewer
  js/deck-edit.js  Deck editor
systemd/9up-games.service   Service unit
scripts/backup.sh           DB + media backup
```

Media is stored under `MEDIA_DIR` (default `./media`); generated thumbnails go
in `MEDIA_DIR/thumbs`. **Originals are always preserved and served when full
quality is requested.** The SQLite database is `DB_PATH` (default
`./data/site.db`).

---

## Fresh Raspberry Pi setup

Assumes Raspberry Pi OS (64-bit recommended) and a user named `pi`.

```bash
# 1. Install Node.js 18+ (NodeSource works well on Pi OS):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# 2. Get the code onto the Pi (git clone or copy), then:
cd ~/9up-games
npm install            # builds better-sqlite3 + sharp (prebuilt ARM binaries)

# 3. Configure:
cp .env.example .env
nano .env              # set a long random EDIT_SECRET (see "Edit mode" below)

# 4. Run it:
npm start
# -> http://127.0.0.1:3000
```

> `better-sqlite3` and `sharp` ship prebuilt binaries for ARM; `build-essential`
> is only needed as a fallback if a prebuilt binary isn't available. If `sharp`
> can't be installed at all, the app still runs — it just skips thumbnail
> generation and serves originals.

### Putting it on the internet

Run the Node app bound to `127.0.0.1` and put **nginx** or **Caddy** in front
for TLS. Example Caddy config:

```
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then set `SECURE_COOKIES=true` in `.env` so the edit-session cookie is marked
`Secure`. Caddy handles HTTPS certificates automatically.

---

## Running as a systemd service

```bash
# Edit paths/user in the unit if your install dir differs from /home/pi/9up-games
sudo cp systemd/9up-games.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 9up-games

# Logs:
journalctl -u 9up-games -f
```

The unit reads `EnvironmentFile=/home/pi/9up-games/.env`. After changing `.env`,
`sudo systemctl restart 9up-games`.

---

## Environment variables

All configured in `.env` (see `.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address (`127.0.0.1` behind a proxy) | `127.0.0.1` |
| `EDIT_SECRET` | Secret in the `/edit/<SECRET>` URL that unlocks editing | _(required)_ |
| `SESSION_SECRET` | Key signing the edit cookie; derived from `EDIT_SECRET` if blank | derived |
| `SESSION_HOURS` | Edit-session lifetime | `8` |
| `SECURE_COOKIES` | Mark session cookie `Secure` (set `true` behind HTTPS) | `false` |
| `DB_PATH` | SQLite file location | `./data/site.db` |
| `MEDIA_DIR` | Uploaded media directory | `./media` |
| `MAX_UPLOAD_MB` | Per-file upload size limit | `300` |
| `EMAIL_PROVIDER` | `resend` \| `postmark` \| `sendgrid` \| empty | _(empty)_ |
| `EMAIL_API_KEY` | API key for the chosen provider | _(empty)_ |
| `EMAIL_TO` | Where key requests are emailed | `contact@9up.games` |
| `EMAIL_FROM` | Verified sender address | `noreply@9up.games` |

---

## Edit mode (no login form)

1. Set a long, random `EDIT_SECRET` in `.env`, e.g.:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. Visit `https://your-domain.com/edit/<EDIT_SECRET>`. This sets a signed,
   HttpOnly session cookie and redirects home. Editing controls ("Add section",
   "Add team member", uploads, reorder, delete, featured-game picker, deck
   editor, key-request list) now appear site-wide.
3. Without the cookie the site is fully read-only with **zero editing
   affordances**.
4. Exit edit mode with the **Exit** link (or visit `/logout`).

**The secret is never embedded in any page, link, or error message.** A wrong
secret returns a plain 404. Rotate the secret by changing `EDIT_SECRET` (and
restarting). If `SESSION_SECRET` is derived from `EDIT_SECRET` (the default),
rotating the secret also invalidates existing edit sessions.

---

## Press Kit & email delivery

Submissions are **always written to SQLite first** (review them in edit mode at
`/admin/submissions`), then a notification email is sent to `EMAIL_TO` with the
applicant set as `Reply-To`. Configure a transactional provider — outbound SMTP
from a residential/Pi IP is unreliable:

- **Resend:** `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY=re_...`
- **Postmark:** `EMAIL_PROVIDER=postmark`, `EMAIL_API_KEY=<server token>`
- **SendGrid:** `EMAIL_PROVIDER=sendgrid`, `EMAIL_API_KEY=SG...`

`EMAIL_FROM` must be a domain/address you've verified with the provider. If no
provider/key is configured, submissions are still saved and a clear log line
notes that email delivery is unconfigured — nothing is lost.

---

## Where your edits are stored (and how they reach the Pi)

**Everything you change in edit mode is persisted immediately**, in exactly two
places:

- `data/site.db` (SQLite) — all structured content: games, sections, team
  members, slides, press submissions, the featured-game choice, the site title,
  the About mission, the **theme/palette/fonts**, and each game's **hero
  crop/zoom + logo size/position**.
- `media/` — every uploaded image/video original, plus generated `media/thumbs/`.

Nothing lives only in the browser or in memory, and these two paths are **not**
in git (they're git-ignored), so they travel with the data, not the code.

### ⚠️ SQLite WAL note (important for copying)

The DB runs in WAL mode, so recent writes live in `site.db-wal` until they're
checkpointed into `site.db`. The app **checkpoints automatically on shutdown**,
so after `systemctl stop 9up-games` (or Ctrl-C), `site.db` is complete and can
be copied on its own. If you copy while the service is **running**, either use
`scripts/backup.sh` (WAL-safe) or copy all three files together: `site.db`,
`site.db-wal`, `site.db-shm`.

### Moving content you authored locally onto the Pi

If you've been editing on another machine and want that content on the Pi:

1. Stop the app on the source machine (`Ctrl-C` / `systemctl stop`) so the DB
   checkpoints.
2. Copy `data/site.db` and the whole `media/` directory to the same locations
   on the Pi (matching `DB_PATH` / `MEDIA_DIR`).
3. Start the service on the Pi — your games, theme, media and layout appear.

On a **fresh** Pi with no `data/`/`media/` copied over, the app just starts with
the empty seed state, ready to edit via `/edit/<SECRET>`. Schema upgrades are
applied automatically on boot (lightweight migrations), so an older `site.db`
copied forward keeps working.

## Backups

The entire site is **one SQLite file + the media directory**. To back up:

```bash
./scripts/backup.sh            # writes to ./backups/
./scripts/backup.sh /mnt/usb   # or a custom destination
```

This makes a consistent SQLite snapshot (`sqlite3 .backup`, safe while running
in WAL mode) and a `tar.gz` of the media directory. To restore: copy the `.db`
back to `DB_PATH` and extract the media tarball over `MEDIA_DIR`.

---

## Content model (what editors can do)

- **Games** — title, hero image, Steam URL, ordered sections, a pitch deck, and
  a "featured" flag controlling the landing page. Create / edit / reorder
  sections / delete.
- **Sections** (fixed layouts): **Text** (rich text), **Image Carousel**,
  **Video** (YouTube/Vimeo URL _or_ uploaded file), **Buttons**.
- **About** — editable Mission rich-text + **Team** of profile cards (photo,
  name, role, description, optional LinkedIn button). Reorder / delete.
- **Pitch deck** — per game; add/delete/reorder slides; each slide holds text /
  image / buttons / video blocks. Full-screen viewer with arrow-key navigation.
- **Press Kit** — adaptive Steam-key request form + editable press-assets
  section + on-site submissions list.

---

## Security notes

- Uploads are restricted by MIME type (images + common video) and size; stored
  under random filenames and never executed. Served with long cache headers.
- Rich text is sanitized server-side to a strict allowlist (`sanitize-html`);
  links are forced to `rel="noopener noreferrer nofollow" target="_blank"`.
- All mutating endpoints require the signed edit cookie; the public read path
  exposes no editing API.
- Run behind HTTPS with `SECURE_COOKIES=true` in production.
