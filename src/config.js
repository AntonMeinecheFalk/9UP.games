// Loads configuration from environment + an optional .env file (no dependency).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// --- minimal .env loader (does not override real environment variables) -----
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

function bool(v, def = false) {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const EDIT_SECRET = process.env.EDIT_SECRET || '';
if (!EDIT_SECRET || EDIT_SECRET === 'change-me-to-a-long-random-string') {
  console.warn(
    '[config] WARNING: EDIT_SECRET is not set (or is the default). ' +
      'Edit mode is effectively disabled until you set a strong EDIT_SECRET in .env.'
  );
}

// Signing key for the edit-session cookie. Derive from EDIT_SECRET if not set
// so sessions stay stable across restarts without extra configuration.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (EDIT_SECRET
    ? crypto.createHash('sha256').update('9up:' + EDIT_SECRET).digest('hex')
    : crypto.randomBytes(32).toString('hex'));

function resolvePath(p, fallback) {
  const value = p || fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',

  editSecret: EDIT_SECRET,
  sessionSecret: SESSION_SECRET,
  sessionHours: parseFloat(process.env.SESSION_HOURS || '8'),
  secureCookies: bool(process.env.SECURE_COOKIES, false),

  dbPath: resolvePath(process.env.DB_PATH, './data/site.db'),
  mediaDir: resolvePath(process.env.MEDIA_DIR, './media'),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '300', 10),

  email: {
    provider: (process.env.EMAIL_PROVIDER || '').toLowerCase(),
    apiKey: process.env.EMAIL_API_KEY || '',
    to: process.env.EMAIL_TO || 'contact@9up.games',
    from: process.env.EMAIL_FROM || 'noreply@9up.games',
  },
};

export const editConfigured = Boolean(
  EDIT_SECRET && EDIT_SECRET !== 'change-me-to-a-long-random-string'
);
