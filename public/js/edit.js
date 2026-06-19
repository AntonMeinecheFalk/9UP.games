// Edit-mode behaviors. Loaded ONLY when the signed edit cookie is present.
// Pattern: perform an API call, then either reload (structural changes) or give
// inline feedback (content saves). Keeps the client small and robust for a Pi.
(function () {
  'use strict';

  // --- API + upload helpers -------------------------------------------------
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

  const reload = () => location.reload();

  // --- upload with a progress bar (shared by edit.js + deck-edit.js) ---------
  // A small glass overlay shows real upload progress (XHR), then "Processing…"
  // for the server side. Exposed on window so the deck editor reuses it.
  function uploadProgressUI() {
    let el = document.getElementById('upload-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'upload-progress';
      el.className = 'upload-progress';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="upload-progress__card">' +
      '<div class="upload-progress__label">Uploading…</div>' +
      '<div class="upload-progress__track"><div class="upload-progress__fill"></div></div>' +
      '<div class="upload-progress__pct">0%</div></div>';
    el.classList.remove('is-error');
    el.classList.add('is-open');
    const label = el.querySelector('.upload-progress__label');
    const fill = el.querySelector('.upload-progress__fill');
    const pct = el.querySelector('.upload-progress__pct');
    const hide = (ms) => setTimeout(() => el.classList.remove('is-open', 'is-error'), ms);
    return {
      set(frac) {
        const p = Math.max(0, Math.min(100, Math.round(frac * 100)));
        fill.style.width = p + '%';
        pct.textContent = p < 100 ? p + '%' : 'Processing…';
        if (p >= 100) label.textContent = 'Transcoding for streaming…';
      },
      done() { fill.style.width = '100%'; pct.textContent = 'Processing…'; hide(700); },
      fail(msg) { el.classList.add('is-error'); label.textContent = msg || 'Upload failed'; pct.textContent = '✕'; hide(5000); },
    };
  }

  // Upload File[] to /api/media with progress. Resolves to media rows.
  function uploadFilesWithProgress(files) {
    return new Promise((resolve, reject) => {
      const ui = uploadProgressUI();
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media');
      xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) ui.set(e.loaded / e.total); });
      xhr.addEventListener('load', () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) { ui.done(); resolve(data.media || []); }
        else { const m = data.error || `Upload failed (${xhr.status})`; ui.fail(m); reject(new Error(m)); }
      });
      xhr.addEventListener('error', () => { ui.fail('Network error during upload'); reject(new Error('Network error')); });
      xhr.addEventListener('abort', () => { ui.fail('Upload cancelled'); reject(new Error('aborted')); });
      ui.set(0);
      xhr.send(fd);
    });
  }

  // Direct OS file-dialog upload (the picker's “Upload new” button uses this).
  function chooseAndUploadFiles({ accept, multiple } = {}) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || 'image/*';
      input.multiple = !!multiple;
      input.addEventListener('change', () => {
        if (!input.files.length) return resolve([]);
        uploadFilesWithProgress(Array.from(input.files)).then(resolve, reject);
      });
      input.click();
    });
  }
  const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Media picker: pick an EXISTING asset from the library (so the same upload can be
  // reused anywhere with no re-upload) or upload a new one. Resolves to media rows
  // (array — same shape as an upload), or [] if cancelled.
  function openMediaPicker({ accept = 'image/*', multiple = false } = {}) {
    const kind = /^video/.test(accept) ? 'video' : /^image/.test(accept) ? 'image' : '';
    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'media-picker';
      overlay.innerHTML =
        '<div class="media-picker__panel" role="dialog" aria-modal="true" aria-label="Choose media">' +
          '<div class="media-picker__head">' +
            `<strong>Choose ${kind || 'media'}</strong>` +
            '<div class="media-picker__head-actions">' +
              '<button type="button" class="btn" data-mp="upload">⬆ Upload new</button>' +
              '<button type="button" class="ctl" data-mp="close" aria-label="Close">✕</button>' +
            '</div></div>' +
          '<div class="media-picker__grid" data-mp-grid><p class="muted">Loading library…</p></div>' +
        '</div>';
      document.body.appendChild(overlay);
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; document.removeEventListener('keydown', onKey); overlay.remove(); resolve(v); };
      const die = (e) => { if (settled) return; settled = true; document.removeEventListener('keydown', onKey); overlay.remove(); reject(e); };
      const onKey = (e) => { if (e.key === 'Escape') done([]); };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done([]); });
      overlay.querySelector('[data-mp="close"]').addEventListener('click', () => done([]));
      overlay.querySelector('[data-mp="upload"]').addEventListener('click', () => {
        chooseAndUploadFiles({ accept, multiple }).then((rows) => { if (rows && rows.length) done(rows); }, die);
      });
      const grid = overlay.querySelector('[data-mp-grid]');
      fetch('/api/media' + (kind ? `?kind=${kind}` : ''), { headers: { 'X-Requested-With': 'picker' } })
        .then((r) => r.json())
        .then((data) => {
          const items = (data && data.media) || [];
          if (!items.length) { grid.innerHTML = '<p class="muted">Nothing in your library yet — use “Upload new”.</p>'; return; }
          grid.innerHTML = items.map((m) => {
            const preview = m.thumb ? `/media/thumbs/${m.thumb}` : (m.kind === 'image' ? `/media/${m.filename}` : '');
            const name = m.original_name || ('#' + m.id);
            const vid = m.kind === 'video';
            const proc = m.status === 'processing';
            const thumb = preview
              ? `<img class="media-picker__thumb" loading="lazy" src="${escAttr(preview)}" alt="">`
              : `<span class="media-picker__thumb media-picker__thumb--blank">${vid ? '🎞' : '🖼'}</span>`;
            return `<button type="button" class="media-picker__item" data-id="${m.id}" title="${escAttr(name)}">` +
              thumb + (vid ? '<span class="media-picker__badge">▶</span>' : '') +
              (proc ? '<span class="media-picker__proc">processing…</span>' : '') +
              `<span class="media-picker__name">${escAttr(name)}</span></button>`;
          }).join('');
          grid.querySelectorAll('.media-picker__item').forEach((b) => {
            b.addEventListener('click', () => { const m = items.find((x) => String(x.id) === b.dataset.id); done(m ? [m] : []); });
          });
        })
        .catch(() => { grid.innerHTML = '<p class="muted">Couldn’t load the library. Try “Upload new”.</p>'; });
    });
  }

  // Choose media (existing or new). Returns media rows (array, possibly empty).
  function pickAndUpload(opts = {}) { return openMediaPicker(opts); }
  // Shared with deck-edit.js.
  window.mediaUpload = pickAndUpload;

  // Back-compat name used throughout this file.
  const uploadFiles = pickAndUpload;

  function flash(msg, isError) {
    let el = document.getElementById('edit-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'edit-flash';
      el.style.cssText =
        'position:fixed;bottom:1rem;right:1rem;z-index:1000;padding:.6rem 1rem;' +
        'border-radius:8px;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.4);font-weight:600';
      document.body.appendChild(el);
    }
    el.style.background = isError ? 'var(--danger)' : 'var(--accent-2)';
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }
  const fail = (err) => flash(err.message || 'Error', true);

  // --- Rich text editors ----------------------------------------------------
  document.querySelectorAll('[data-richtext]').forEach((rt) => {
    const area = rt.querySelector('.richtext__area');
    rt.querySelectorAll('.richtext__toolbar button').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection
      btn.addEventListener('click', async () => {
        const cmd = btn.getAttribute('data-cmd');
        area.focus();
        if (cmd === 'bold') document.execCommand('bold');
        else if (cmd === 'italic') document.execCommand('italic');
        else if (cmd === 'h2') document.execCommand('formatBlock', false, 'h2');
        else if (cmd === 'h3') document.execCommand('formatBlock', false, 'h3');
        else if (cmd === 'ul') document.execCommand('insertUnorderedList');
        else if (cmd === 'link') {
          const url = prompt('Link URL (https://…)');
          if (url) document.execCommand('createLink', false, url);
        } else if (cmd === 'save') {
          const html = area.innerHTML;
          try {
            if (rt.dataset.target === 'mission') {
              await api('POST', '/api/settings', { mission: html });
            } else if (rt.dataset.target === 'contact') {
              await api('POST', '/api/settings', { contact: html });
            } else if (rt.dataset.taglineGame) {
              await api('PATCH', `/api/games/${rt.dataset.taglineGame}`, { tagline: html });
            } else if (rt.dataset.sectionId) {
              await api('PATCH', `/api/sections/${rt.dataset.sectionId}`, { data: { html } });
            }
            flash('Saved');
          } catch (err) { fail(err); }
        }
      });
    });
  });

  // --- Hero fields ----------------------------------------------------------
  document.querySelectorAll('input[data-edit-field="title-input"]').forEach((el) => {
    el.addEventListener('change', async () => {
      try { await api('PATCH', `/api/games/${el.dataset.gameId}`, { title: el.value.trim() }); reload(); }
      catch (err) { fail(err); }
    });
  });
  document.querySelectorAll('input[data-edit-field="steam_url"]').forEach((el) => {
    el.addEventListener('change', async () => {
      try { await api('PATCH', `/api/games/${el.dataset.gameId}`, { steam_url: el.value.trim() }); reload(); }
      catch (err) { fail(err); }
    });
  });

  // --- Elevator pitch: click-to-edit. The pitch shows the real prose (identical
  // to public) until clicked, so the layout stays WYSIWYG while moving the logo.
  let activePitch = null;
  let pitchBar = null;
  function positionPitchBar() {
    if (!pitchBar || !activePitch) return;
    const r = activePitch.getBoundingClientRect();
    pitchBar.style.top = Math.max(8, r.top - 46) + 'px';
    pitchBar.style.left = r.left + 'px';
  }
  function endPitchEdit(save) {
    if (!activePitch) return;
    const pitch = activePitch;
    const gameId = pitch.dataset.gameId;
    const html = pitch.innerHTML;
    pitch.classList.remove('is-editing');
    pitch.removeAttribute('contenteditable');
    activePitch = null;
    if (pitchBar) { pitchBar.remove(); pitchBar = null; }
    if (save) api('PATCH', `/api/games/${gameId}`, { tagline: html }).then(() => flash('Pitch saved')).catch(fail);
  }
  function startPitchEdit(pitch) {
    if (activePitch) endPitchEdit(true);
    activePitch = pitch;
    if (pitch.dataset.empty === '1') { pitch.innerHTML = '<p></p>'; pitch.dataset.empty = ''; }
    pitch.classList.add('is-editing');
    pitch.contentEditable = 'true';
    pitch.focus();
    pitchBar = document.createElement('div');
    pitchBar.className = 'pitch-toolbar';
    pitchBar.innerHTML =
      '<button type="button" data-pcmd="bold"><b>B</b></button>' +
      '<button type="button" data-pcmd="italic"><i>I</i></button>' +
      '<button type="button" data-pcmd="link">Link</button>' +
      '<button type="button" data-pcmd="save">Save</button>';
    document.body.appendChild(pitchBar);
    positionPitchBar();
    pitchBar.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection
    pitchBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pcmd]');
      if (!b) return;
      const cmd = b.dataset.pcmd;
      if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'italic') document.execCommand('italic');
      else if (cmd === 'link') { const u = prompt('Link URL (https://…)'); if (u) document.execCommand('createLink', false, u); }
      else if (cmd === 'save') endPitchEdit(true);
    });
  }
  document.addEventListener('click', (e) => {
    const pitch = e.target.closest('[data-tagline-edit]');
    if (pitch && activePitch !== pitch) startPitchEdit(pitch);
  });
  document.addEventListener('mousedown', (e) => {
    if (activePitch && !activePitch.contains(e.target) && !(pitchBar && pitchBar.contains(e.target))) {
      endPitchEdit(true);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activePitch) endPitchEdit(true); });
  window.addEventListener('scroll', positionPitchBar, true);
  window.addEventListener('resize', positionPitchBar);

  // --- Carousel helpers -----------------------------------------------------
  function readCarousel(sectionEl) {
    return Array.from(sectionEl.querySelectorAll('.carousel__slide')).map((fig) => {
      const altInput = fig.querySelector('[data-img-alt]');
      return {
        mediaId: parseInt(altInput?.dataset.imgAlt || fig.dataset.mediaId || '0', 10),
        alt: altInput ? altInput.value : '',
      };
    }).filter((x) => x.mediaId);
  }

  // --- Global click delegation ----------------------------------------------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const section = btn.closest('[data-section-id]');
    const sectionId = section?.dataset.sectionId;

    try {
      switch (action) {
        // ----- games / settings -----
        case 'create-game': {
          const { game } = await api('POST', '/api/games', { title: 'Untitled Game' });
          location.href = `/game/${game.slug}`;
          break;
        }
        case 'delete-game': {
          if (!confirm('Delete this game and all its sections + deck?')) return;
          await api('DELETE', `/api/games/${btn.dataset.gameId}`);
          location.href = '/';
          break;
        }
        case 'hero-image': {
          const [m] = await uploadFiles({ accept: 'image/*' });
          if (m) { await api('PATCH', `/api/games/${btn.dataset.gameId}`, { hero_media: m.id }); reload(); }
          break;
        }
        case 'game-logo': {
          const [m] = await uploadFiles({ accept: 'image/*' });
          if (m) { await api('PATCH', `/api/games/${btn.dataset.gameId}`, { logo_media: m.id }); reload(); }
          break;
        }
        case 'game-logo-remove': {
          await api('PATCH', `/api/games/${btn.dataset.gameId}`, { logo_media: null });
          reload();
          break;
        }
        case 'hero-adjust-toggle': {
          const panel = btn.closest('.hero').querySelector('[data-hero-adjust]');
          if (panel) panel.hidden = !panel.hidden;
          break;
        }
        case 'site-logo': {
          const [m] = await uploadFiles({ accept: 'image/*' });
          if (m) { await api('POST', '/api/settings', { site_logo: m.id }); reload(); }
          break;
        }
        case 'site-logo-remove': {
          await api('POST', '/api/settings', { site_logo: null });
          reload();
          break;
        }

        // ----- sections -----
        case 'add-section': {
          const host = btn.closest('[data-add-section]');
          const { section: created } = await api('POST', '/api/sections', {
            owner_type: host.dataset.ownerType,
            owner_id: host.dataset.ownerId,
            type: btn.dataset.type,
          });
          reload();
          break;
        }
        case 'delete-section': {
          if (!confirm('Delete this section?')) return;
          await api('DELETE', `/api/sections/${sectionId}`);
          reload();
          break;
        }
        case 'move-up':
        case 'move-down': {
          const container = section.closest('[data-sections-owner]');
          const ids = Array.from(container.querySelectorAll(':scope > [data-section-id]')).map(
            (s) => parseInt(s.dataset.sectionId, 10)
          );
          const idx = ids.indexOf(parseInt(sectionId, 10));
          const swap = action === 'move-up' ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= ids.length) return;
          [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
          await api('POST', '/api/sections/reorder', {
            owner_type: container.dataset.sectionsOwner,
            owner_id: container.dataset.ownerId,
            order: ids,
          });
          reload();
          break;
        }

        // ----- carousel -----
        case 'carousel-add': {
          const media = await uploadFiles({ accept: 'image/*', multiple: true });
          if (!media.length) return;
          const images = readCarousel(section).concat(media.map((m) => ({ mediaId: m.id, alt: '' })));
          await api('PATCH', `/api/sections/${sectionId}`, { data: { images } });
          reload();
          break;
        }
        case 'carousel-remove': {
          const removeId = parseInt(btn.dataset.mediaId, 10);
          const images = readCarousel(section).filter((x) => x.mediaId !== removeId);
          await api('PATCH', `/api/sections/${sectionId}`, { data: { images } });
          reload();
          break;
        }

        // ----- buttons -----
        case 'button-add': {
          const list = section.querySelector('.buttons-edit');
          const row = document.createElement('div');
          row.className = 'btn-edit';
          row.innerHTML =
            '<input type="text" data-btn-label placeholder="Label">' +
            '<input type="url" data-btn-url placeholder="https://...">' +
            '<button type="button" class="ctl ctl--danger" data-action="button-remove">✕</button>';
          list.insertBefore(row, list.querySelector('.buttons-edit__actions'));
          break;
        }
        case 'button-remove': {
          btn.closest('.btn-edit').remove();
          break;
        }
        case 'buttons-save': {
          const buttons = Array.from(section.querySelectorAll('.buttons-edit .btn-edit')).map((r) => ({
            label: r.querySelector('[data-btn-label]').value,
            url: r.querySelector('[data-btn-url]').value,
          }));
          await api('PATCH', `/api/sections/${sectionId}`, { data: { buttons } });
          reload();
          break;
        }

        // ----- video (self-hosted upload; transcoded for streaming) -----
        case 'video-upload': {
          const [m] = await uploadFiles({ accept: 'video/*' });
          if (!m) break;
          await api('PATCH', `/api/sections/${sectionId}`, { data: { mediaId: m.id } });
          reload();
          break;
        }

        // ----- team -----
        case 'add-member': {
          await api('POST', '/api/team');
          reload();
          break;
        }
        case 'member-image': {
          const [m] = await uploadFiles({ accept: 'image/*' });
          if (m) { await api('PATCH', `/api/team/${btn.dataset.memberId}`, { image_media: m.id }); reload(); }
          break;
        }
        case 'member-save': {
          const card = btn.closest('[data-member-id]');
          const fields = {};
          card.querySelectorAll('[data-member-field]').forEach((f) => { fields[f.dataset.memberField] = f.value; });
          await api('PATCH', `/api/team/${card.dataset.memberId}`, fields);
          flash('Member saved');
          break;
        }
        case 'member-delete': {
          if (!confirm('Delete this team member?')) return;
          await api('DELETE', `/api/team/${btn.closest('[data-member-id]').dataset.memberId}`);
          reload();
          break;
        }
        case 'member-up':
        case 'member-down': {
          const card = btn.closest('[data-member-id]');
          const grid = card.closest('[data-team-grid]');
          const ids = Array.from(grid.querySelectorAll('[data-member-id]')).map((c) => parseInt(c.dataset.memberId, 10));
          const idx = ids.indexOf(parseInt(card.dataset.memberId, 10));
          const swap = action === 'member-up' ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= ids.length) return;
          [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
          await api('POST', '/api/team/reorder', { order: ids });
          reload();
          break;
        }

        // ----- theme / palette -----
        case 'theme-toggle': {
          const panel = document.querySelector('[data-theme-panel]');
          if (panel) panel.hidden = !panel.hidden;
          break;
        }
        case 'theme-close': {
          const panel = document.querySelector('[data-theme-panel]');
          if (panel) panel.hidden = true;
          break;
        }
        case 'theme-reset': {
          await api('POST', '/api/settings', { reset_theme: true });
          reload(); // reload to re-apply default fonts (Google Fonts link) + colors
          break;
        }
      }
    } catch (err) { fail(err); }
  });

  // --- theme live preview + autosave ----------------------------------------
  // Maps a palette key to the CSS custom properties it drives.
  const THEME_VARS = {
    bg: ['--bg'],
    surface: ['--bg-card', '--bg-elev'],
    text: ['--fg'],
    muted: ['--fg-muted'],
    border: ['--border'],
    accent: ['--accent'],
    accent2: ['--accent-2'],
    btnHighlight: ['--btn-highlight'],
    btnShadow: ['--btn-shadow'],
  };
  function applyTheme(theme) {
    Object.entries(THEME_VARS).forEach(([key, vars]) => {
      if (theme[key]) vars.forEach((v) => document.documentElement.style.setProperty(v, theme[key]));
    });
  }
  let themeSaveTimer = null;
  document.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-theme-key]');
    if (!inp) return;
    const key = inp.dataset.themeKey;
    (THEME_VARS[key] || []).forEach((v) => document.documentElement.style.setProperty(v, inp.value));
    clearTimeout(themeSaveTimer);
    themeSaveTimer = setTimeout(async () => {
      try { await api('POST', '/api/settings', { theme: { [key]: inp.value } }); flash('Palette saved'); }
      catch (err) { fail(err); }
    }, 350);
  });

  // Hero parallax amount slider (site setting) — controls travel only, no scale.
  let parallaxSaveTimer = null;
  document.addEventListener('input', (e) => {
    const p = e.target.closest('[data-parallax]');
    if (!p) return;
    const pct = (parseFloat(p.value) / 100 * 60).toFixed(1);
    document.documentElement.style.setProperty('--hero-parallax-max', pct);
    window.dispatchEvent(new Event('resize')); // let the parallax recompute its pan
    clearTimeout(parallaxSaveTimer);
    parallaxSaveTimer = setTimeout(async () => {
      try { await api('POST', '/api/settings', { parallax: parseInt(p.value, 10) }); flash('Parallax saved'); }
      catch (err) { fail(err); }
    }, 300);
  });

  // --- Featured game selector + font selectors + carousel alt autosave ------
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-action="set-featured"]');
    if (sel) {
      try { await api('POST', '/api/settings', { featured_game_id: sel.value || null }); reload(); }
      catch (err) { fail(err); }
      return;
    }
    const fontSel = e.target.closest('[data-theme-font]');
    if (fontSel) {
      // Reload so the server injects the right Google Fonts link + font vars.
      try { await api('POST', '/api/settings', { theme: { [fontSel.dataset.themeFont]: fontSel.value } }); reload(); }
      catch (err) { fail(err); }
      return;
    }
    const alt = e.target.closest('[data-img-alt]');
    if (alt) {
      const section = alt.closest('[data-section-id]');
      try {
        await api('PATCH', `/api/sections/${section.dataset.sectionId}`, { data: { images: readCarousel(section) } });
        flash('Alt text saved');
      } catch (err) { fail(err); }
      return;
    }
    // Precision-mode toggle: show/hide the fine sliders. When turning OFF, bake
    // the current fine nudges into the coarse sliders and reset fine to 0.
    const precision = e.target.closest('[data-hero-precision]');
    if (precision) {
      const hero = precision.closest('.hero');
      const on = precision.checked;
      hero.querySelectorAll('.hero-adjust__fine').forEach((f) => { f.hidden = !on; });
      if (!on) {
        hero.querySelectorAll('[data-hero-ctl]').forEach((coarse) => {
          const fineEl = hero.querySelector('[data-hero-fine="' + coarse.dataset.heroCtl + '"]');
          if (fineEl) {
            coarse.value = parseFloat(coarse.value) + parseFloat(fineEl.value) * 0.1; // clamps to min/max
            fineEl.value = 0;
          }
        });
      }
    }
  });

  // --- per-game hero/logo adjust: live preview + autosave -------------------
  // Effective value per control = coarse + fine*0.1 (fine = precision nudge).
  function readHeroValues(hero) {
    const v = {};
    hero.querySelectorAll('[data-hero-ctl]').forEach((coarse) => {
      const key = coarse.dataset.heroCtl;
      const fineEl = hero.querySelector('[data-hero-fine="' + key + '"]');
      const fine = fineEl ? parseFloat(fineEl.value) || 0 : 0;
      v[key] = parseFloat(coarse.value) + fine * 0.1;
    });
    return v;
  }
  let heroSaveTimer = null;
  document.addEventListener('input', (e) => {
    const ctl = e.target.closest('[data-hero-ctl], [data-hero-fine]');
    if (!ctl) return;
    const hero = ctl.closest('.hero');
    const gameId = ctl.dataset.gameId;
    const v = readHeroValues(hero);
    const media = hero.querySelector('.hero__media');
    if (media) {
      // Focus is exposed as CSS vars; parallax pans object-position-Y from here.
      media.style.setProperty('--focus-x', (v.heroPosX ?? 50) + '%');
      media.style.setProperty('--focus-y', (v.heroPosY ?? 50) + '%');
      media.style.setProperty('--hero-zoom', (v.heroZoom ?? 100) / 100);
      // Mobile framing vars (only consumed by the ≤820px hero rules).
      media.style.setProperty('--m-hero-zoom', (v.mHeroZoom ?? 140) / 100);
      media.style.setProperty('--m-hero-x', (v.mHeroX ?? 50) + '%');
      media.style.setProperty('--m-hero-y', (v.mHeroY ?? -10) + '%');
      window.dispatchEvent(new Event('resize')); // re-base the parallax pan
    }
    const logo = hero.querySelector('.hero__logo');
    if (logo) {
      logo.style.transform = `translate(${v.logoX || 0}px, calc(-50% + ${v.logoY || 0}px)) scale(${(v.logoScale ?? 100) / 100})`;
      // Vars used by the mobile (centered) logo rule.
      logo.style.setProperty('--logo-scale', (v.logoScale ?? 100) / 100);
      logo.style.setProperty('--logo-y', (v.logoY || 0) + 'px');
    }
    clearTimeout(heroSaveTimer);
    heroSaveTimer = setTimeout(async () => {
      try { await api('PATCH', `/api/games/${gameId}`, { display: v }); flash('Layout saved'); }
      catch (err) { fail(err); }
    }, 300);
  });

  // Refresh a section once its video finishes transcoding.
  (function pollVideoStatus() {
    const el = document.querySelector('[data-video-edit][data-media-id]');
    const id = el && el.dataset.mediaId;
    if (!id) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/media/${id}`, { headers: { 'X-Requested-With': 'poll' } });
        const data = await res.json();
        if (data.media && data.media.status !== 'processing') return location.reload();
      } catch (_) {}
      setTimeout(tick, 3000);
    };
    // Only poll while actually processing (the status span is present).
    if (document.querySelector('[data-video-status]')) setTimeout(tick, 3000);
  })();
})();
