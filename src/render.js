// Server-side HTML rendering. Public output is read-only; when editMode is true
// we add data-attributes and control bars that the client edit.js wires up.
// All dynamic text is escaped; rich text is sanitized at save time.
import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml, safeUrl } from './sanitize.js';
import { getMedia, mediaUrl, thumbUrl } from './media.js';
import { ROOT } from './config.js';
import {
  Site,
  DEFAULT_THEME,
  THEME_COLOR_KEYS,
  THEME_FONT_KEYS,
  FONTS,
  fontById,
  parseDisplay,
} from './models.js';

// The triangle glyph used by every .glass-arrow (carousel + pitch deck).
// Direction (flip) and the hover hole are handled in CSS.
export const triSvg = () =>
  '<svg class="glass-arrow__tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6 L17.5 12 L9 18 Z"/></svg>';

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const THEME_LABELS = {
  bg: 'Background',
  surface: 'Panels & cards',
  text: 'Text',
  muted: 'Muted text',
  border: 'Borders & lines',
  accent: 'Primary accent',
  accent2: 'Secondary accent',
  btnHighlight: 'Button highlight',
  btnShadow: 'Button shadow',
};
const FONT_LABELS = { headingFont: 'Heading font', bodyFont: 'Body font' };

// "#0e0f13" / "#abc" -> "14,15,19" for use in rgba(). Falls back to the default
// background so the hero gradient always has valid components.
function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) h = DEFAULT_THEME.bg.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Build the <style> that maps the saved palette + fonts onto the CSS custom
// properties. Each colour is re-validated as hex here as a defence in depth.
function themeStyle(theme) {
  const safe = (k) => (HEX_RE.test(String(theme[k])) ? theme[k] : DEFAULT_THEME[k]);
  const headingStack = fontById(theme.headingFont).stack;
  const bodyStack = fontById(theme.bodyFont).stack;
  return `<style id="theme-vars">:root{` +
    `--bg:${safe('bg')};` +
    `--bg-rgb:${hexToRgb(safe('bg'))};` +
    `--bg-card:${safe('surface')};` +
    `--bg-elev:${safe('surface')};` +
    `--fg:${safe('text')};` +
    `--fg-muted:${safe('muted')};` +
    `--border:${safe('border')};` +
    `--accent:${safe('accent')};` +
    `--accent-2:${safe('accent2')};` +
    `--btn-highlight:${safe('btnHighlight')};` +
    `--btn-shadow:${safe('btnShadow')};` +
    `--font-heading:${headingStack};` +
    `--font-body:${bodyStack};` +
    // Parallax amount → max object-position-Y pan in % (no scaling). 0 = none.
    `--hero-parallax-max:${(Site.parallax() / 100 * 60).toFixed(1)};` +
    `}</style>`;
}

// Inject the Google Fonts stylesheet only for the selected non-system fonts.
function googleFontsLink(theme) {
  const families = [];
  for (const key of THEME_FONT_KEYS) {
    const f = fontById(theme[key]);
    if (f.google && !families.includes(f.google)) families.push(f.google);
  }
  if (!families.length) return '';
  const q = families.map((f) => 'family=' + f).join('&');
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`
  );
}

// Append a content-version query (?v=<mtime>) to a static asset URL so browsers
// and the Cloudflare edge fetch the new file immediately after a deploy, instead
// of serving a stale cached copy. Falls back to the bare URL if the file is
// missing. `rel` is relative to the public/ dir, e.g. 'css/styles.css'.
function assetUrl(rel) {
  try {
    const mtime = fs.statSync(path.join(ROOT, 'public', rel)).mtimeMs;
    return `/${rel}?v=${Math.floor(mtime).toString(36)}`;
  } catch {
    return `/${rel}`;
  }
}

// --- page shell -------------------------------------------------------------
export function layout({ title, body, editMode, extraHead = '', bodyClass = '' }) {
  const siteTitle = escapeHtml(Site.title());
  const pageTitle = title ? `${escapeHtml(title)} — ${siteTitle}` : siteTitle;
  const theme = Site.theme();
  const siteLogo = getMedia(Site.siteLogoId());
  // Shared nav links — used by the in-header desktop nav AND the mobile dropdown
  // (the dropdown lives OUTSIDE the header so its backdrop-filter can blur the
  // page; a backdrop-filter nested inside the blurred header is isolated).
  const navLinks =
    '<a href="/">Home</a>' +
    '<a href="/games">Games</a>' +
    '<a href="/about">About</a>' +
    '<a href="/press">Press Kit</a>' +
    (editMode
      ? '<a class="nav-edit" href="/admin/submissions">Key requests</a>' +
        '<a class="nav-edit nav-exit" href="/logout">Exit edit</a>'
      : '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${pageTitle}</title>
<!-- Colour the iOS Safari status bar to the header's glass tone (sampled from the
     target mockup) so the status-bar strip and the header read as one continuous
     bar in a tab. -->
<meta name="theme-color" content="#4990ab">
<!-- Added to Home Screen: run fullscreen with a translucent status bar so the
     hero art bleeds up behind it (the top inset iOS only exposes in standalone). -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${siteTitle}">
${googleFontsLink(theme)}
<link rel="stylesheet" href="${assetUrl('css/styles.css')}">
${themeStyle(theme)}
${extraHead}
</head>
<body class="${bodyClass}${editMode ? ' is-edit' : ''}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <div class="brand-group">
      <a class="brand" href="/">
        ${siteLogo ? `<img class="brand__logo" src="${escapeHtml(mediaUrl(siteLogo))}" alt="">` : ''}
        <span>${siteTitle}</span>
      </a>
      ${
        editMode
          ? `<span class="brand-edit">
               <button type="button" class="ctl" data-action="site-logo">${siteLogo ? 'Change' : 'Add'} logo</button>
               ${siteLogo ? '<button type="button" class="ctl ctl--danger" data-action="site-logo-remove" title="Remove logo">✕</button>' : ''}
             </span>`
          : ''
      }
    </div>
    <button type="button" class="nav-toggle" data-nav-toggle aria-label="Menu" aria-expanded="false" aria-controls="site-nav">
      <span class="nav-toggle__bars" aria-hidden="true"></span>
    </button>
    <nav class="site-nav" aria-label="Primary">${navLinks}</nav>
  </div>
</header>
<nav class="site-nav-drop" id="site-nav" aria-label="Menu">${navLinks}</nav>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <span>&copy; ${siteTitle}</span>
    ${editMode ? '<a href="/logout" class="muted">Exit edit mode</a>' : ''}
  </div>
</footer>
${editMode ? themePanel(theme) : ''}
<script src="${assetUrl('js/app.js')}" defer></script>
${editMode ? `<script src="${assetUrl('js/edit.js')}" defer></script>` : ''}
</body>
</html>`;
}

// Floating palette + fonts editor (edit mode only). Live-previews + persists.
function themePanel(theme) {
  const colorRows = THEME_COLOR_KEYS.map(
    (k) => `<label class="theme-row">
      <span>${THEME_LABELS[k]}</span>
      <input type="color" data-theme-key="${k}" value="${escapeHtml(theme[k])}">
    </label>`
  ).join('');
  const fontOptions = (selected) =>
    FONTS.map(
      (f) => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
    ).join('');
  const fontRows = THEME_FONT_KEYS.map(
    (k) => `<label class="theme-row">
      <span>${FONT_LABELS[k]}</span>
      <select data-theme-font="${k}">${fontOptions(theme[k])}</select>
    </label>`
  ).join('');
  return `<button type="button" class="theme-toggle" data-action="theme-toggle" title="Edit site theme" aria-label="Edit site theme">🎨</button>
<div class="theme-panel" data-theme-panel hidden>
  <div class="theme-panel__head">
    <strong>Site theme</strong>
    <button type="button" class="ctl" data-action="theme-close" aria-label="Close">✕</button>
  </div>
  <p class="theme-panel__hint">Recolor and re-font the whole site. Changes preview live and save automatically.</p>
  <div class="theme-panel__group">Palette</div>
  ${colorRows}
  <div class="theme-panel__group">Fonts</div>
  ${fontRows}
  <div class="theme-panel__group">Motion</div>
  <label class="theme-row">
    <span>Hero parallax</span>
    <input type="range" data-parallax min="0" max="100" step="1" value="${Site.parallax()}">
  </label>
  <button type="button" class="ctl theme-panel__reset" data-action="theme-reset">Reset to defaults</button>
</div>`;
}

// --- hero --------------------------------------------------------------------
export function renderHero(game, editMode) {
  if (!game) return '';
  const hero = getMedia(game.hero_media);
  const logo = getMedia(game.logo_media);
  const d = parseDisplay(game.display);
  const steam = safeUrl(game.steam_url);

  // Hero image is a real <img> (object-fit: cover) so object-position controls
  // crop/focus and a scale transform controls zoom.
  const heroImg = hero
    ? `<div class="hero__bg" style="--hero-url:url('${escapeHtml(mediaUrl(hero))}')"><img class="hero__media" src="${escapeHtml(
        mediaUrl(hero)
      )}" alt="" aria-hidden="true"
         style="--focus-x:${d.heroPosX}%;--focus-y:${d.heroPosY}%;--hero-zoom:${d.heroZoom / 100};--m-hero-zoom:${
        d.mHeroZoom / 100
      };--m-hero-x:${d.mHeroX}%;--m-hero-y:${d.mHeroY}%"></div>`
    : '';

  // When a logo exists, it IS the visual title; the text <h1> is kept only for
  // SEO/accessibility (visually hidden in BOTH modes so the edit layout matches
  // the public layout exactly). The title is editable via the tools card.
  const titleClass = logo ? 'hero__title sr-only' : 'hero__title';
  const logoHtml = logo
    ? `<img class="hero__logo" src="${escapeHtml(mediaUrl(logo))}" alt="${escapeHtml(game.title)}"
         style="--logo-scale:${d.logoScale / 100};--logo-y:${d.logoY}px;transform:translate(${d.logoX}px, calc(-50% + ${d.logoY}px)) scale(${d.logoScale / 100})">`
    : '';

  // Each control: a coarse slider, plus a "fine" slider (hidden until precision
  // mode) whose value is added at 0.1× for ~10× less sensitivity.
  const range = (key, label, min, max, step = 1) =>
    `<label class="hero-adjust__row"><span>${label}</span>
       <input type="range" data-hero-ctl="${key}" data-game-id="${game.id}" min="${min}" max="${max}" step="${step}" value="${d[key]}">
       <input type="range" class="hero-adjust__fine" data-hero-fine="${key}" data-game-id="${game.id}" min="-200" max="200" step="1" value="0" aria-label="${label} fine adjust" hidden>
     </label>`;

  // Elevator pitch. In edit mode it looks EXACTLY like the public prose (so the
  // layout is identical while positioning the logo); clicking it turns the same
  // element into an inline editor with a floating toolbar (see edit.js).
  const tagline = game.tagline || '';
  const pitch = editMode
    ? `<div class="hero__pitch prose" data-tagline-edit data-game-id="${game.id}" data-empty="${
        tagline ? '' : '1'
      }" title="Click to edit">${tagline || '<p class="muted">Click to add an elevator pitch…</p>'}</div>`
    : tagline
    ? `<div class="hero__pitch prose">${tagline}</div>`
    : '';

  return `<section class="hero ${hero ? '' : 'hero--empty'}" data-game-id="${game.id}">
  ${heroImg}
  <div class="hero__overlay">
    <div class="hero__inner wrap">
      <div class="hero__panel">
        <div class="hero__panel-left">
          ${logoHtml}
          <h1 class="${titleClass}">${escapeHtml(game.title)}</h1>
          <div class="hero__buttons">
            <a class="btn btn--primary" href="/game/${escapeHtml(game.slug)}/deck">Pitch Deck</a>
            ${
              steam
                ? `<a class="btn btn--secondary" href="${escapeHtml(steam)}" target="_blank" rel="noopener">Steam Page</a>`
                : editMode
                ? '<span class="btn btn--ghost" data-hint="steam">Steam Page (set URL →)</span>'
                : ''
            }
          </div>
        </div>
        ${pitch}
      </div>
    </div>
  </div>
  ${
    editMode
      ? `<div class="hero__tools">
           <div class="hero__edit">
             <button type="button" class="ctl" data-action="hero-image" data-game-id="${game.id}">Change hero image</button>
             <button type="button" class="ctl" data-action="game-logo" data-game-id="${game.id}">${
          logo ? 'Change logo' : 'Add logo'
        }</button>
             ${
               logo
                 ? `<button type="button" class="ctl ctl--danger" data-action="game-logo-remove" data-game-id="${game.id}">Remove logo</button>`
                 : ''
             }
             <button type="button" class="ctl" data-action="hero-adjust-toggle" data-game-id="${game.id}">Adjust hero &amp; logo</button>
             <label class="ctl-inline">Title
               <input type="text" data-edit-field="title-input" data-game-id="${game.id}" value="${escapeHtml(
          game.title
        )}" placeholder="Game title">
             </label>
             <label class="ctl-inline">Steam URL
               <input type="url" data-edit-field="steam_url" data-game-id="${game.id}" value="${escapeHtml(
          game.steam_url
        )}" placeholder="https://store.steampowered.com/...">
             </label>
           </div>
           <div class="hero-adjust" data-hero-adjust hidden>
             <label class="hero-adjust__precision"><input type="checkbox" data-hero-precision> Precision mode (fine nudge)</label>
             ${
               hero
                 ? `<div class="hero-adjust__group"><strong>Hero image — desktop</strong>
                      ${range('heroPosX', 'Focus ←→', 0, 100)}
                      ${range('heroPosY', 'Focus ↑↓', 0, 100)}
                      ${range('heroZoom', 'Zoom', 100, 300)}
                    </div>
                    <div class="hero-adjust__group"><strong>Hero image — mobile</strong>
                      ${range('mHeroZoom', 'Zoom', 100, 300)}
                      ${range('mHeroX', 'Pan ←→', 0, 100)}
                      ${range('mHeroY', 'Pan ↑↓', -100, 100)}
                    </div>`
                 : '<p class="muted">Add a hero image to adjust its crop.</p>'
             }
             ${
               logo
                 ? `<div class="hero-adjust__group"><strong>Logo</strong>
                      ${range('logoScale', 'Size', 20, 400)}
                      ${range('logoX', 'Move ←→', -600, 600)}
                      ${range('logoY', 'Move ↑↓', -600, 600)}
                    </div>`
                 : ''
             }
           </div>
         </div>`
      : ''
  }
</section>`;
}

// --- games catalogue carousel -----------------------------------------------
// Full-screen swipeable browse through every game. Animated by app.js.
export function renderGamesCarousel(games) {
  if (!games.length) {
    return `<div class="games-empty wrap"><p class="muted">No games in the catalogue yet.</p></div>`;
  }
  const slides = games
    .map((game) => {
      const hero = getMedia(game.hero_media);
      const logo = getMedia(game.logo_media);
      const bg = hero ? `style="background-image:url('${escapeHtml(mediaUrl(hero))}')"` : '';
      const steam = safeUrl(game.steam_url);
      const heading = logo
        ? `<img class="game-slide__logo" src="${escapeHtml(mediaUrl(logo))}" alt="${escapeHtml(
            game.title
          )}"><h2 class="game-slide__title sr-only">${escapeHtml(game.title)}</h2>`
        : `<h2 class="game-slide__title">${escapeHtml(game.title)}</h2>`;
      return `<article class="game-slide ${hero ? '' : 'game-slide--empty'}" ${bg}>
        <div class="game-slide__overlay">
          <div class="wrap">
            ${heading}
            <div class="game-slide__actions">
              <a class="btn btn--primary" href="/game/${escapeHtml(game.slug)}">View game</a>
              <a class="btn btn--secondary" href="/game/${escapeHtml(game.slug)}/deck">Pitch Deck</a>
              ${
                steam
                  ? `<a class="btn btn--secondary" href="${escapeHtml(steam)}" target="_blank" rel="noopener">Steam</a>`
                  : ''
              }
            </div>
          </div>
        </div>
      </article>`;
    })
    .join('');

  const dots = games
    .map((g, i) => `<button class="games-dot ${i === 0 ? 'is-active' : ''}" data-goto="${i}" aria-label="Go to ${escapeHtml(
      g.title
    )}"></button>`)
    .join('');

  return `<div class="games-carousel" data-games-carousel tabindex="0" aria-roledescription="carousel">
    <div class="games-track">${slides}</div>
    ${
      games.length > 1
        ? `<button class="games-nav games-prev" data-games-prev aria-label="Previous game">‹</button>
           <button class="games-nav games-next" data-games-next aria-label="Next game">›</button>
           <div class="games-dots">${dots}</div>`
        : ''
    }
  </div>`;
}

// --- sections ---------------------------------------------------------------
export function renderSection(section, editMode) {
  let inner = '';
  switch (section.type) {
    case 'text':
      inner = renderText(section, editMode);
      break;
    case 'carousel':
      inner = renderCarousel(section, editMode);
      break;
    case 'video':
      inner = renderVideo(section, editMode);
      break;
    case 'buttons':
      inner = renderButtons(section, editMode);
      break;
    default:
      inner = '';
  }
  const controls = editMode
    ? `<div class="sec-ctl">
         <span class="sec-ctl__label">${escapeHtml(section.type)}</span>
         <button type="button" class="ctl" data-action="move-up" title="Move up">↑</button>
         <button type="button" class="ctl" data-action="move-down" title="Move down">↓</button>
         <button type="button" class="ctl ctl--danger" data-action="delete-section" title="Delete">✕</button>
       </div>`
    : '';
  return `<section class="section section--${section.type}" data-section-id="${section.id}" data-section-type="${section.type}">
    ${controls}
    <div class="section__body">${inner}</div>
  </section>`;
}

function renderText(section, editMode) {
  const html = section.data.html || '';
  if (editMode) {
    return `<div class="richtext" data-richtext data-section-id="${section.id}">
      <div class="richtext__toolbar" aria-hidden="true">
        <button type="button" data-cmd="bold"><b>B</b></button>
        <button type="button" data-cmd="italic"><i>I</i></button>
        <button type="button" data-cmd="h2">H2</button>
        <button type="button" data-cmd="h3">H3</button>
        <button type="button" data-cmd="ul">• List</button>
        <button type="button" data-cmd="link">Link</button>
        <button type="button" data-cmd="save" class="richtext__save">Save</button>
      </div>
      <div class="richtext__area prose" contenteditable="true">${html}</div>
    </div>`;
  }
  return `<div class="prose">${html}</div>`;
}

function renderCarousel(section, editMode) {
  const images = Array.isArray(section.data.images) ? section.data.images : [];
  const slides = images
    .map((img, i) => {
      const m = getMedia(img.mediaId);
      if (!m) return '';
      const alt = escapeHtml(img.alt || m.alt || '');
      return `<figure class="carousel__slide ${i === 0 ? 'is-active' : ''}" data-index="${i}">
        <img src="${escapeHtml(mediaUrl(m))}" alt="${alt}" loading="lazy">
        ${
          editMode
            ? `<figcaption class="carousel__edit">
                 <input type="text" data-img-alt="${img.mediaId}" value="${alt}" placeholder="Alt text" aria-label="Alt text">
                 <button type="button" class="ctl ctl--danger" data-action="carousel-remove" data-media-id="${img.mediaId}">Remove</button>
               </figcaption>`
            : ''
        }
      </figure>`;
    })
    .join('');

  const controls =
    images.length > 1
      ? `<button class="glass-arrow glass-arrow--prev carousel__prev" aria-label="Previous">${triSvg()}</button>
         <button class="glass-arrow glass-arrow--next carousel__next" aria-label="Next">${triSvg()}</button>`
      : '';

  return `<div class="carousel" data-carousel data-section-id="${section.id}">
    <div class="carousel__track">${slides || '<p class="muted">No images yet.</p>'}</div>
    ${controls}
    ${
      editMode
        ? `<div class="carousel__add"><button type="button" class="ctl" data-action="carousel-add" data-section-id="${section.id}">Upload images</button></div>`
        : ''
    }
  </div>`;
}

function renderVideo(section, editMode) {
  const d = section.data || {};
  let player = '<p class="muted">No video set.</p>';
  if (d.mode === 'url' && d.url) {
    const embed = toEmbedUrl(d.url);
    if (embed) {
      player = `<div class="video-frame"><iframe src="${escapeHtml(
        embed
      )}" title="Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    } else {
      player = `<p class="muted">Unsupported video URL.</p>`;
    }
  } else if (d.mode === 'file' && d.mediaId) {
    const m = getMedia(d.mediaId);
    if (m) {
      player = `<div class="video-frame"><video controls preload="metadata" playsinline>
        <source src="${escapeHtml(mediaUrl(m))}" type="${escapeHtml(m.mime)}">
      </video></div>`;
    }
  }
  if (!editMode) return player;
  return `${player}
  <div class="video-edit" data-video-edit data-section-id="${section.id}">
    <div class="seg">
      <label><input type="radio" name="vmode-${section.id}" value="url" ${
    d.mode !== 'file' ? 'checked' : ''
  }> Embed URL</label>
      <label><input type="radio" name="vmode-${section.id}" value="file" ${
    d.mode === 'file' ? 'checked' : ''
  }> Uploaded file</label>
    </div>
    <div class="video-edit__url" ${d.mode === 'file' ? 'hidden' : ''}>
      <input type="url" data-video-url value="${escapeHtml(d.url || '')}" placeholder="YouTube or Vimeo URL">
    </div>
    <div class="video-edit__file" ${d.mode === 'file' ? '' : 'hidden'}>
      <button type="button" class="ctl" data-action="video-upload" data-section-id="${section.id}">Upload video file</button>
    </div>
    <button type="button" class="ctl" data-action="video-save" data-section-id="${section.id}">Save video</button>
  </div>`;
}

function renderButtons(section, editMode) {
  const buttons = Array.isArray(section.data.buttons) ? section.data.buttons : [];
  const rendered = buttons
    .map((b) => {
      const url = safeUrl(b.url);
      if (!url && !editMode) return '';
      return `<a class="btn btn--primary" href="${escapeHtml(url || '#')}" ${
        url ? 'target="_blank" rel="noopener"' : ''
      }>${escapeHtml(b.label || 'Button')}</a>`;
    })
    .join('');

  if (!editMode) return `<div class="button-row">${rendered}</div>`;

  const editor = buttons
    .map(
      (b, i) => `<div class="btn-edit" data-index="${i}">
      <input type="text" data-btn-label value="${escapeHtml(b.label || '')}" placeholder="Label">
      <input type="url" data-btn-url value="${escapeHtml(b.url || '')}" placeholder="https://...">
      <button type="button" class="ctl ctl--danger" data-action="button-remove" data-index="${i}">✕</button>
    </div>`
    )
    .join('');
  return `<div class="button-row">${rendered}</div>
  <div class="buttons-edit" data-buttons-edit data-section-id="${section.id}">
    ${editor}
    <div class="buttons-edit__actions">
      <button type="button" class="ctl" data-action="button-add" data-section-id="${section.id}">Add button</button>
      <button type="button" class="ctl" data-action="buttons-save" data-section-id="${section.id}">Save</button>
    </div>
  </div>`;
}

// --- "Add Section" menu (edit mode) -----------------------------------------
export function addSectionMenu(ownerType, ownerId) {
  return `<div class="add-section" data-add-section data-owner-type="${escapeHtml(
    ownerType
  )}" data-owner-id="${escapeHtml(String(ownerId))}">
    <span class="add-section__label">Add section:</span>
    <button type="button" class="ctl" data-action="add-section" data-type="text">Text</button>
    <button type="button" class="ctl" data-action="add-section" data-type="carousel">Image Carousel</button>
    <button type="button" class="ctl" data-action="add-section" data-type="video">Video</button>
    <button type="button" class="ctl" data-action="add-section" data-type="buttons">Buttons</button>
  </div>`;
}

// --- team card --------------------------------------------------------------
export function renderTeamCard(member, editMode) {
  const img = getMedia(member.image_media);
  const linkedin = safeUrl(member.linkedin_url);
  const imgHtml = img
    ? `<img class="team-card__img" src="${escapeHtml(thumbUrl(img))}" alt="${escapeHtml(
        member.name || 'Team member'
      )}" loading="lazy">`
    : `<div class="team-card__img team-card__img--empty" aria-hidden="true"></div>`;

  if (!editMode) {
    return `<article class="team-card">
      ${imgHtml}
      <h3 class="team-card__name">${escapeHtml(member.name)}</h3>
      <p class="team-card__role">${escapeHtml(member.title)}</p>
      <p class="team-card__desc">${escapeHtml(member.description)}</p>
      ${
        linkedin
          ? `<a class="btn btn--linkedin" href="${escapeHtml(linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`
          : ''
      }
    </article>`;
  }

  return `<article class="team-card is-editing" data-member-id="${member.id}">
    <div class="sec-ctl">
      <button type="button" class="ctl" data-action="member-up" title="Move up">↑</button>
      <button type="button" class="ctl" data-action="member-down" title="Move down">↓</button>
      <button type="button" class="ctl ctl--danger" data-action="member-delete" title="Delete">✕</button>
    </div>
    <button type="button" class="team-card__imgbtn" data-action="member-image" data-member-id="${member.id}">
      ${imgHtml}<span class="team-card__imghint">Change photo</span>
    </button>
    <input class="team-card__name" data-member-field="name" value="${escapeHtml(member.name)}" placeholder="Name">
    <input class="team-card__role" data-member-field="title" value="${escapeHtml(member.title)}" placeholder="Title / role">
    <textarea class="team-card__desc" data-member-field="description" rows="4" placeholder="What they do + experience">${escapeHtml(
      member.description
    )}</textarea>
    <input class="team-card__linkedin" data-member-field="linkedin_url" value="${escapeHtml(
      member.linkedin_url
    )}" placeholder="LinkedIn URL">
    <button type="button" class="ctl" data-action="member-save" data-member-id="${member.id}">Save member</button>
  </article>`;
}

// --- video URL → embed URL --------------------------------------------------
export function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if (host === 'youtube.com' && u.pathname.startsWith('/embed/')) return u.href;
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === 'player.vimeo.com') return u.href;
  } catch {
    /* ignore */
  }
  return '';
}

// --- slide block rendering (public viewer) ----------------------------------
// Slides reuse the section content vocabulary as discrete "blocks".
export function renderSlideBlock(block) {
  switch (block.type) {
    case 'text':
      return `<div class="slide-block slide-block--text prose">${block.html || ''}</div>`;
    case 'image': {
      const m = getMedia(block.mediaId);
      if (!m) return '';
      // Full-resolution original — NO downressing on display (hard requirement).
      return `<div class="slide-block slide-block--image"><img src="${escapeHtml(
        mediaUrl(m)
      )}" alt="${escapeHtml(block.alt || m.alt || '')}"></div>`;
    }
    case 'buttons': {
      const buttons = Array.isArray(block.buttons) ? block.buttons : [];
      return `<div class="slide-block slide-block--buttons button-row">${buttons
        .map((b) => {
          const url = safeUrl(b.url);
          return url
            ? `<a class="btn btn--primary" href="${escapeHtml(
                url
              )}" target="_blank" rel="noopener">${escapeHtml(b.label || 'Button')}</a>`
            : '';
        })
        .join('')}</div>`;
    }
    case 'video': {
      // Resolve the player source (embed URL or uploaded file).
      let embed = '';
      let fileUrl = '';
      let mime = '';
      if (block.mode === 'url' && block.url) {
        embed = toEmbedUrl(block.url);
      } else if (block.mode === 'file' && block.mediaId) {
        const m = getMedia(block.mediaId);
        if (m) {
          fileUrl = mediaUrl(m);
          mime = m.mime;
        }
      }
      if (!embed && !fileUrl) return '';

      // If a thumbnail is set, show it with a play button; deck.js loads the
      // real video (autoplay) only when clicked.
      const thumb = block.thumbId ? getMedia(block.thumbId) : null;
      if (thumb) {
        return `<div class="slide-block slide-block--video"><div class="video-frame video-thumb" data-video-thumb data-embed="${escapeHtml(
          embed
        )}" data-file="${escapeHtml(fileUrl)}" data-mime="${escapeHtml(mime)}">
          <img src="${escapeHtml(mediaUrl(thumb))}" alt="${escapeHtml(thumb.alt || '')}">
          <button type="button" class="video-play" aria-label="Play video"></button>
        </div></div>`;
      }
      if (embed) {
        return `<div class="slide-block slide-block--video"><div class="video-frame"><iframe src="${escapeHtml(
          embed
        )}" title="Video" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div></div>`;
      }
      return `<div class="slide-block slide-block--video"><div class="video-frame"><video controls preload="metadata" playsinline><source src="${escapeHtml(
        fileUrl
      )}" type="${escapeHtml(mime)}"></video></div></div>`;
    }
    default:
      return '';
  }
}
