// All HTTP routes: public pages (read-only), the edit-mode JSON API (guarded),
// media upload/serve, deck viewer/editor, and the press-kit submission flow.
import fs from 'node:fs';
import {
  secretMatches,
  setSessionCookie,
  clearSessionCookie,
  requireEdit,
} from './auth.js';
import {
  Games,
  Sections,
  Team,
  Slides,
  Submissions,
  Site,
  SECTION_TYPES,
} from './models.js';
import {
  upload,
  registerUpload,
  getMedia,
  deleteMedia,
  updateAlt,
  resolveMediaPath,
} from './media.js';
import { sanitizeRichHtml, safeUrl } from './sanitize.js';
import { sendSubmissionEmail } from './email.js';
import {
  renderHome,
  renderAbout,
  renderPressKit,
  renderGamePage,
  renderSubmissions,
} from './pages.js';
import { renderDeckViewer, renderDeckEditor } from './deckpage.js';

// --- helpers ----------------------------------------------------------------
const sendHtml = (res, html) =>
  res
    .type('html')
    .set('Cache-Control', 'no-cache') // pages reflect edit state; don't cache HTML
    .send(html);

const intOrNull = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// Validate/normalize a section's data blob by type before persisting.
function sanitizeSectionData(type, raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  switch (type) {
    case 'text':
      return { html: sanitizeRichHtml(data.html || '') };
    case 'carousel':
      return {
        images: (Array.isArray(data.images) ? data.images : [])
          .map((img) => ({ mediaId: intOrNull(img.mediaId), alt: String(img.alt || '') }))
          .filter((img) => img.mediaId && getMedia(img.mediaId)),
      };
    case 'video': {
      const mode = data.mode === 'file' ? 'file' : 'url';
      return {
        mode,
        url: mode === 'url' ? String(data.url || '').slice(0, 2000) : '',
        mediaId: mode === 'file' ? intOrNull(data.mediaId) : null,
      };
    }
    case 'buttons':
      return {
        buttons: (Array.isArray(data.buttons) ? data.buttons : [])
          .map((b) => ({
            label: String(b.label || '').slice(0, 200),
            url: String(b.url || '').slice(0, 2000),
          }))
          .filter((b) => b.label || b.url),
      };
    default:
      return {};
  }
}

// Validate/normalize a deck slide's blocks before persisting.
function sanitizeBlocks(rawBlocks) {
  if (!Array.isArray(rawBlocks)) return [];
  return rawBlocks
    .map((b) => {
      switch (b.type) {
        case 'text':
          return { type: 'text', html: sanitizeRichHtml(b.html || '') };
        case 'image': {
          const mediaId = intOrNull(b.mediaId);
          if (!mediaId || !getMedia(mediaId)) return null;
          return { type: 'image', mediaId, alt: String(b.alt || '').slice(0, 300) };
        }
        case 'buttons':
          return {
            type: 'buttons',
            buttons: (Array.isArray(b.buttons) ? b.buttons : [])
              .map((x) => ({
                label: String(x.label || '').slice(0, 200),
                url: String(x.url || '').slice(0, 2000),
              }))
              .filter((x) => x.label || x.url),
          };
        case 'video': {
          const mode = b.mode === 'file' ? 'file' : 'url';
          const mediaId = intOrNull(b.mediaId);
          return {
            type: 'video',
            mode,
            url: mode === 'url' ? String(b.url || '').slice(0, 2000) : '',
            mediaId: mode === 'file' && mediaId && getMedia(mediaId) ? mediaId : null,
          };
        }
        default:
          return null;
      }
    })
    .filter(Boolean);
}

export function registerRoutes(app) {
  // ===== Auth =============================================================
  // No login form. Visiting /edit/<secret> unlocks edit mode. Wrong secret
  // returns 404 so the endpoint reveals nothing.
  app.get('/edit/:secret', (req, res) => {
    if (secretMatches(req.params.secret)) {
      setSessionCookie(res);
      return res.redirect('/');
    }
    res.status(404).type('html').send('<h1>404 — Not found</h1>');
  });
  app.get('/logout', (req, res) => {
    clearSessionCookie(res);
    res.redirect('/');
  });

  // ===== Public pages =====================================================
  app.get('/', (req, res) => sendHtml(res, renderHome(req.editMode)));
  app.get('/about', (req, res) => sendHtml(res, renderAbout(req.editMode)));
  app.get('/press', (req, res) => sendHtml(res, renderPressKit(req.editMode)));

  app.get('/game/:slug', (req, res, next) => {
    const game = Games.getBySlug(req.params.slug);
    if (!game) return next();
    sendHtml(res, renderGamePage(game, req.editMode));
  });

  // Deck: public viewer, or editor when in edit mode (unless ?present=1).
  app.get('/game/:slug/deck', (req, res, next) => {
    const game = Games.getBySlug(req.params.slug);
    if (!game) return next();
    const slides = Slides.forGame(game.id);
    const present = req.query.present === '1';
    if (req.editMode && !present) {
      const idx = intOrNull(req.query.slide) ?? 0;
      return sendHtml(res, renderDeckEditor(game, slides, idx));
    }
    sendHtml(res, renderDeckViewer(game, slides));
  });

  // ===== Media serving ====================================================
  // Unique filenames => safe to cache aggressively.
  const serveMedia = (isThumb) => (req, res) => {
    const abs = resolveMediaPath(req.params.file, isThumb);
    if (!abs || !fs.existsSync(abs)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(abs, { acceptRanges: true });
  };
  app.get('/media/thumbs/:file', serveMedia(true));
  app.get('/media/:file', serveMedia(false));

  // ===== Press-kit submission (public) ====================================
  app.post('/press/submit', async (req, res) => {
    const b = req.body || {};
    const press_type = b.press_type === 'editorial' ? 'editorial' : b.press_type === 'creator' ? 'creator' : null;
    if (!press_type) return res.status(400).json({ error: 'Choose a press type.' });
    const email = String(b.email || '').trim();
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    let games = b.games;
    if (typeof games === 'string') games = games ? [games] : [];
    if (!Array.isArray(games)) games = [];
    games = games.map((g) => String(g).slice(0, 200)).slice(0, 50);

    const submission = Submissions.create({
      press_type,
      name: name.slice(0, 200),
      email: email.slice(0, 320),
      outlet: String(b.outlet || '').slice(0, 300),
      outlet_url: String(b.outlet_url || '').slice(0, 2000),
      audience: String(b.audience || '').slice(0, 200),
      role: String(b.role || '').slice(0, 200),
      games,
      message: String(b.message || '').slice(0, 5000),
    });

    // Persisted. Email is best-effort on top.
    try {
      const result = await sendSubmissionEmail(submission);
      if (result.sent) Submissions.markEmailed(submission.id);
    } catch (err) {
      console.error('[press] email error:', err.message);
    }

    res.json({ ok: true });
  });

  // ===== Admin (edit mode only) ===========================================
  app.get('/admin/submissions', (req, res) => {
    if (!req.editMode) return res.status(404).type('html').send('<h1>404 — Not found</h1>');
    sendHtml(res, renderSubmissions(true, Submissions.all()));
  });

  // ===== Edit API (all guarded by requireEdit) ============================
  // --- Games ---
  app.post('/api/games', requireEdit, (req, res) => {
    const game = Games.create({ title: String(req.body.title || 'Untitled Game').slice(0, 200) });
    res.json({ ok: true, game });
  });
  app.patch('/api/games/:id', requireEdit, (req, res) => {
    const id = intOrNull(req.params.id);
    const fields = {};
    if ('title' in req.body) fields.title = String(req.body.title || '').slice(0, 200);
    if ('steam_url' in req.body) fields.steam_url = String(req.body.steam_url || '').slice(0, 2000);
    if ('hero_media' in req.body) {
      const mid = intOrNull(req.body.hero_media);
      fields.hero_media = mid && getMedia(mid) ? mid : null;
    }
    const game = Games.update(id, fields);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json({ ok: true, game });
  });
  app.delete('/api/games/:id', requireEdit, (req, res) => {
    const id = intOrNull(req.params.id);
    if (Site.featuredGameId() === id) Site.setFeaturedGameId(null);
    res.json({ ok: Games.delete(id) });
  });
  app.post('/api/games/reorder', requireEdit, (req, res) => {
    const order = (req.body.order || []).map(intOrNull).filter(Boolean);
    Games.reorder(order);
    res.json({ ok: true });
  });

  // --- Sections ---
  app.post('/api/sections', requireEdit, (req, res) => {
    const { owner_type, owner_id, type } = req.body;
    if (!['game', 'page'].includes(owner_type)) return res.status(400).json({ error: 'Bad owner_type' });
    if (!SECTION_TYPES.includes(type)) return res.status(400).json({ error: 'Bad section type' });
    if (owner_type === 'game' && !Games.get(intOrNull(owner_id))) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const section = Sections.create(owner_type, owner_id, type);
    res.json({ ok: true, section });
  });
  app.patch('/api/sections/:id', requireEdit, (req, res) => {
    const id = intOrNull(req.params.id);
    const section = Sections.get(id);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    const data = sanitizeSectionData(section.type, req.body.data);
    res.json({ ok: true, section: Sections.updateData(id, data) });
  });
  app.delete('/api/sections/:id', requireEdit, (req, res) => {
    res.json({ ok: Sections.delete(intOrNull(req.params.id)) });
  });
  app.post('/api/sections/reorder', requireEdit, (req, res) => {
    const { owner_type, owner_id } = req.body;
    const order = (req.body.order || []).map(intOrNull).filter(Boolean);
    Sections.reorder(owner_type, owner_id, order);
    res.json({ ok: true });
  });

  // --- Team members ---
  app.post('/api/team', requireEdit, (req, res) => {
    res.json({ ok: true, member: Team.create() });
  });
  app.patch('/api/team/:id', requireEdit, (req, res) => {
    const id = intOrNull(req.params.id);
    const fields = {};
    for (const f of ['name', 'title', 'description', 'linkedin_url']) {
      if (f in req.body) fields[f] = String(req.body[f] || '').slice(0, 2000);
    }
    if ('image_media' in req.body) {
      const mid = intOrNull(req.body.image_media);
      fields.image_media = mid && getMedia(mid) ? mid : null;
    }
    const member = Team.update(id, fields);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json({ ok: true, member });
  });
  app.delete('/api/team/:id', requireEdit, (req, res) => {
    res.json({ ok: Team.delete(intOrNull(req.params.id)) });
  });
  app.post('/api/team/reorder', requireEdit, (req, res) => {
    const order = (req.body.order || []).map(intOrNull).filter(Boolean);
    Team.reorder(order);
    res.json({ ok: true });
  });

  // --- Settings (featured game, site title, mission) ---
  app.post('/api/settings', requireEdit, (req, res) => {
    if ('featured_game_id' in req.body) {
      const gid = intOrNull(req.body.featured_game_id);
      Site.setFeaturedGameId(gid && Games.get(gid) ? gid : null);
    }
    if ('site_title' in req.body) Site.setTitle(String(req.body.site_title || '').slice(0, 200));
    if ('mission' in req.body) Site.setMission(sanitizeRichHtml(req.body.mission || ''));
    res.json({ ok: true });
  });

  // --- Media ---
  app.post('/api/media', requireEdit, upload.array('files', 20), async (req, res, next) => {
    try {
      const files = req.files || [];
      const out = [];
      for (const f of files) out.push(await registerUpload(f, req.body.alt || ''));
      res.json({ ok: true, media: out });
    } catch (err) {
      next(err);
    }
  });
  app.patch('/api/media/:id', requireEdit, (req, res) => {
    const media = updateAlt(intOrNull(req.params.id), req.body.alt || '');
    if (!media) return res.status(404).json({ error: 'Media not found' });
    res.json({ ok: true, media });
  });
  app.delete('/api/media/:id', requireEdit, (req, res) => {
    res.json({ ok: deleteMedia(intOrNull(req.params.id)) });
  });

  // --- Slides (pitch deck) ---
  app.post('/api/games/:id/slides', requireEdit, (req, res) => {
    const game = Games.get(intOrNull(req.params.id));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json({ ok: true, slide: Slides.create(game.id) });
  });
  app.put('/api/slides/:id', requireEdit, (req, res) => {
    const id = intOrNull(req.params.id);
    const slide = Slides.get(id);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });
    const blocks = sanitizeBlocks(req.body.blocks);
    res.json({ ok: true, slide: Slides.updateData(id, { blocks }) });
  });
  app.delete('/api/slides/:id', requireEdit, (req, res) => {
    res.json({ ok: Slides.delete(intOrNull(req.params.id)) });
  });
  app.post('/api/games/:id/slides/reorder', requireEdit, (req, res) => {
    const game = Games.get(intOrNull(req.params.id));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    const order = (req.body.order || []).map(intOrNull).filter(Boolean);
    Slides.reorder(game.id, order);
    res.json({ ok: true });
  });
}
