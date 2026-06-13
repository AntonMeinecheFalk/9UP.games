// Server-side HTML rendering. Public output is read-only; when editMode is true
// we add data-attributes and control bars that the client edit.js wires up.
// All dynamic text is escaped; rich text is sanitized at save time.
import { escapeHtml, safeUrl } from './sanitize.js';
import { getMedia, mediaUrl, thumbUrl } from './media.js';
import { Site } from './models.js';

// --- page shell -------------------------------------------------------------
export function layout({ title, body, editMode, extraHead = '', bodyClass = '' }) {
  const siteTitle = escapeHtml(Site.title());
  const pageTitle = title ? `${escapeHtml(title)} — ${siteTitle}` : siteTitle;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<link rel="stylesheet" href="/css/styles.css">
${extraHead}
</head>
<body class="${bodyClass}${editMode ? ' is-edit' : ''}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/">${siteTitle}</a>
    <nav class="site-nav" aria-label="Primary">
      <a href="/">Home</a>
      <a href="/about">About</a>
      <a href="/press">Press Kit</a>
    </nav>
  </div>
</header>
${editMode ? editBar() : ''}
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <span>&copy; ${siteTitle}</span>
    ${editMode ? '<a href="/logout" class="muted">Exit edit mode</a>' : ''}
  </div>
</footer>
<script src="/js/app.js" defer></script>
${editMode ? '<script src="/js/edit.js" defer></script>' : ''}
</body>
</html>`;
}

function editBar() {
  return `<div class="edit-banner" role="status">
  <strong>Edit mode</strong> — changes save to this device.
  <a href="/admin/submissions">Key requests</a>
  <a href="/logout">Exit</a>
</div>`;
}

// --- hero --------------------------------------------------------------------
export function renderHero(game, editMode) {
  if (!game) return '';
  const hero = getMedia(game.hero_media);
  const bg = hero
    ? `style="background-image:url('${escapeHtml(mediaUrl(hero))}')"`
    : '';
  const steam = safeUrl(game.steam_url);
  return `<section class="hero ${hero ? '' : 'hero--empty'}" ${bg} data-game-id="${game.id}">
  <div class="hero__overlay">
    <h1 class="hero__title" ${editMode ? 'data-edit-field="title" contenteditable="true"' : ''}>${escapeHtml(
      game.title
    )}</h1>
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
  ${
    editMode
      ? `<div class="hero__edit">
           <button type="button" class="ctl" data-action="hero-image" data-game-id="${game.id}">Change hero image</button>
           <label class="ctl-inline">Steam URL
             <input type="url" data-edit-field="steam_url" data-game-id="${game.id}" value="${escapeHtml(
          game.steam_url
        )}" placeholder="https://store.steampowered.com/app/...">
           </label>
         </div>`
      : ''
  }
</section>`;
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
      ? `<button class="carousel__nav carousel__prev" aria-label="Previous">‹</button>
         <button class="carousel__nav carousel__next" aria-label="Next">›</button>`
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
      if (block.mode === 'url' && block.url) {
        const embed = toEmbedUrl(block.url);
        return embed
          ? `<div class="slide-block slide-block--video"><div class="video-frame"><iframe src="${escapeHtml(
              embed
            )}" title="Video" frameborder="0" allowfullscreen></iframe></div></div>`
          : '';
      }
      if (block.mode === 'file' && block.mediaId) {
        const m = getMedia(block.mediaId);
        if (m)
          return `<div class="slide-block slide-block--video"><div class="video-frame"><video controls preload="metadata" playsinline><source src="${escapeHtml(
            mediaUrl(m)
          )}" type="${escapeHtml(m.mime)}"></video></div></div>`;
      }
      return '';
    }
    default:
      return '';
  }
}
