// Data-access helpers over the SQLite tables. Routes and renderers use these
// rather than touching SQL directly.
import { db, nowISO, getSetting, setSetting } from './db.js';

// --- slug helper ------------------------------------------------------------
export function slugify(text, fallback = 'game') {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

function uniqueSlug(desired, excludeId = null) {
  let slug = slugify(desired);
  let n = 1;
  const q = db.prepare('SELECT id FROM games WHERE slug = ? AND id != ?');
  while (q.get(slug, excludeId || 0)) {
    n += 1;
    slug = `${slugify(desired)}-${n}`;
  }
  return slug;
}

// --- games ------------------------------------------------------------------
export const Games = {
  all() {
    return db.prepare('SELECT * FROM games ORDER BY position, id').all();
  },
  get(id) {
    return db.prepare('SELECT * FROM games WHERE id = ?').get(id) || null;
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM games WHERE slug = ?').get(slug) || null;
  },
  create({ title = 'Untitled Game' } = {}) {
    const ts = nowISO();
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM games').get().m;
    const slug = uniqueSlug(title);
    const info = db
      .prepare(
        `INSERT INTO games (title, slug, steam_url, position, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?)`
      )
      .run(title, slug, maxPos + 1, ts, ts);
    return this.get(info.lastInsertRowid);
  },
  update(id, fields) {
    const game = this.get(id);
    if (!game) return null;
    const next = {
      title: fields.title ?? game.title,
      hero_media: fields.hero_media === undefined ? game.hero_media : fields.hero_media,
      steam_url: fields.steam_url ?? game.steam_url,
    };
    let slug = game.slug;
    if (fields.title !== undefined && fields.title !== game.title) {
      slug = uniqueSlug(fields.title, id);
    }
    db.prepare(
      `UPDATE games SET title = ?, slug = ?, hero_media = ?, steam_url = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.title, slug, next.hero_media, next.steam_url, nowISO(), id);
    return this.get(id);
  },
  delete(id) {
    return db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;
  },
  reorder(orderedIds) {
    const stmt = db.prepare('UPDATE games SET position = ? WHERE id = ?');
    const tx = db.transaction((ids) => ids.forEach((gid, i) => stmt.run(i, gid)));
    tx(orderedIds);
  },
};

// --- sections ---------------------------------------------------------------
export const SECTION_TYPES = ['text', 'carousel', 'video', 'buttons'];

function defaultSectionData(type) {
  switch (type) {
    case 'text':
      return { html: '<p>New text section. Click to edit.</p>' };
    case 'carousel':
      return { images: [] }; // [{ mediaId, alt }]
    case 'video':
      return { mode: 'url', url: '', mediaId: null };
    case 'buttons':
      return { buttons: [] }; // [{ label, url }]
    default:
      return {};
  }
}

export const Sections = {
  list(ownerType, ownerId) {
    return db
      .prepare(
        'SELECT * FROM sections WHERE owner_type = ? AND owner_id = ? ORDER BY position, id'
      )
      .all(ownerType, String(ownerId))
      .map(parseSection);
  },
  get(id) {
    const row = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    return row ? parseSection(row) : null;
  },
  create(ownerType, ownerId, type) {
    if (!SECTION_TYPES.includes(type)) throw new Error('Invalid section type');
    const maxPos = db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS m FROM sections WHERE owner_type = ? AND owner_id = ?'
      )
      .get(ownerType, String(ownerId)).m;
    const info = db
      .prepare(
        `INSERT INTO sections (owner_type, owner_id, type, position, data)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(ownerType, String(ownerId), type, maxPos + 1, JSON.stringify(defaultSectionData(type)));
    return this.get(info.lastInsertRowid);
  },
  updateData(id, data) {
    db.prepare('UPDATE sections SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
    return this.get(id);
  },
  delete(id) {
    return db.prepare('DELETE FROM sections WHERE id = ?').run(id).changes > 0;
  },
  reorder(ownerType, ownerId, orderedIds) {
    const stmt = db.prepare(
      'UPDATE sections SET position = ? WHERE id = ? AND owner_type = ? AND owner_id = ?'
    );
    const tx = db.transaction((ids) =>
      ids.forEach((sid, i) => stmt.run(i, sid, ownerType, String(ownerId)))
    );
    tx(orderedIds);
  },
};

function parseSection(row) {
  let data = {};
  try {
    data = JSON.parse(row.data);
  } catch {
    data = {};
  }
  return { ...row, data };
}

// --- team members -----------------------------------------------------------
export const Team = {
  all() {
    return db.prepare('SELECT * FROM team_members ORDER BY position, id').all();
  },
  get(id) {
    return db.prepare('SELECT * FROM team_members WHERE id = ?').get(id) || null;
  },
  create() {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM team_members').get().m;
    const info = db
      .prepare('INSERT INTO team_members (position) VALUES (?)')
      .run(maxPos + 1);
    return this.get(info.lastInsertRowid);
  },
  update(id, fields) {
    const m = this.get(id);
    if (!m) return null;
    db.prepare(
      `UPDATE team_members SET name = ?, title = ?, description = ?, linkedin_url = ?, image_media = ?
       WHERE id = ?`
    ).run(
      fields.name ?? m.name,
      fields.title ?? m.title,
      fields.description ?? m.description,
      fields.linkedin_url ?? m.linkedin_url,
      fields.image_media === undefined ? m.image_media : fields.image_media,
      id
    );
    return this.get(id);
  },
  delete(id) {
    return db.prepare('DELETE FROM team_members WHERE id = ?').run(id).changes > 0;
  },
  reorder(orderedIds) {
    const stmt = db.prepare('UPDATE team_members SET position = ? WHERE id = ?');
    const tx = db.transaction((ids) => ids.forEach((mid, i) => stmt.run(i, mid)));
    tx(orderedIds);
  },
};

// --- slides (pitch deck) ----------------------------------------------------
export const Slides = {
  forGame(gameId) {
    return db
      .prepare('SELECT * FROM slides WHERE game_id = ? ORDER BY position, id')
      .all(gameId)
      .map(parseSlide);
  },
  get(id) {
    const row = db.prepare('SELECT * FROM slides WHERE id = ?').get(id);
    return row ? parseSlide(row) : null;
  },
  create(gameId) {
    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM slides WHERE game_id = ?')
      .get(gameId).m;
    const info = db
      .prepare('INSERT INTO slides (game_id, position, data) VALUES (?, ?, ?)')
      .run(gameId, maxPos + 1, JSON.stringify({ blocks: [] }));
    return this.get(info.lastInsertRowid);
  },
  updateData(id, data) {
    db.prepare('UPDATE slides SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
    return this.get(id);
  },
  delete(id) {
    return db.prepare('DELETE FROM slides WHERE id = ?').run(id).changes > 0;
  },
  reorder(gameId, orderedIds) {
    const stmt = db.prepare('UPDATE slides SET position = ? WHERE id = ? AND game_id = ?');
    const tx = db.transaction((ids) => ids.forEach((sid, i) => stmt.run(i, sid, gameId)));
    tx(orderedIds);
  },
};

function parseSlide(row) {
  let data = { blocks: [] };
  try {
    data = JSON.parse(row.data);
  } catch {
    data = { blocks: [] };
  }
  if (!Array.isArray(data.blocks)) data.blocks = [];
  return { ...row, data };
}

// --- submissions ------------------------------------------------------------
export const Submissions = {
  all() {
    return db.prepare('SELECT * FROM submissions ORDER BY created_at DESC, id DESC').all();
  },
  get(id) {
    return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) || null;
  },
  create(fields) {
    const info = db
      .prepare(
        `INSERT INTO submissions
         (press_type, name, email, outlet, outlet_url, audience, role, games, message, created_at)
         VALUES (@press_type, @name, @email, @outlet, @outlet_url, @audience, @role, @games, @message, @created_at)`
      )
      .run({
        press_type: fields.press_type,
        name: fields.name || '',
        email: fields.email || '',
        outlet: fields.outlet || '',
        outlet_url: fields.outlet_url || '',
        audience: fields.audience || '',
        role: fields.role || '',
        games: JSON.stringify(fields.games || []),
        message: fields.message || '',
        created_at: nowISO(),
      });
    return this.get(info.lastInsertRowid);
  },
  markEmailed(id) {
    db.prepare('UPDATE submissions SET emailed = 1 WHERE id = ?').run(id);
  },
};

// --- site settings convenience ---------------------------------------------
export const Site = {
  title: () => getSetting('site_title', '9UP Games'),
  setTitle: (v) => setSetting('site_title', v),
  mission: () => getSetting('about_mission', ''),
  setMission: (v) => setSetting('about_mission', v),
  featuredGameId: () => {
    const v = getSetting('featured_game_id', '');
    return v ? parseInt(v, 10) : null;
  },
  setFeaturedGameId: (v) => setSetting('featured_game_id', v ? String(v) : ''),
};
