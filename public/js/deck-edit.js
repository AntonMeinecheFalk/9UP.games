// Pitch-deck editor: Google-Slides-style. Add/delete/reorder slides, add/edit
// content blocks (reusing the section content vocabulary), and present. Slide
// content is saved wholesale via PUT /api/slides/:id. Images stay full-res.
(function () {
  'use strict';
  const editor = document.querySelector('[data-deck-editor]');
  if (!editor) return;

  const gameId = editor.dataset.gameId;
  const slug = editor.dataset.slug;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Open a picker + upload with a progress bar. Uses the shared helper from
  // edit.js (loaded on every edit page, incl. this one); falls back to a plain
  // fetch if it isn't available for any reason.
  async function uploadFile(accept) {
    if (typeof window.mediaUpload === 'function') {
      const media = await window.mediaUpload({ accept, multiple: false });
      return media[0] || null;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    return new Promise((resolve, reject) => {
      input.addEventListener('change', async () => {
        if (!input.files.length) return resolve(null);
        const fd = new FormData();
        fd.append('files', input.files[0]);
        try {
          const res = await fetch('/api/media', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          resolve((data.media || [])[0] || null);
        } catch (err) { reject(err); }
      });
      input.click();
    });
  }

  const status = () => editor.querySelector('.deck-save__status');
  function setStatus(msg) { const s = status(); if (s) s.textContent = msg; }

  // Read the current slide's blocks from the DOM (in display order).
  function gatherBlocks() {
    const canvas = editor.querySelector('.deck-canvas');
    if (!canvas) return null;
    const blocks = [];
    canvas.querySelectorAll('.block-edit').forEach((el) => {
      const type = el.dataset.blockType;
      if (type === 'text') {
        blocks.push({ type: 'text', html: el.querySelector('[data-block-html]').innerHTML });
      } else if (type === 'image') {
        const box = el.querySelector('.block-image');
        const mediaId = parseInt(box.dataset.mediaId || '0', 10) || null;
        blocks.push({ type: 'image', mediaId, alt: el.querySelector('[data-block-alt]').value });
      } else if (type === 'buttons') {
        const buttons = Array.from(el.querySelectorAll('.btn-edit')).map((r) => ({
          label: r.querySelector('[data-btn-label]').value,
          url: r.querySelector('[data-btn-url]').value,
        }));
        blocks.push({ type: 'buttons', buttons });
      } else if (type === 'video') {
        const box = el.querySelector('.block-video');
        blocks.push({
          type: 'video',
          mediaId: parseInt(box.dataset.mediaId || '0', 10) || null,
          thumbId: parseInt(box.dataset.thumbId || '0', 10) || null,
          overlayId: parseInt(box.dataset.overlayId || '0', 10) || null,
        });
      }
    });
    return blocks;
  }

  function currentSlideId() {
    return editor.querySelector('.deck-canvas')?.dataset.slideId;
  }

  async function saveCurrent() {
    const id = currentSlideId();
    const blocks = gatherBlocks();
    if (!id || blocks == null) return;
    await api('PUT', `/api/slides/${id}`, { blocks });
  }

  // --- rich text toolbars (text blocks) -------------------------------------
  editor.querySelectorAll('[data-richtext]').forEach((rt) => {
    const area = rt.querySelector('.richtext__area');
    rt.querySelectorAll('.richtext__toolbar button').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        area.focus();
        if (cmd === 'bold') document.execCommand('bold');
        else if (cmd === 'italic') document.execCommand('italic');
        else if (cmd === 'h2') document.execCommand('formatBlock', false, 'h2');
        else if (cmd === 'ul') document.execCommand('insertUnorderedList');
        else if (cmd === 'link') { const u = prompt('Link URL'); if (u) document.execCommand('createLink', false, u); }
      });
    });
  });

  // --- poll a still-transcoding video and refresh when it's ready -----------
  function pollVideoStatus() {
    const el = editor.querySelector('[data-video-status][data-media-id]');
    if (!el) return;
    const id = el.dataset.mediaId;
    setTimeout(async () => {
      try {
        const res = await fetch(`/api/media/${id}`, { headers: { 'X-Requested-With': 'poll' } });
        const data = await res.json();
        if (data.media && data.media.status !== 'processing') return location.reload();
      } catch (_) {}
      pollVideoStatus();
    }, 3000);
  }
  pollVideoStatus();

  // --- click delegation -----------------------------------------------------
  editor.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const blockEl = btn.closest('.block-edit');

    try {
      switch (action) {
        // ----- slides -----
        case 'slide-add': {
          await saveCurrent().catch(() => {});
          await api('POST', `/api/games/${gameId}/slides`);
          location.href = `/game/${slug}/deck?slide=9999`; // clamps to last
          break;
        }
        case 'slide-delete': {
          if (!confirm('Delete this slide?')) return;
          await api('DELETE', `/api/slides/${btn.closest('[data-slide-id]').dataset.slideId}`);
          location.href = `/game/${slug}/deck`;
          break;
        }
        case 'slide-left':
        case 'slide-right': {
          await saveCurrent().catch(() => {});
          const thumbs = Array.from(editor.querySelectorAll('.deck-thumb[data-slide-id]'));
          const ids = thumbs.map((t) => parseInt(t.dataset.slideId, 10));
          const thisId = parseInt(btn.closest('[data-slide-id]').dataset.slideId, 10);
          const idx = ids.indexOf(thisId);
          const swap = action === 'slide-left' ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= ids.length) return;
          [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
          await api('POST', `/api/games/${gameId}/slides/reorder`, { order: ids });
          location.href = `/game/${slug}/deck?slide=${swap}`;
          break;
        }
        case 'slide-save': {
          await saveCurrent();
          setStatus('Saved ✓');
          setTimeout(() => setStatus(''), 2000);
          break;
        }

        // ----- blocks -----
        case 'block-add': {
          const type = btn.dataset.type;
          const blocks = gatherBlocks() || [];
          if (type === 'image') {
            const m = await uploadFile('image/*');
            if (!m) return;
            blocks.push({ type: 'image', mediaId: m.id, alt: '' });
          } else if (type === 'text') {
            blocks.push({ type: 'text', html: '<p>Text…</p>' });
          } else if (type === 'buttons') {
            blocks.push({ type: 'buttons', buttons: [{ label: 'Button', url: '' }] });
          } else if (type === 'video') {
            // Only one video per slide (the custom player's play/pause acts on
            // the whole slide, so a second video would have no separate control).
            if (blocks.some((b) => b.type === 'video')) {
              alert('A slide can only contain one video.');
              return;
            }
            blocks.push({ type: 'video', mediaId: null, thumbId: null });
          }
          await api('PUT', `/api/slides/${currentSlideId()}`, { blocks });
          location.reload();
          break;
        }
        case 'block-delete': {
          const blocks = gatherBlocks();
          const idx = parseInt(blockEl.dataset.blockIndex, 10);
          blocks.splice(idx, 1);
          await api('PUT', `/api/slides/${currentSlideId()}`, { blocks });
          location.reload();
          break;
        }
        case 'block-up':
        case 'block-down': {
          const blocks = gatherBlocks();
          const idx = parseInt(blockEl.dataset.blockIndex, 10);
          const swap = action === 'block-up' ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= blocks.length) return;
          [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
          await api('PUT', `/api/slides/${currentSlideId()}`, { blocks });
          location.reload();
          break;
        }
        case 'block-image-upload': {
          const m = await uploadFile('image/*');
          if (!m) return;
          const box = blockEl.querySelector('.block-image');
          box.dataset.mediaId = m.id;
          box.querySelector('.block-image__preview').innerHTML = `<img src="/media/${m.filename}" alt="">`;
          break;
        }
        case 'block-video-upload': {
          const m = await uploadFile('video/*');
          if (!m) return;
          blockEl.querySelector('.block-video').dataset.mediaId = m.id;
          // Persist the slide and reload so the transcode/processing state shows.
          await saveCurrent();
          location.reload();
          break;
        }
        case 'block-video-thumb': {
          const m = await uploadFile('image/*');
          if (!m) return;
          const box = blockEl.querySelector('.block-video');
          box.dataset.thumbId = m.id;
          box.querySelector('.block-video__thumbpreview').innerHTML = `<img src="/media/${m.filename}" alt="">`;
          break;
        }
        case 'block-video-thumb-remove': {
          const box = blockEl.querySelector('.block-video');
          box.dataset.thumbId = '';
          box.querySelector('.block-video__thumbpreview').innerHTML = '<span class="muted">No thumbnail</span>';
          break;
        }
        case 'block-video-overlay': {
          const m = await uploadFile('image/*');
          if (!m) return;
          const box = blockEl.querySelector('.block-video');
          box.dataset.overlayId = m.id;
          box.querySelector('.block-video__overlay-edit .block-video__thumbpreview').innerHTML = `<img src="/media/${m.filename}" alt="">`;
          break;
        }
        case 'block-video-overlay-remove': {
          const box = blockEl.querySelector('.block-video');
          box.dataset.overlayId = '';
          box.querySelector('.block-video__overlay-edit .block-video__thumbpreview').innerHTML = '<span class="muted">No overlay</span>';
          break;
        }
        case 'block-btn-add': {
          const list = blockEl.querySelector('.block-buttons__list');
          const row = document.createElement('div');
          row.className = 'btn-edit';
          row.innerHTML =
            '<input type="text" data-btn-label placeholder="Label">' +
            '<input type="url" data-btn-url placeholder="https://...">' +
            '<button type="button" class="ctl ctl--danger" data-action="block-btn-remove">✕</button>';
          list.appendChild(row);
          break;
        }
        case 'block-btn-remove': {
          btn.closest('.btn-edit').remove();
          break;
        }
      }
    } catch (err) {
      alert(err.message || 'Error');
    }
  });
})();
