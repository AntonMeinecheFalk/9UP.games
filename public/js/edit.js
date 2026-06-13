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

  // Opens a file picker and uploads the chosen file(s). Returns media rows.
  function uploadFiles({ accept, multiple } = {}) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || 'image/*';
      input.multiple = !!multiple;
      input.addEventListener('change', async () => {
        if (!input.files.length) return resolve([]);
        const fd = new FormData();
        for (const f of input.files) fd.append('files', f);
        try {
          const res = await fetch('/api/media', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          resolve(data.media || []);
        } catch (err) {
          reject(err);
        }
      });
      input.click();
    });
  }

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
  document.querySelectorAll('[data-edit-field="title"]').forEach((el) => {
    const gameId = el.closest('[data-game-id]')?.dataset.gameId;
    el.addEventListener('blur', async () => {
      try { await api('PATCH', `/api/games/${gameId}`, { title: el.textContent.trim() }); flash('Title saved'); }
      catch (err) { fail(err); }
    });
  });
  document.querySelectorAll('input[data-edit-field="steam_url"]').forEach((el) => {
    el.addEventListener('change', async () => {
      try { await api('PATCH', `/api/games/${el.dataset.gameId}`, { steam_url: el.value.trim() }); reload(); }
      catch (err) { fail(err); }
    });
  });

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

        // ----- video -----
        case 'video-upload': {
          const [m] = await uploadFiles({ accept: 'video/*' });
          if (m) { section.querySelector('[data-video-edit]').dataset.mediaId = m.id; flash('Video uploaded — click Save video'); }
          break;
        }
        case 'video-save': {
          const wrap = section.querySelector('[data-video-edit]');
          const mode = wrap.querySelector(`input[name="vmode-${sectionId}"]:checked`)?.value || 'url';
          const data = mode === 'file'
            ? { mode: 'file', mediaId: parseInt(wrap.dataset.mediaId || '0', 10) || null }
            : { mode: 'url', url: wrap.querySelector('[data-video-url]').value.trim() };
          await api('PATCH', `/api/sections/${sectionId}`, { data });
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
      }
    } catch (err) { fail(err); }
  });

  // --- Featured game selector + carousel alt autosave -----------------------
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-action="set-featured"]');
    if (sel) {
      try { await api('POST', '/api/settings', { featured_game_id: sel.value || null }); reload(); }
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
    }
  });

  // Video mode radio toggling.
  document.addEventListener('change', (e) => {
    const radio = e.target.closest('[data-video-edit] input[type="radio"]');
    if (!radio) return;
    const wrap = radio.closest('[data-video-edit]');
    const isFile = radio.value === 'file';
    wrap.querySelector('.video-edit__url').hidden = isFile;
    wrap.querySelector('.video-edit__file').hidden = !isFile;
  });
})();
