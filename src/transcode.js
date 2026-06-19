// Video transcoding: normalise uploaded videos into a web-streamable MP4 so our
// custom player can stream them smoothly (faststart = moov atom up front; served
// over HTTP range requests). Videos already in H.264/AAC are losslessly remuxed
// (fast); anything else is re-encoded. A poster frame is auto-extracted.
//
// Jobs run one-at-a-time in a tiny in-process queue (a Pi shouldn't run several
// ffmpeg encodes at once). If ffmpeg is unavailable, uploads still work — the
// original file is served as-is (graceful degradation).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { db } from './db.js';

const ORIGINALS_DIR = config.mediaDir;
const THUMBS_DIR = path.join(config.mediaDir, 'thumbs');

// --- low-level command runners ----------------------------------------------
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d; });
    ps.on('error', reject);
    ps.on('close', (code) =>
      code === 0 ? resolve(stderr) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    );
  });
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      config.ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(-200)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

// Is ffmpeg + ffprobe usable? Cached after the first check.
let availP = null;
export function ffmpegAvailable() {
  if (availP) return availP;
  availP = Promise.all([
    run(config.ffmpegPath, ['-version']).then(() => true).catch(() => false),
    run(config.ffprobePath, ['-version']).then(() => true).catch(() => false),
  ]).then(([a, b]) => a && b);
  return availP;
}

// --- DB statements ----------------------------------------------------------
const _getRow = db.prepare('SELECT * FROM media WHERE id = ?');
const _markReady = db.prepare(
  `UPDATE media SET status = 'ready', playback = @playback,
     thumb = COALESCE(@thumb, thumb), width = COALESCE(@width, width),
     height = COALESCE(@height, height) WHERE id = @id`
);
const _markFailed = db.prepare("UPDATE media SET status = 'failed' WHERE id = ?");

// --- the actual transcode ---------------------------------------------------
async function processVideo(id) {
  const row = _getRow.get(id);
  if (!row || row.kind !== 'video') return;
  const input = path.join(ORIGINALS_DIR, row.filename);
  if (!fs.existsSync(input)) { _markFailed.run(id); return; }

  // No ffmpeg → serve the original untouched so the site still works.
  if (!(await ffmpegAvailable())) {
    _markReady.run({ id, playback: row.filename, thumb: null, width: null, height: null });
    return;
  }

  const base = row.filename.replace(/\.[^.]+$/, '');
  const outName = `${base}.play.mp4`;
  const outPath = path.join(ORIGINALS_DIR, outName);
  const posterName = `${base}.poster.jpg`;
  const posterPath = path.join(THUMBS_DIR, posterName);
  const maxH = config.videoMaxHeight;

  try {
    const meta = await probe(input);
    const v = (meta.streams || []).find((s) => s.codec_type === 'video');
    const a = (meta.streams || []).find((s) => s.codec_type === 'audio');
    const width = v && v.width ? v.width : null;
    const height = v && v.height ? v.height : null;
    const duration = parseFloat(meta.format && meta.format.duration) || 0;
    const container = (meta.format && meta.format.format_name) || '';

    // Already web-ready (H.264 + AAC/none, mp4-ish, within size)? Just remux faststart.
    const compatible =
      v && v.codec_name === 'h264' &&
      (!a || a.codec_name === 'aac') &&
      /mp4|mov|m4a|m4v/.test(container) &&
      height && height <= maxH;

    if (compatible) {
      await run(config.ffmpegPath, ['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', outPath]);
    } else {
      const args = ['-y', '-i', input];
      if (height && height > maxH) args.push('-vf', `scale=-2:${maxH}`); // cap height, keep aspect, even width
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(config.videoCrf), '-pix_fmt', 'yuv420p');
      if (a) args.push('-c:a', 'aac', '-b:a', '128k'); else args.push('-an');
      args.push('-movflags', '+faststart', outPath);
      await run(config.ffmpegPath, args);
    }

    // Auto poster frame (~10% in), max 720p. Optional — failure is non-fatal.
    let thumb = null;
    try {
      const t = Math.min(Math.max(duration * 0.1, 0.5), Math.max(duration - 0.1, 0.5));
      const ph = Math.min(720, height || 720);
      await run(config.ffmpegPath, ['-y', '-ss', t.toFixed(2), '-i', outPath, '-frames:v', '1', '-vf', `scale=-2:${ph}`, posterPath]);
      if (fs.existsSync(posterPath)) thumb = posterName;
    } catch (e) {
      console.warn(`[transcode] poster failed for media ${id}: ${e.message}`);
    }

    _markReady.run({ id, playback: outName, thumb, width, height });
  } catch (err) {
    console.warn(`[transcode] re-encode failed for media ${id}: ${err.message}`);
    // Best effort: serve the original so the video still plays.
    try { _markReady.run({ id, playback: row.filename, thumb: null, width: null, height: null }); }
    catch { _markFailed.run(id); }
  }
}

// --- single-concurrency queue -----------------------------------------------
const queue = [];
let working = false;
async function drain() {
  if (working) return;
  working = true;
  try {
    while (queue.length) await processVideo(queue.shift());
  } finally {
    working = false;
  }
}
export function enqueueTranscode(id) {
  if (!queue.includes(id)) queue.push(id);
  drain();
}

// On boot, resume any job interrupted by a restart.
export function resumePending() {
  try {
    db.prepare("SELECT id FROM media WHERE status = 'processing'").all().forEach((r) => enqueueTranscode(r.id));
  } catch (err) {
    console.warn('[transcode] resumePending failed:', err.message);
  }
}
