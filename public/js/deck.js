// Public pitch-deck presentation viewer: keyboard + on-screen navigation,
// fullscreen toggle. Read-only.
(function () {
  'use strict';
  const viewer = document.querySelector('[data-deck-viewer]');
  if (!viewer) return;

  const slides = Array.from(viewer.querySelectorAll('.deck-slide'));
  const counter = viewer.querySelector('[data-deck-current]');
  let i = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));

  function go(n) {
    if (!slides.length) return;
    slides[i].classList.remove('is-active');
    i = Math.min(Math.max(n, 0), slides.length - 1);
    slides[i].classList.add('is-active');
    if (counter) counter.textContent = String(i + 1);
  }

  viewer.querySelector('[data-deck-prev]')?.addEventListener('click', () => go(i - 1));
  viewer.querySelector('[data-deck-next]')?.addEventListener('click', () => go(i + 1));

  viewer.querySelector('[data-deck-fullscreen]')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else viewer.requestFullscreen?.();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { go(i + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(i - 1); e.preventDefault(); }
    else if (e.key === 'Home') { go(0); }
    else if (e.key === 'End') { go(slides.length - 1); }
  });

  // Basic swipe support.
  let startX = null;
  viewer.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1);
    startX = null;
  });

  viewer.focus();
})();
