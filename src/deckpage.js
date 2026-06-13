// Pitch-deck rendering: a public full-screen viewer and an edit-mode
// Google-Slides-style editor. Images on slides are displayed at full
// resolution (originals) — never downressed.
import { layout, renderSlideBlock, toEmbedUrl } from './render.js';
import { escapeHtml } from './sanitize.js';
import { getMedia, mediaUrl, thumbUrl } from './media.js';

// --- public viewer ----------------------------------------------------------
export function renderDeckViewer(game, slides) {
  const slidesHtml = slides.length
    ? slides
        .map((s, i) => {
          // Blurred, scaled copy of the slide's first image fills the letterbox
          // bars behind the slide (only visible when the slide doesn't fill the
          // screen, i.e. when not in true fullscreen).
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
        .join('')
    : '<section class="deck-slide is-active"><div class="deck-slide__inner"><p class="muted">This deck is empty.</p></div></section>';

  const tri =
    '<svg class="deck-arrow__tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6 L17.5 12 L9 18 Z"/></svg>';
  const body = `<div class="deck-viewer" data-deck-viewer tabindex="0">
    <div class="deck-stage">${slidesHtml}</div>
    <button class="deck-arrow deck-arrow--prev" data-deck-prev aria-label="Previous slide">${tri}</button>
    <button class="deck-arrow deck-arrow--next" data-deck-next aria-label="Next slide">${tri}</button>
    <a class="deck-close" href="/game/${escapeHtml(game.slug)}" aria-label="Close presentation">✕</a>
  </div>`;

  return layout({
    title: `${game.title} — Pitch Deck`,
    body,
    editMode: false,
    bodyClass: 'page-deck',
    extraHead: '<script src="/js/deck.js" defer></script>',
  });
}

// --- edit-mode editor -------------------------------------------------------
export function renderDeckEditor(game, slides, currentIndex) {
  const idx = Math.min(Math.max(currentIndex, 0), Math.max(slides.length - 1, 0));
  const current = slides[idx];

  const strip = slides
    .map((s, i) => {
      const firstImg = s.data.blocks.find((b) => b.type === 'image' && b.mediaId);
      const m = firstImg ? getMedia(firstImg.mediaId) : null;
      const thumb = m
        ? `<img src="${escapeHtml(thumbUrl(m))}" alt="">`
        : `<span class="deck-thumb__n">${i + 1}</span>`;
      return `<div class="deck-thumb ${i === idx ? 'is-active' : ''}" data-slide-id="${s.id}" data-index="${i}">
        <a class="deck-thumb__link" href="/game/${escapeHtml(game.slug)}/deck?slide=${i}">${thumb}</a>
        <div class="deck-thumb__ctl">
          <button type="button" class="ctl" data-action="slide-left" title="Move left">←</button>
          <button type="button" class="ctl" data-action="slide-right" title="Move right">→</button>
          <button type="button" class="ctl ctl--danger" data-action="slide-delete" title="Delete slide">✕</button>
        </div>
      </div>`;
    })
    .join('');

  const canvas = current
    ? `<div class="deck-canvas" data-slide-id="${current.id}" data-game-id="${game.id}">
        <div class="deck-blocks" data-deck-blocks>
          ${current.data.blocks.map((b, i) => renderBlockEditor(b, i)).join('')}
        </div>
        <div class="deck-addblock">
          <span>Add to slide:</span>
          <button type="button" class="ctl" data-action="block-add" data-type="text">Text</button>
          <button type="button" class="ctl" data-action="block-add" data-type="image">Image</button>
          <button type="button" class="ctl" data-action="block-add" data-type="buttons">Buttons</button>
          <button type="button" class="ctl" data-action="block-add" data-type="video">Video</button>
        </div>
        <div class="deck-save">
          <button type="button" class="btn btn--primary" data-action="slide-save" data-slide-id="${current.id}">Save slide</button>
          <span class="deck-save__status" role="status" aria-live="polite"></span>
        </div>
      </div>`
    : '<div class="deck-canvas deck-canvas--empty"><p class="muted">No slides yet. Add one to begin.</p></div>';

  const body = `<div class="deck-editor" data-deck-editor data-game-id="${game.id}" data-slug="${escapeHtml(
    game.slug
  )}">
    <div class="deck-editor__bar">
      <a class="ctl" href="/game/${escapeHtml(game.slug)}">← Back to game</a>
      <strong>${escapeHtml(game.title)} — deck editor</strong>
      <a class="ctl" href="/game/${escapeHtml(game.slug)}/deck?present=1" target="_blank">Present ▶</a>
    </div>
    <div class="deck-strip">
      ${strip}
      <button type="button" class="deck-thumb deck-thumb--add" data-action="slide-add" data-game-id="${game.id}">+ Slide</button>
    </div>
    ${canvas}
  </div>`;

  return layout({
    title: `${game.title} — Deck editor`,
    body,
    editMode: true,
    bodyClass: 'page-deck-edit',
    extraHead: '<script src="/js/deck-edit.js" defer></script>',
  });
}

function renderBlockEditor(block, i) {
  const head = `<div class="block-edit__head">
    <span class="block-edit__type">${escapeHtml(block.type)}</span>
    <button type="button" class="ctl" data-action="block-up" title="Move up">↑</button>
    <button type="button" class="ctl" data-action="block-down" title="Move down">↓</button>
    <button type="button" class="ctl ctl--danger" data-action="block-delete" title="Delete">✕</button>
  </div>`;

  let inner = '';
  switch (block.type) {
    case 'text':
      inner = `<div class="richtext" data-richtext>
        <div class="richtext__toolbar" aria-hidden="true">
          <button type="button" data-cmd="bold"><b>B</b></button>
          <button type="button" data-cmd="italic"><i>I</i></button>
          <button type="button" data-cmd="h2">H2</button>
          <button type="button" data-cmd="ul">• List</button>
          <button type="button" data-cmd="link">Link</button>
        </div>
        <div class="richtext__area prose" contenteditable="true" data-block-html>${
          block.html || '<p>Text…</p>'
        }</div>
      </div>`;
      break;
    case 'image': {
      const m = getMedia(block.mediaId);
      inner = `<div class="block-image" data-media-id="${block.mediaId || ''}">
        <div class="block-image__preview">${
          m ? `<img src="${escapeHtml(mediaUrl(m))}" alt="">` : '<span class="muted">No image</span>'
        }</div>
        <button type="button" class="ctl" data-action="block-image-upload">Upload image</button>
        <input type="text" class="block-image__alt" data-block-alt value="${escapeHtml(
          block.alt || ''
        )}" placeholder="Alt text">
      </div>`;
      break;
    }
    case 'buttons': {
      const buttons = Array.isArray(block.buttons) ? block.buttons : [];
      inner = `<div class="block-buttons">
        <div class="block-buttons__list">
          ${buttons
            .map(
              (b) => `<div class="btn-edit">
              <input type="text" data-btn-label value="${escapeHtml(b.label || '')}" placeholder="Label">
              <input type="url" data-btn-url value="${escapeHtml(b.url || '')}" placeholder="https://...">
              <button type="button" class="ctl ctl--danger" data-action="block-btn-remove">✕</button>
            </div>`
            )
            .join('')}
        </div>
        <button type="button" class="ctl" data-action="block-btn-add">+ Button</button>
      </div>`;
      break;
    }
    case 'video': {
      const isFile = block.mode === 'file';
      const m = isFile ? getMedia(block.mediaId) : null;
      const thumb = block.thumbId ? getMedia(block.thumbId) : null;
      inner = `<div class="block-video" data-media-id="${block.mediaId || ''}" data-thumb-id="${block.thumbId || ''}">
        <div class="seg">
          <label><input type="radio" name="bvmode-${i}" value="url" ${
        !isFile ? 'checked' : ''
      } data-block-vmode> URL</label>
          <label><input type="radio" name="bvmode-${i}" value="file" ${
        isFile ? 'checked' : ''
      } data-block-vmode> File</label>
        </div>
        <input type="url" data-block-vurl value="${escapeHtml(
          block.url || ''
        )}" placeholder="YouTube/Vimeo URL" ${isFile ? 'hidden' : ''}>
        <div class="block-video__file" ${isFile ? '' : 'hidden'}>
          <button type="button" class="ctl" data-action="block-video-upload">Upload video</button>
          <span class="muted">${m ? escapeHtml(m.original_name) : 'no file'}</span>
        </div>
        <div class="block-video__thumb">
          <div class="block-video__thumbpreview">${
            thumb ? `<img src="${escapeHtml(mediaUrl(thumb))}" alt="">` : '<span class="muted">No thumbnail</span>'
          }</div>
          <button type="button" class="ctl" data-action="block-video-thumb">${thumb ? 'Change' : 'Add'} thumbnail</button>
          ${thumb ? '<button type="button" class="ctl ctl--danger" data-action="block-video-thumb-remove">Remove</button>' : ''}
        </div>
      </div>`;
      break;
    }
    default:
      inner = '';
  }

  return `<div class="block-edit" data-block-index="${i}" data-block-type="${block.type}">
    ${head}
    <div class="block-edit__body">${inner}</div>
  </div>`;
}
