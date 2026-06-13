// Public, read-only behaviors: image carousels and the press-kit request flow.
(function () {
  'use strict';

  // --- Image carousels ------------------------------------------------------
  document.querySelectorAll('[data-carousel]').forEach((root) => {
    const slides = Array.from(root.querySelectorAll('.carousel__slide'));
    if (slides.length <= 1) return;
    let i = slides.findIndex((s) => s.classList.contains('is-active'));
    if (i < 0) i = 0;
    const show = (n) => {
      slides[i].classList.remove('is-active');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('is-active');
    };
    const prev = root.querySelector('.carousel__prev');
    const next = root.querySelector('.carousel__next');
    if (prev) prev.addEventListener('click', () => show(i - 1));
    if (next) next.addEventListener('click', () => show(i + 1));
  });

  // --- Custom scroll-position indicator (replaces the hidden native bar) -----
  (function scrollIndicator() {
    const el = document.createElement('div');
    el.className = 'scroll-indicator';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    let raf = null;

    // Track geometry: keep the pill below the (fixed) header with clearance, and
    // a matching bottom margin — so its travel never overlaps the bar.
    function metrics() {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
      const topMin = headerH + 12;
      const range = Math.max(1, window.innerHeight - el.offsetHeight - topMin - 12);
      return { docH, topMin, range };
    }
    function update() {
      raf = null;
      const { docH, topMin, range } = metrics();
      if (docH <= 4) { el.style.display = 'none'; return; }
      el.style.display = '';
      const progress = Math.min(1, Math.max(0, window.scrollY / docH));
      el.style.transform = `translateY(${(topMin + progress * range).toFixed(1)}px)`;
    }
    function onScroll() { if (raf == null) raf = requestAnimationFrame(update); }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    // Drag to scroll, like a scrollbar thumb.
    let dragging = false, startY = 0, startScroll = 0;
    el.addEventListener('pointerdown', (e) => {
      dragging = true; startY = e.clientY; startScroll = window.scrollY;
      el.classList.add('is-dragging');
      // Disable smooth scroll-behavior during the drag so it tracks the cursor
      // 1:1 and snappily, instead of animating (rubber-banding) to each target.
      document.documentElement.style.scrollBehavior = 'auto';
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const { docH, range } = metrics();
      window.scrollTo(0, startScroll + ((e.clientY - startY) / range) * docH);
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false; el.classList.remove('is-dragging');
      document.documentElement.style.scrollBehavior = ''; // restore CSS (smooth)
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    update();
  })();

  // --- Hero parallax (smoothed with a lerp so snappy scrolls stay smooth) ----
  (function heroParallax() {
    const media = document.querySelector('.hero__media');
    if (!media) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hero = media.closest('.hero');
    let goal = 50;
    let current = 50;
    let raf = null;

    // Parallax pans object-position-Y from the focus point downward as the hero
    // scrolls out. Clamped to 0–100% so cover always fills (never a gap/edge).
    function recompute() {
      const cs = getComputedStyle(media);
      const focusY = parseFloat(cs.getPropertyValue('--focus-y')) || 50;
      const maxPan = parseFloat(cs.getPropertyValue('--hero-parallax-max')) || 0;
      const h = hero.offsetHeight || 1;
      // 0 when the hero top is at the viewport top, 1 when fully scrolled past.
      const progress = Math.max(0, Math.min(1, -hero.getBoundingClientRect().top / h));
      goal = Math.max(0, Math.min(100, focusY + progress * maxPan));
    }
    function tick() {
      current += (goal - current) * 0.12; // lerp toward goal
      if (Math.abs(goal - current) < 0.05) current = goal;
      media.style.setProperty('--parallax-pos', current.toFixed(2) + '%');
      raf = current === goal ? null : requestAnimationFrame(tick);
    }
    function onScroll() {
      recompute();
      if (raf == null) raf = requestAnimationFrame(tick);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    recompute();
    current = goal;
    media.style.setProperty('--parallax-pos', current.toFixed(2) + '%');
  })();

  // --- Games catalogue carousel (animated swipe) ----------------------------
  document.querySelectorAll('[data-games-carousel]').forEach((root) => {
    const track = root.querySelector('.games-track');
    const slides = Array.from(root.querySelectorAll('.game-slide'));
    const dots = Array.from(root.querySelectorAll('.games-dot'));
    if (slides.length <= 1) return;
    let i = 0;

    function go(n) {
      i = (n + slides.length) % slides.length; // wrap around
      track.style.transform = `translateX(-${i * 100}%)`;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === i));
    }

    root.querySelector('[data-games-prev]')?.addEventListener('click', () => go(i - 1));
    root.querySelector('[data-games-next]')?.addEventListener('click', () => go(i + 1));
    dots.forEach((d) => d.addEventListener('click', () => go(parseInt(d.dataset.goto, 10))));

    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { go(i + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { go(i - 1); e.preventDefault(); }
    });

    // Touch / pointer swipe.
    let startX = null;
    root.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1);
      startX = null;
    });
  });

  // --- Press-kit flow -------------------------------------------------------
  const flow = document.querySelector('[data-press-flow]');
  if (!flow) return;

  const stepType = flow.querySelector('[data-step="type"]');
  const form = flow.querySelector('[data-step="form"]');
  const confirm = flow.querySelector('[data-step="confirm"]');
  const intro = form.querySelector('[data-form-intro]');
  const hidden = form.querySelector('input[name="press_type"]');
  const status = form.querySelector('.press-form__status');

  const labelOutlet = form.querySelector('[data-label-outlet]');
  const labelAudience = form.querySelector('[data-label-audience]');
  const roleField = form.querySelector('[data-field="role"]');

  const COPY = {
    creator: {
      intro: "Great — tell us about your channel and we'll sort you out with keys.",
      outlet: 'Channel name',
      audience: 'Subscriber / follower count',
      showRole: false,
    },
    editorial: {
      intro: "Thanks for covering us — a few details about your publication, please.",
      outlet: 'Publication name',
      audience: 'Readership / monthly visitors',
      showRole: true,
    },
  };

  function choose(type) {
    const c = COPY[type];
    if (!c) return;
    hidden.value = type;
    intro.textContent = c.intro;
    if (labelOutlet) labelOutlet.textContent = c.outlet;
    if (labelAudience) labelAudience.textContent = c.audience;
    if (roleField) roleField.hidden = !c.showRole;
    stepType.hidden = true;
    form.hidden = false;
    form.querySelector('input[name="name"]').focus();
  }

  flow.querySelectorAll('[data-press-type]').forEach((btn) => {
    btn.addEventListener('click', () => choose(btn.getAttribute('data-press-type')));
  });

  const back = form.querySelector('[data-press-back]');
  if (back)
    back.addEventListener('click', () => {
      form.hidden = true;
      stepType.hidden = false;
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.classList.remove('is-error');
    status.textContent = 'Sending…';
    const fd = new FormData(form);
    const payload = {
      press_type: fd.get('press_type'),
      name: fd.get('name'),
      email: fd.get('email'),
      outlet: fd.get('outlet'),
      outlet_url: fd.get('outlet_url'),
      audience: fd.get('audience'),
      role: fd.get('role'),
      message: fd.get('message'),
      games: fd.getAll('games'),
    };
    try {
      const res = await fetch('/press/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed.');
      form.hidden = true;
      confirm.hidden = false;
    } catch (err) {
      status.classList.add('is-error');
      status.textContent = err.message || 'Something went wrong. Please try again.';
    }
  });
})();
