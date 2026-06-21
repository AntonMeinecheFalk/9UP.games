// Server-side HTML rendering. Public output is read-only; when editMode is true
// we add data-attributes and control bars that the client edit.js wires up.
// All dynamic text is escaped; rich text is sanitized at save time.
import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml, safeUrl } from './sanitize.js';
import { getMedia, mediaUrl, thumbUrl, playbackUrl, videoReady } from './media.js';
import { ROOT } from './config.js';
import {
  Site,
  Games,
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
  bg: 'Background (top)',
  bg2: 'Background (bottom)',
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
    `--bg2:${safe('bg2')};` +
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
  const bgHex = HEX_RE.test(String(theme.bg)) ? theme.bg : DEFAULT_THEME.bg;
  const siteLogo = getMedia(Site.siteLogoId());
  // Shared nav links — used by the in-header desktop nav AND the mobile dropdown
  // (the dropdown lives OUTSIDE the header so its backdrop-filter can blur the
  // page; a backdrop-filter nested inside the blurred header is isolated).
  // Highlight the nav link for the page we're on (kept in sync on soft-nav by app.js).
  const activeHref = { 'page-home': '/', 'page-games': '/games', 'page-about': '/about', 'page-press': '/press', 'page-contact': '/contact' }[bodyClass] || '';
  const navLink = (href, label) =>
    `<a href="${href}"${href === activeHref ? ' aria-current="page"' : ''}>${label}</a>`;
  const navLinks =
    navLink('/', 'Home') +
    navLink('/games', 'Games') +
    navLink('/about', 'About') +
    navLink('/press', 'Press Kit') +
    // Contact sits last (far right); it links to the contact page, which shows our email.
    navLink('/contact', 'Contact') +
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
<link rel="icon" type="image/png" sizes="32x32" href="${assetUrl('img/favicon-32.png')}">
<link rel="icon" type="image/png" sizes="16x16" href="${assetUrl('img/favicon-16.png')}">
<link rel="apple-touch-icon" sizes="180x180" href="${assetUrl('img/favicon-180.png')}">
${googleFontsLink(theme)}
<link rel="stylesheet" href="${assetUrl('css/styles.css')}">
${themeStyle(theme)}
${extraHead}
</head>
<body class="${bodyClass}${editMode ? ' is-edit' : ''}">
<!-- Rounded play-triangle clip for the glass video toggle. It lives on the .video-toggle__play
     span; the frosted ::before is clipped to this shape by the parent (a backdrop-filter on a
     clip-path: url() element itself renders no blur — only the parent-crops-child route does). -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
  <clipPath id="vt-clip-play" clipPathUnits="objectBoundingBox"><path d="M.34 .292 Q.34 .214 .39 .253 L.75 .461 Q.80 .50 .75 .539 L.39 .747 Q.34 .786 .34 .708 Z"/></clipPath>
  <!-- Photoshop-style "threshold" for the drifting paw field: collapse the paw
       image's luminance to a hard 0/1 alpha mask, then flood it with the (top)
       background colour. The cut is fixed at 0.5; each paw shifts its threshold by
       pre-multiplying brightness in CSS (filter: brightness(b) url(#pawThreshold)),
       so b = 127.5 / T maps to a Photoshop threshold of T (b≈0.58 → 220, ≈3.19 → 40).
       flood-color is the top bg colour; app.js keeps it synced to --bg. -->
  <filter id="pawThreshold" color-interpolation-filters="sRGB" x="-5%" y="-5%" width="110%" height="110%">
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0" result="lum"/>
    <feComponentTransfer in="lum" result="mask"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
    <feFlood flood-color="${escapeHtml(bgHex)}" result="col" data-paw-flood/>
    <feComposite in="col" in2="mask" operator="in"/>
  </filter>
</defs></svg>
<!-- The paw filter ref MUST live in an in-document style block: a url(#id) filter
     fragment in the EXTERNAL stylesheet resolves against the stylesheet URL in
     Chrome (not the page), so it can't find pawThreshold and the paw renders
     invisible. Brightness (the threshold pre-multiply) stays a per-paw CSS var. -->
<style>.paw{filter:brightness(var(--b,0.58)) url(#pawThreshold);}</style>
<div class="bg-gradient" aria-hidden="true"></div>
<div class="paw-field" data-paw-field aria-hidden="true"></div>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <div class="brand-group">
      <a class="brand" href="/">
        ${
          siteLogo
            ? `<span class="brand__logo" style="--logo-url:url('${escapeHtml(mediaUrl(siteLogo))}')"><img src="${escapeHtml(
                mediaUrl(siteLogo)
              )}" alt=""></span>`
            : ''
        }
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

// --- home landing -----------------------------------------------------------
// The brand-first homepage: a huge "glass" company logo (the white 9UP
// silhouette used as a mask) revealing a game's key art in glassy reflection
// strips, with five outline echoes that lag the logo's hover-tilt to form an
// outward wave. The interaction (perspective tilt, sliding reflections, echo
// wave) is wired by app.js → initLogoStage; this is just the layered markup.
export function renderHomeLanding(editMode) {
  const games = Games.all();
  const featuredId = Site.featuredGameId();
  const featured =
    (featuredId && Games.get(featuredId)) || games.find((g) => g.hero_media) || games[0] || null;
  const heroMedia = featured ? getMedia(featured.hero_media) : null;
  const logoMedia = getMedia(Site.siteLogoId());

  const heroUrl = heroMedia ? mediaUrl(heroMedia) : '';
  const logoUrl = logoMedia ? mediaUrl(logoMedia) : '';

  // Social buttons are data-driven: each is an uploaded icon + a URL, managed in
  // edit mode (add / remove / change icon / set URL). See edit.js → social-* actions.
  const socials = Site.homeSocials();
  const socialIcon = (s) => {
    const m = getMedia(s.mediaId);
    return m ? `<img src="${escapeHtml(mediaUrl(m))}" alt="" class="social-btn__icon">` : '';
  };
  let social;
  if (editMode) {
    social =
      socials
        .map(
          (s, i) =>
            `<div class="social-edit" data-social-index="${i}" data-social-media="${escapeHtml(
              String(s.mediaId || '')
            )}">
               <div class="btn social-btn social-btn--preview">${
                 socialIcon(s) || '<span class="social-btn__ph">?</span>'
               }</div>
               <input type="url" class="social-edit__url" data-social-url value="${escapeHtml(
                 s.url || ''
               )}" placeholder="https://…">
               <div class="social-edit__row">
                 <button type="button" class="ctl" data-action="social-icon" data-social-index="${i}">Change icon</button>
                 <button type="button" class="ctl ctl--danger" data-action="social-remove" data-social-index="${i}">Remove</button>
               </div>
             </div>`
        )
        .join('') +
      `<button type="button" class="social-add" data-action="social-add">+ Add social</button>`;
  } else {
    social = socials
      .map((s) => {
        const url = safeUrl(s.url) || '#';
        const ext = url !== '#';
        return `<a class="btn social-btn" href="${escapeHtml(url)}"${
          ext ? ' target="_blank" rel="noopener"' : ''
        } aria-label="Social link">${socialIcon(s)}</a>`;
      })
      .join('');
  }

  // The stage needs the silhouette (mask) + the key art (revealed fill) as CSS vars,
  // plus the baked logo assets — all version-busted (?v=mtime) so a re-bake is never
  // served stale from the browser/Cloudflare cache (filenames don't change).
  const img = (rel) => `url('${assetUrl(rel)}')`;
  const stageVars =
    `--logo-mask:url('${escapeHtml(logoUrl)}');--hero-url:url('${escapeHtml(heroUrl)}')` +
    `;--reflect-mask:${img('img/logo-reflection.png')}` +
    `;--rim-top:${img('img/logo-rim-top.png')}` +
    `;--rim-bottom:${img('img/logo-rim-bottom.png')}` +
    `;--outline:${img('img/logo-outline.png')}`;

  const stage = logoUrl
    ? `<div class="logo-stage" data-logo-stage style="${stageVars}">
         <div class="logo-echoes" data-logo-echoes aria-hidden="true"></div>
         <div class="logo-plate">
           <div class="lg-frost" aria-hidden="true">
             <div class="lg-art" data-logo-art></div>
             <div class="lg-grad lg-grad--bottom"></div>
             <div class="lg-grad lg-grad--top"></div>
           </div>
           <div class="logo-glass" data-logo-glass>
             <div class="lg-layer lg-rim lg-rim--top"></div>
           </div>
           <div class="lg-layer lg-rim lg-rim--bottom" data-logo-botrim></div>
         </div>
       </div>`
    : `<div class="logo-stage logo-stage--empty"><p class="muted">Add a site logo (header → Add logo) to show the glass logo.</p></div>`;

  const tagline = Site.homeTagline();
  const taglineEl = editMode
    ? `<div class="home-tagline home-tagline--edit">
         <div class="richtext" data-richtext data-target="home_tagline">
           <div class="richtext__toolbar" aria-hidden="true">
             <button type="button" data-cmd="bold"><b>B</b></button>
             <button type="button" data-cmd="italic"><i>I</i></button>
             <button type="button" data-cmd="h2" title="Heading">H2</button>
             <button type="button" data-cmd="h3" title="Subheading">H3</button>
             <button type="button" data-cmd="p" title="Normal text">¶</button>
             <button type="button" data-cmd="fontsize" data-size="-1" title="Smaller text">A&minus;</button>
             <button type="button" data-cmd="fontsize" data-size="1" title="Larger text">A+</button>
             <button type="button" data-cmd="ul">• List</button>
             <button type="button" data-cmd="link">Link</button>
             <button type="button" data-cmd="save" class="richtext__save">Save</button>
           </div>
           <div class="richtext__area prose" contenteditable="true">${tagline}</div>
         </div>
       </div>`
    : `<div class="home-tagline prose">${tagline}</div>`;

  const editTools = editMode
    ? `<div class="wrap toolbar home-edit">
         <label class="ctl-inline">Logo art game:
           <select data-action="set-featured">
             <option value="">— first with art —</option>
             ${games
               .map(
                 (g) =>
                   `<option value="${g.id}" ${
                     featured && g.id === featured.id ? 'selected' : ''
                   }>${escapeHtml(g.title)}</option>`
               )
               .join('')}
           </select>
         </label>
         <span class="muted">The glass logo reveals this game's key art. Edit the logo via the header, the art on the game's page.</span>
       </div>`
    : '';

  return `<section class="home-hero">
    <div class="home-hero__inner">
      ${stage}
      ${taglineEl}
      <div class="home-social${editMode ? ' home-social--edit' : ''}">${social}</div>
    </div>
    ${editTools}
  </section>`;
}

// --- hero --------------------------------------------------------------------
export function renderHero(game, editMode, slides = []) {
  if (!game) return '';
  const hero = getMedia(game.hero_media);
  const logo = getMedia(game.logo_media);
  const d = parseDisplay(game.display);
  const steam = safeUrl(game.steam_url);
  // In public mode, the "Pitch Deck" button opens an in-page popup (below)
  // instead of navigating; the href stays as a no-JS / crawler fallback.
  const showDeckPopup = !editMode && slides.length > 0;

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
            <a class="btn btn--primary" href="/game/${escapeHtml(game.slug)}/deck"${
              showDeckPopup ? ' data-deck-open' : ''
            }>Pitch Deck</a>
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
</section>${showDeckPopup ? renderDeckPopup(game, slides) : ''}`;
}

// --- pitch-deck popup (in-page) ---------------------------------------------
// A lightbox version of the deck: a glass card (styled like the image-carousel
// frame) holding the slides, with the shared glass arrows in the side gutters.
// app.js choreographs the open animation and slide navigation; this is just the
// hidden markup. Slides reuse the viewer's .deck-slide layout classes.
export function renderDeckPopup(game, slides) {
  const siteLogo = getMedia(Site.siteLogoId());
  const slidesHtml = slides
    .map((s, i) => {
      const firstImg = s.data.blocks.find((b) => b.type === 'image' && b.mediaId);
      const bgMedia = firstImg ? getMedia(firstImg.mediaId) : null;
      const bg = bgMedia
        ? `<img class="deck-slide__bg" src="${escapeHtml(mediaUrl(bgMedia))}" alt="" aria-hidden="true">`
        : '';
      return `<section class="deck-slide ${i === 0 ? 'is-active' : ''}" data-slide-index="${i}">
          ${bg}
          <div class="deck-slide__inner">${s.data.blocks.map(renderSlideBlock).join('')}</div>
        </section>`;
    })
    .join('');
  const arrows =
    slides.length > 1
      ? `<button type="button" class="glass-arrow glass-arrow--prev deck-pop__prev" data-deck-prev aria-label="Previous slide">${triSvg()}</button>
         <button type="button" class="glass-arrow glass-arrow--next deck-pop__next" data-deck-next aria-label="Next slide">${triSvg()}</button>`
      : '';
  return `<div class="deck-pop" data-deck-pop hidden>
    <div class="deck-pop__backdrop" data-deck-close></div>
    <div class="deck-pop__glow" data-deck-glow aria-hidden="true"></div>
    <div class="deck-pop__frame" role="dialog" aria-modal="true" aria-label="${escapeHtml(
      game.title
    )} — pitch deck" tabindex="-1">
      <div class="deck-pop__card" data-deck-card>
        <div class="deck-pop__stage">${slidesHtml}</div>
        <div class="deck-pop__loader" data-deck-loader aria-hidden="true">${
          siteLogo ? `<img class="deck-pop__loaderlogo" src="${escapeHtml(mediaUrl(siteLogo))}" alt="">` : ''
        }</div>
      </div>
      ${arrows}
      <button type="button" class="glass-arrow deck-pop__close" data-deck-close aria-label="Close pitch deck"><svg class="glass-arrow__tri deck-pop__x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button>
    </div>
  </div>`;
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
        <button type="button" data-cmd="p" title="Normal text">¶</button>
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
  const m = d.mediaId ? getMedia(d.mediaId) : null;
  const { poster } = videoPoster(null, m);

  if (!editMode) {
    if (m && m.kind === 'video' && videoReady(m)) {
      return renderVideoFrame({ src: playbackUrl(m), poster, posterAlt: m.alt || '' });
    }
    if (m && m.kind === 'video') {
      return poster
        ? `<div class="video-frame"><img class="video-frame__poster" src="${escapeHtml(poster)}" alt=""></div>`
        : '<p class="muted">Video processing…</p>';
    }
    return '<p class="muted">No video set.</p>';
  }

  // Edit mode: upload a file + a scrubbable native-controls preview once ready.
  let preview = '<p class="muted">No video uploaded.</p>';
  if (m && m.kind === 'video') {
    if (videoReady(m)) {
      preview = `<div class="video-frame"><video controls preload="metadata" playsinline src="${escapeHtml(
        playbackUrl(m)
      )}"></video></div>`;
    } else if (m.status === 'failed') {
      preview = '<p class="muted">Processing failed — try a different file.</p>';
    } else {
      preview = '<p class="muted" data-video-status>Processing… (this can take a while)</p>';
    }
  }
  return `${preview}
  <div class="video-edit" data-video-edit data-section-id="${section.id}" data-media-id="${m ? m.id : ''}">
    <button type="button" class="ctl" data-action="video-upload" data-section-id="${section.id}">${
    m ? 'Replace' : 'Upload'
  } video</button>
    <span class="muted">${m ? escapeHtml(m.original_name || '') : 'Self-hosted MP4/MOV/WebM — transcoded for streaming.'}</span>
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
    // LinkedIn "in" glyph (replaces the old "LinkedIn" text label).
    const liLogo =
      '<svg class="team-card__li" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z"/></svg>';
    return `<article class="team-card">
      <div class="team-card__avatar">${imgHtml}</div>
      <span class="team-card__rule" aria-hidden="true"></span>
      <h3 class="team-card__name">${escapeHtml(member.name)}</h3>
      <span class="team-card__rule" aria-hidden="true"></span>
      <p class="team-card__role">${escapeHtml(member.title)}</p>
      <p class="team-card__desc">${escapeHtml(member.description)}</p>
      ${
        linkedin
          ? `<a class="btn btn--linkedin" href="${escapeHtml(linkedin)}" target="_blank" rel="noopener" aria-label="LinkedIn">${liLogo}</a>`
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

// --- custom video player frame ----------------------------------------------
// Shared markup for both pitch-deck slides and page sections. Videos are
// self-hosted (uploaded + transcoded to a streamable MP4) — no third-party
// embeds. The <video> is created lazily by the client (app.js → videoPlayers);
// here we emit only the source, a poster, and a click-catching cover. The glass
// play/pause toggle is added (and, on slides, lifted to the top layer) by the client.
export function renderVideoFrame({ src = '', mime = 'video/mp4', poster = '', posterAlt = '', overlay = '', overlayAlt = '', fill = false } = {}) {
  const posterHtml = poster
    ? `<img class="video-frame__poster" src="${escapeHtml(poster)}" alt="${escapeHtml(posterAlt)}">`
    : '<div class="video-frame__poster video-frame__poster--blank" aria-hidden="true"></div>';
  // Optional decorative overlay: sits over the video and slides out the bottom
  // (clipped by the frame's rounded box) once playback starts.
  const overlayHtml = overlay
    ? `<img class="video-frame__overlay" src="${escapeHtml(overlay)}" alt="${escapeHtml(overlayAlt)}" aria-hidden="true">`
    : '';
  return `<div class="video-frame${fill ? ' video-frame--fill' : ''}" data-video data-provider="file" data-file="${escapeHtml(
    src
  )}" data-mime="${escapeHtml(mime)}">
    <div class="video-frame__media" data-video-media></div>
    ${posterHtml}
    ${overlayHtml}
    <div class="video-frame__cover" data-video-cover></div>
  </div>`;
}

// Poster image for a video block: a manually-set thumbnail wins, else the frame
// auto-extracted during transcode. Returns { poster, alt }.
function videoPoster(block, media) {
  const manual = block && block.thumbId ? getMedia(block.thumbId) : null;
  if (manual) return { poster: mediaUrl(manual), alt: manual.alt || '' };
  if (media && media.thumb) return { poster: thumbUrl(media), alt: media.alt || '' };
  return { poster: '', alt: '' };
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
      const m = block.mediaId ? getMedia(block.mediaId) : null;
      if (!m || m.kind !== 'video') return '';
      const { poster, alt } = videoPoster(block, m);
      // Still transcoding (or failed with no playback): show the poster, no player.
      if (!videoReady(m)) {
        return poster
          ? `<div class="slide-block slide-block--video"><div class="video-frame video-frame--fill"><img class="video-frame__poster" src="${escapeHtml(
              poster
            )}" alt="${escapeHtml(alt)}"></div></div>`
          : '';
      }
      const ov = block.overlayId ? getMedia(block.overlayId) : null;
      return `<div class="slide-block slide-block--video">${renderVideoFrame({
        src: playbackUrl(m),
        poster,
        posterAlt: alt,
        overlay: ov ? mediaUrl(ov) : '',
        overlayAlt: ov ? ov.alt || '' : '',
        fill: true,
      })}</div>`;
    }
    default:
      return '';
  }
}
