// Public, read-only behaviors: image carousels and the press-kit request flow.
(function () {
  'use strict';

  // --- Click feedback: bounce + shape-matched shockwave on every button -----
  (function clickFeedback() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const SELECTOR = 'button, a.btn, .site-nav a, .brand';
    let layer = null;
    const fxLayer = () => (layer || (layer = document.body.appendChild(
      Object.assign(document.createElement('div'), { className: 'fx-layer' })
    )));
    document.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return; // primary button only
      const btn = e.target.closest(SELECTOR);
      if (!btn || btn.disabled) return;
      // Press bounce: scale down → overshoot → settle. Animating the `scale`
      // property (not `transform`) lets it compose with each button's existing
      // transform-based hover/float instead of overriding it.
      btn.animate(
        [
          { scale: '1' }, { scale: '0.85', offset: 0.2 }, { scale: '1.08', offset: 0.45 },
          { scale: '0.97', offset: 0.65 }, { scale: '1.02', offset: 0.82 }, { scale: '1' },
        ],
        { duration: 460, easing: 'ease-out' }
      );
      // Shockwave: a ring the size + shape (border-radius) of the button.
      const r = btn.getBoundingClientRect();
      if (!r.width) return;
      const wave = document.createElement('span');
      wave.className = 'shockwave';
      wave.style.cssText =
        `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
        `border-radius:${getComputedStyle(btn).borderRadius}`;
      fxLayer().appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove());
    });
  })();

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

  // --- Mobile nav (hamburger) toggle ----------------------------------------
  (function navToggle() {
    const btn = document.querySelector('[data-nav-toggle]');
    const nav = document.getElementById('site-nav');
    if (!btn || !nav) return;
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    // Close after navigating, and on outside click / Escape.
    nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('is-open') && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  })();

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
    let base = 50, maxPan = 0; // refreshed from CSS each recompute
    let goalProg = 0, current = 0; // scroll progress 0→1 (smoothed via `current`)
    let raf = null;

    // `progress` = 0 when the hero top is at the viewport top, 1 when fully
    // scrolled past. Desktop pans object-position-Y from the focus point
    // downward; mobile (where object-position-Y can't move a tall crop) shifts
    // the art via a translateY offset instead. Same scroll-driven amount.
    function recompute() {
      const cs = getComputedStyle(media);
      base = parseFloat(cs.getPropertyValue('--focus-y')) || 50;
      maxPan = parseFloat(cs.getPropertyValue('--hero-parallax-max')) || 0;
      const h = hero.offsetHeight || 1;
      goalProg = Math.max(0, Math.min(1, -hero.getBoundingClientRect().top / h));
    }
    function apply() {
      // Desktop: object-position-Y from the focus point, clamped so cover fills.
      const pos = Math.max(0, Math.min(100, base + current * maxPan));
      media.style.setProperty('--parallax-pos', pos.toFixed(2) + '%');
      // Mobile: translateY offset (added to the framing translate). No clamp —
      // any exposed edge is filled by the hero edge-extension layers.
      media.style.setProperty('--m-parallax-y', (current * maxPan).toFixed(2) + '%');
    }
    function tick() {
      current += (goalProg - current) * 0.12; // lerp toward goal
      if (Math.abs(goalProg - current) < 0.0005) current = goalProg;
      apply();
      raf = current === goalProg ? null : requestAnimationFrame(tick);
    }
    function onScroll() {
      recompute();
      if (raf == null) raf = requestAnimationFrame(tick);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    recompute();
    current = goalProg;
    apply();
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
