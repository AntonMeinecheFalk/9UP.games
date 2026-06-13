// Media handling: uploads land on disk under MEDIA_DIR; only paths + metadata
// go in SQLite. Originals are ALWAYS preserved at full resolution. Thumbnails
// are generated as *separate* assets (best-effort via sharp) and never replace
// the original. If sharp is unavailable the app still works, just without
// generated thumbnails.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { db, nowISO } from './db.js';

fs.mkdirSync(config.mediaDir, { recursive: true });
const ORIGINALS_DIR = config.mediaDir;
const THUMBS_DIR = path.join(config.mediaDir, 'thumbs');
fs.mkdirSync(THUMBS_DIR, { recursive: true });

// Try to load sharp; degrade gracefully if it fails to install on some Pi.
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch (err) {
  console.warn(
    '[media] sharp not available — thumbnails disabled, originals served as-is. ' +
      `(${err.message})`
  );
}

const IMAGE_MIMES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
const VIDEO_MIMES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
};

export function kindForMime(mime) {
  if (IMAGE_MIMES[mime]) return 'image';
  if (VIDEO_MIMES[mime]) return 'video';
  return null;
}

function extForMime(mime) {
  return IMAGE_MIMES[mime] || VIDEO_MIMES[mime] || 'bin';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ORIGINALS_DIR),
  filename: (req, file, cb) => {
    const ext = extForMime(file.mimetype);
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    cb(null, name);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (kindForMime(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: images and common video formats.'));
  },
});

const _insertMedia = db.prepare(`
  INSERT INTO media (filename, original_name, mime, kind, size, width, height, thumb, alt, created_at)
  VALUES (@filename, @original_name, @mime, @kind, @size, @width, @height, @thumb, @alt, @created_at)
`);
const _getMedia = db.prepare('SELECT * FROM media WHERE id = ?');
const _deleteMedia = db.prepare('DELETE FROM media WHERE id = ?');
const _listMedia = db.prepare('SELECT * FROM media ORDER BY id DESC');

export function getMedia(id) {
  if (!id) return null;
  return _getMedia.get(id) || null;
}
export function listMedia() {
  return _listMedia.all();
}

// Process one uploaded file: probe dimensions + generate a thumbnail (images
// only), then record it in the DB. Returns the media row.
export async function registerUpload(file, alt = '') {
  const kind = kindForMime(file.mimetype);
  let width = null;
  let height = null;
  let thumb = null;

  if (kind === 'image' && sharp) {
    try {
      const image = sharp(file.path, { failOn: 'none' });
      const meta = await image.metadata();
      width = meta.width || null;
      height = meta.height || null;
      // Generate a downscaled thumbnail as a SEPARATE file. Original untouched.
      const thumbName = file.filename.replace(/\.[^.]+$/, '') + '.thumb.webp';
      await image
        .rotate() // respect EXIF orientation
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(path.join(THUMBS_DIR, thumbName));
      thumb = thumbName;
    } catch (err) {
      console.warn(`[media] thumbnail/probe failed for ${file.filename}: ${err.message}`);
    }
  }

  const row = {
    filename: file.filename,
    original_name: file.originalname || file.filename,
    mime: file.mimetype,
    kind,
    size: file.size,
    width,
    height,
    thumb,
    alt: String(alt || ''),
    created_at: nowISO(),
  };
  const info = _insertMedia.run(row);
  return getMedia(info.lastInsertRowid);
}

export function deleteMedia(id) {
  const row = getMedia(id);
  if (!row) return false;
  for (const p of [
    path.join(ORIGINALS_DIR, row.filename),
    row.thumb ? path.join(THUMBS_DIR, row.thumb) : null,
  ]) {
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (err) {
        console.warn(`[media] failed to unlink ${p}: ${err.message}`);
      }
    }
  }
  _deleteMedia.run(id);
  return true;
}

export function updateAlt(id, alt) {
  db.prepare('UPDATE media SET alt = ? WHERE id = ?').run(String(alt || ''), id);
  return getMedia(id);
}

// Resolve a media row to public URLs used in markup.
export function mediaUrl(row) {
  return row ? `/media/${row.filename}` : '';
}
export function thumbUrl(row) {
  if (!row) return '';
  return row.thumb ? `/media/thumbs/${row.thumb}` : `/media/${row.filename}`;
}

// Safe absolute path within MEDIA_DIR for serving (prevents path traversal).
export function resolveMediaPath(sub, isThumb = false) {
  const base = isThumb ? THUMBS_DIR : ORIGINALS_DIR;
  const resolved = path.resolve(base, sub);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

export const SHARP_AVAILABLE = Boolean(sharp);
