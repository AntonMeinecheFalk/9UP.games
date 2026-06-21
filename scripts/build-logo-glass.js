// One-off asset builder for the homepage "glass logo" landing.
// Derives alpha-mask PNGs from the white 9UP logo silhouette:
//   logo-rim-top.png    — thin SOLID white rim band along the TOP inner edges
//   logo-rim-bottom.png — thin SOLID band along the BOTTOM inner edges (coloured in CSS)
//   logo-outline.png    — a thin outline ring of the whole silhouette (echo layers)
//   logo-reflection.png — the hand-authored reflection texture as an alpha mask
// All carry intensity in the ALPHA channel (RGB = white) so CSS recolours them via
// a solid background behind the alpha. The RIMS are SUPERSAMPLED (3×) so the thin
// line stays crisp when the logo is shown larger than native on hi-DPI screens.
// Run with:  node scripts/build-logo-glass.js
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// The current site logo (settings.site_logo = media id 32) — white, transparent bg.
const SRC = path.join(ROOT, 'media', 'mqjzqx1e-9c0d5bfe2466389c.png');
const OUT = path.join(ROOT, 'public', 'img');

const BASE = 1030;           // the logo's native square resolution
const SC_RIM = 3;            // rim supersample factor (crisp thin line on hi-DPI)
// Depths/thicknesses are expressed at BASE scale, then multiplied by the factor.
const D_TOP = 5;             // top rim-light depth (px @ BASE) — thin solid band
const D_BOT = 5;             // bottom rim depth (px @ BASE) — thin solid band
const T_OUT = 3;             // outline half-thickness (px @ BASE) — thin echo lines

const clampIdx = (v, max) => (v < 0 ? 0 : v > max ? max : v);

// Read the silhouette alpha into a raw array at resolution N (255 = inside shape).
async function loadAlpha(N) {
  const { data, info } = await sharp(SRC)
    .resize(N, N, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  return { A: data, W: info.width, H: info.height };
}

// Pack a single-channel intensity map into white-RGB + alpha=intensity RGBA.
function toRGBA(g, W, H) {
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = 255; buf[i * 4 + 1] = 255; buf[i * 4 + 2] = 255; buf[i * 4 + 3] = g[i];
  }
  return buf;
}

// Directional rim band: each interior pixel within `depth` of an OUTSIDE pixel in
// direction dy gets full alpha (hard=true, sharp inner edge) or a fade (hard=false).
function dirGlow(A, W, H, depth, dy, hard) {
  const inside = (i) => A[i] >= 128;
  const g = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inside(i)) continue;
      for (let k = 1; k <= depth; k++) {
        const yy = y + dy * k;
        if (yy < 0 || yy >= H || !inside(yy * W + x)) {
          g[i] = hard ? 255 : Math.round(((depth - k + 1) / depth) * 255);
          break;
        }
      }
    }
  }
  return g;
}

// Outline ring: a pixel is on the outline if, within T, it neighbours a pixel of
// the opposite inside/outside state (a band straddling the silhouette edge).
function outline(A, W, H, T) {
  const inside = (i) => A[i] >= 128;
  const g = new Uint8ClampedArray(W * H);
  const t2 = T * T;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const me = inside(y * W + x);
      let edge = false;
      for (let dy = -T; dy <= T && !edge; dy++) {
        for (let dx = -T; dx <= T; dx++) {
          if (dx * dx + dy * dy > t2) continue;
          const yy = clampIdx(y + dy, H - 1), xx = clampIdx(x + dx, W - 1);
          if (inside(yy * W + xx) !== me) { edge = true; break; }
        }
      }
      if (edge) g[y * W + x] = 255;
    }
  }
  return g;
}

// Blur + clip a glow back inside the silhouette (dest-in) so a soft blur can't
// halo outside the logo, and write it out.
async function writeClipped(g, A, W, H, blur, file) {
  const shapeRGBA = toRGBA(A, W, H);
  let img = sharp(toRGBA(g, W, H), { raw: { width: W, height: H, channels: 4 } });
  if (blur) img = img.blur(blur);
  const buf = await img.png().toBuffer();
  await sharp(buf)
    .composite([{ input: shapeRGBA, raw: { width: W, height: H, channels: 4 }, blend: 'dest-in' }])
    .png().toFile(path.join(OUT, file));
  console.log('wrote', file, `(${W}px)`);
}

async function main() {
  // Rims — supersampled 3× so the thin band stays crisp when scaled up on hi-DPI.
  // 1px (@BASE) blur → SC_RIM px here = proper anti-aliasing, still crisp.
  const r = await loadAlpha(BASE * SC_RIM);
  await writeClipped(dirGlow(r.A, r.W, r.H, D_TOP * SC_RIM, -1, true), r.A, r.W, r.H, 1.0 * SC_RIM, 'logo-rim-top.png');
  await writeClipped(dirGlow(r.A, r.W, r.H, D_BOT * SC_RIM, +1, true), r.A, r.W, r.H, 1.0 * SC_RIM, 'logo-rim-bottom.png');

  // Outline (echoes) — native res is plenty for the faint, soft echo lines.
  const o = await loadAlpha(BASE);
  await writeClipped(outline(o.A, o.W, o.H, T_OUT), o.A, o.W, o.H, 1.1, 'logo-outline.png');

  // Reflection mask: hand-authored B&W texture → luminance becomes ALPHA (RGB
  // white). White = hero art shows; black = frosted glass shows.
  const reflSrc = path.join(__dirname, 'reflection-src.png');
  const RS = 1400;
  const { data: L, info: li } = await sharp(reflSrc)
    .resize(RS, RS, { fit: 'cover' }).greyscale().toColourspace('b-w')
    .raw().toBuffer({ resolveWithObject: true });
  const rb = Buffer.alloc(li.width * li.height * 4);
  for (let i = 0; i < li.width * li.height; i++) {
    rb[i * 4] = 255; rb[i * 4 + 1] = 255; rb[i * 4 + 2] = 255; rb[i * 4 + 3] = L[i];
  }
  await sharp(rb, { raw: { width: li.width, height: li.height, channels: 4 } })
    .png().toFile(path.join(OUT, 'logo-reflection.png'));
  console.log('wrote logo-reflection.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
