// SQLite layer (better-sqlite3). Holds all *structured* content. Binary media
// lives on disk under MEDIA_DIR; only file paths + metadata are stored here.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL'); // better concurrency + crash safety on a Pi
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY,
  filename      TEXT NOT NULL UNIQUE,   -- stored file name on disk (random)
  original_name TEXT,                   -- user's original file name (display only)
  mime          TEXT,
  kind          TEXT,                   -- 'image' | 'video'
  size          INTEGER,
  width         INTEGER,
  height        INTEGER,
  thumb         TEXT,                   -- generated thumbnail file name (nullable)
  alt           TEXT DEFAULT '',        -- accessibility alt text
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'Untitled Game',
  slug        TEXT UNIQUE,
  hero_media  INTEGER REFERENCES media(id) ON DELETE SET NULL,
  logo_media  INTEGER REFERENCES media(id) ON DELETE SET NULL,
  display     TEXT NOT NULL DEFAULT '{}',
  tagline     TEXT NOT NULL DEFAULT '',
  steam_url   TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Sections are reusable across owners: a game page, or a static page
-- ('about', 'presskit'). owner_id is TEXT to hold either a game id or a page key.
CREATE TABLE IF NOT EXISTS sections (
  id          INTEGER PRIMARY KEY,
  owner_type  TEXT NOT NULL,            -- 'game' | 'page'
  owner_id    TEXT NOT NULL,
  type        TEXT NOT NULL,            -- 'text' | 'carousel' | 'video' | 'buttons'
  position    INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sections_owner ON sections(owner_type, owner_id, position);

CREATE TABLE IF NOT EXISTS team_members (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT NOT NULL DEFAULT '',
  image_media  INTEGER REFERENCES media(id) ON DELETE SET NULL,
  position     INTEGER NOT NULL DEFAULT 0
);

-- One slide deck per game. Each slide stores an ordered list of content blocks
-- (reusing the section content types) as JSON.
CREATE TABLE IF NOT EXISTS slides (
  id        INTEGER PRIMARY KEY,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  data      TEXT NOT NULL DEFAULT '{"blocks":[]}'
);
CREATE INDEX IF NOT EXISTS idx_slides_game ON slides(game_id, position);

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY,
  press_type  TEXT NOT NULL,           -- 'creator' | 'editorial'
  name        TEXT,
  email       TEXT,
  outlet      TEXT,                    -- channel / publication name
  outlet_url  TEXT,
  audience    TEXT,                    -- subscriber count / readership
  role        TEXT,                    -- editorial role (nullable)
  games       TEXT,                    -- JSON array of requested game titles
  message     TEXT,
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// --- migrations -------------------------------------------------------------
// Add columns that were introduced after the initial schema, for databases
// created by earlier versions. CREATE TABLE IF NOT EXISTS won't add columns.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('games', 'logo_media', 'INTEGER REFERENCES media(id) ON DELETE SET NULL');
ensureColumn('games', 'display', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('games', 'tagline', "TEXT NOT NULL DEFAULT ''");
// Video processing: status of the transcode job and the streamable MP4 filename.
ensureColumn('media', 'status', "TEXT NOT NULL DEFAULT 'ready'"); // 'ready' | 'processing' | 'failed'
ensureColumn('media', 'playback', 'TEXT'); // web-streamable mp4 filename (videos)

// --- settings helpers -------------------------------------------------------
const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  _setSetting.run(key, value == null ? null : String(value));
}

export function nowISO() {
  return new Date().toISOString();
}

// Fold the write-ahead log back into the main DB file and close cleanly. Call
// on shutdown so that after the service stops, `site.db` is complete on its own
// (no -wal/-shm needed) — important so a backup/copy never misses recent edits.
export function shutdownDb() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn('[db] checkpoint on shutdown failed:', err.message);
  }
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

// --- one-time seed so the first run has sensible empty states ---------------
export function seed() {
  if (getSetting('seeded') === '1') return;
  if (getSetting('about_mission') == null) {
    setSetting(
      'about_mission',
      '<h2>Our mission</h2><p>We make games worth caring about. ' +
        '(Edit this from edit mode.)</p>'
    );
  }
  if (getSetting('site_title') == null) setSetting('site_title', '9UP Games');
  if (getSetting('featured_game_id') == null) setSetting('featured_game_id', '');
  setSetting('seeded', '1');
}

seed();
