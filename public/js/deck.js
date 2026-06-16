// Public pitch-deck presentation viewer: keyboard + on-screen navigation,
// fullscreen toggle. Read-only.
(function () {
  'use strict';
  const viewer = document.querySelector('[data-deck-viewer]');
  if (!viewer) return;

  const slides = Array.from(viewer.querySelectorAll('.deck-slide'));
  const counter = viewer.querySelector('[data-deck-current]');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));
  let transitioning = false;

  // Pre-decode the adjacent slides' images so the next page turn is instant.
  function preload(idx) {
    [idx - 1, idx + 1].forEach((k) => {
      if (k < 0 || k >= slides.length) return;
      slides[k].querySelectorAll('img').forEach((img) => {
        if (img.decode) img.decode().catch(() => {});
      });
    });
  }

  function finish(prev, target, t, cls) {
    prev.classList.remove('is-active');
    target.classList.remove('is-entering', cls);
    target.classList.add('is-active');
    i = t;
    if (counter) counter.textContent = String(i + 1);
    transitioning = false;
    preload(t);
  }

  // Mask reveal (in place): a feathered mask wipes the incoming slide in, driven
  // by --wipe on the viewer; the white line follows the same --wipe. dir +1 =
  // next (R→L), -1 = prev (L→R).
  function go(n, dir) {
    if (!slides.length || transitioning) return;
    const t = Math.min(Math.max(n, 0), slides.length - 1);
    if (t === i) return;
    const d = dir || (t > i ? 1 : -1);
    const prev = slides[i];
    const target = slides[t];
    if (reduceMotion) {
      prev.classList.remove('is-active');
      target.classList.add('is-active');
      i = t;
      if (counter) counter.textContent = String(i + 1);
      preload(t);
      return;
    }
    transitioning = true;
    const cls = d > 0 ? 'reveal-next' : 'reveal-prev';
    const dirCls = d > 0 ? 'wipe-next' : 'wipe-prev';
    target.classList.add('is-entering', cls);
    viewer.classList.remove('is-wiping', 'wipe-next', 'wipe-prev');
    void viewer.offsetWidth; // restart the --wipe animation cleanly
    viewer.classList.add('is-wiping', dirCls);
    viewer.addEventListener('animationend', function done(e) {
      if (e.target !== viewer || e.animationName !== 'deckWipe') return;
      viewer.removeEventListener('animationend', done);
      finish(prev, target, t, cls);
      viewer.classList.remove('is-wiping', dirCls);
    });
  }

  preload(i);

  viewer.querySelector('[data-deck-prev]')?.addEventListener('click', () => go(i - 1, -1));
  viewer.querySelector('[data-deck-next]')?.addEventListener('click', () => go(i + 1, 1));

  // Click-through transparent image pixels: if you click a transparent part of
  // an image layer, forward the click to the layer beneath it. Opaque pixels
  // block (the image is "solid" there). Images are same-origin so readable.
  function alphaAt(img, clientX, clientY) {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) return 255;
    const scale = Math.min(r.width / nw, r.height / nh); // object-fit: contain
    const rw = nw * scale, rh = nh * scale;
    const ox = (r.width - rw) / 2, oy = (r.height - rh) / 2;
    const cx = clientX - r.left - ox, cy = clientY - r.top - oy;
    if (cx < 0 || cy < 0 || cx > rw || cy > rh) return 0; // letterbox = transparent
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, cx / scale, cy / scale, 1, 1, 0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    } catch (_) {
      return 255; // unreadable -> treat as opaque (don't break clicks)
    }
  }
  viewer.addEventListener('click', (e) => {
    const top = e.target;
    if (!top.matches || !top.matches('.slide-block--image img')) return;
    if (alphaAt(top, e.clientX, e.clientY) > 12) return; // opaque -> block
    // Transparent: forward to the first element below that isn't also transparent.
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (el === top) continue;
      if (el.matches && el.matches('.slide-block--image img') && alphaAt(el, e.clientX, e.clientY) <= 12) continue;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: e.clientX, clientY: e.clientY }));
      break;
    }
  });

  // (Video playback UI removed — the slide-deck video player is being rebuilt
  // with custom controls. Slides render no player/iframe/controls for now, so no
  // YouTube/Vimeo chrome can appear; see renderSlideBlock.)

  viewer.querySelector('[data-deck-fullscreen]')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else viewer.requestFullscreen?.();
  });

  // Go true-fullscreen on the first user gesture (browsers block it on load).
  let triedFs = false;
  function maybeFullscreen() {
    if (triedFs) return;
    triedFs = true;
    if (!document.fullscreenElement) viewer.requestFullscreen?.().catch(() => {});
  }
  viewer.querySelector('.deck-stage')?.addEventListener('pointerdown', maybeFullscreen);

  // Auto-hide controls + cursor after the mouse goes idle; reveal on movement.
  let idleTimer = null;
  function showControls() {
    viewer.classList.remove('controls-hidden');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => viewer.classList.add('controls-hidden'), 2200);
  }
  viewer.addEventListener('mousemove', showControls);
  viewer.addEventListener('pointerdown', showControls);
  showControls();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { go(i + 1, 1); maybeFullscreen(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(i - 1, -1); maybeFullscreen(); e.preventDefault(); }
    else if (e.key === 'Home') { go(0, -1); }
    else if (e.key === 'End') { go(slides.length - 1, 1); }
  });

  // Basic swipe support.
  let startX = null;
  viewer.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1, dx < 0 ? 1 : -1);
    startX = null;
  });

  viewer.focus();
})();
