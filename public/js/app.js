// Public, read-only behaviors (carousels, parallax, press flow, click feedback)
// plus a soft "persistent-header" navigation: clicking a header/brand link swaps
// only <main> instead of doing a full page load, so the header — and any
// animation playing on it (the click bounce + shockwave) — survives the
// navigation instead of being torn down mid-flight.
(function () {
  'use strict';

  const reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ======================================================================
  // GLOBAL widgets — wired once. These live on the header or <body>, which
  // soft-nav never replaces, so they must NOT be re-initialised per page.
  // ======================================================================

  // --- Click feedback: bounce + shape-matched shockwave on every button -----
  (function clickFeedback() {
    if (reduceMotion) return;
    const SELECTOR = 'button, a.btn, .site-nav a, .brand';
    let layer = null;
    const fxLayer = () => (layer || (layer = document.body.appendChild(
      Object.assign(document.createElement('div'), { className: 'fx-layer' })
    )));
    // The button's actual rendered corner radius in px — clamped to half the
    // shorter side (so a "999px"/"50%" pill resolves to its real end radius) and
    // resolving a percentage against the box. This is the radius the equidistant
    // ring starts from; growing the box by d and the radius by d keeps the offset
    // constant everywhere.
    const effectiveRadius = (btn, r) => {
      const br = getComputedStyle(btn).borderTopLeftRadius;
      const val = br.endsWith('%') ? (parseFloat(br) / 100) * Math.min(r.width, r.height) : (parseFloat(br) || 0);
      return Math.min(val, r.width / 2, r.height / 2);
    };
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
      // Shockwave: a ring that starts as the button's exact outline and expands
      // by a CONSTANT offset on every side (box +2d, radius +d) so it stays
      // equidistant from the button — a pill stays two half-circles joined by
      // parallel lines instead of ballooning at the ends like a uniform scale
      // would. Lives in the body-level .fx-layer so a soft-nav swap can't cut it.
      const r = btn.getBoundingClientRect();
      if (!r.width) return;
      const R = effectiveRadius(btn, r); // the button's real corner radius (px)
      const d = r.height * 0.7; // how far the ring travels outward
      const wave = document.createElement('span');
      wave.className = 'shockwave';
      wave.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${R}px`;
      fxLayer().appendChild(wave);
      const anim = wave.animate(
        // Stays fully opaque while the line thins (5px → 1px); only at the very
        // end — once it's 1px and can't visibly get thinner — does it fade out.
        // Geometry is on the 0/1 keyframes so it eases across the whole travel;
        // border-width + opacity get an extra keyframe at 0.8 for the late fade.
        [
          { offset: 0, left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
            borderRadius: `${R}px`, borderWidth: '5px', opacity: 1 },
          { offset: 0.8, borderWidth: '1px', opacity: 1 },
          { offset: 1, left: `${r.left - d}px`, top: `${r.top - d}px`, width: `${r.width + 2 * d}px`, height: `${r.height + 2 * d}px`,
            borderRadius: `${R + d}px`, borderWidth: '1px', opacity: 0 },
        ],
        { duration: 550, easing: 'cubic-bezier(0.2, 0.6, 0.35, 1)' }
      );
      anim.finished.then(() => wave.remove(), () => wave.remove());
    });
  })();

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

  // --- Pitch-deck popup -----------------------------------------------------
  // Open the deck in-page (over the hero) instead of navigating. Delegated, so
  // it keeps working for the popup markup swapped in by soft-nav. Sequence:
  // the hero panel slides down + the backdrop blurs/darkens, THEN the glass card
  // bounce-grows from the centre, and once it's full-size the arrows slide out
  // from behind its edges with their own bounce.
  (function deckPopup() {
    let isOpen = false, pop = null, hero = null, opener = null;
    let slides = [], idx = 0, savedScrollY = 0;

    const showSlide = (n) => {
      if (!slides.length) return;
      slides[idx] && slides[idx].classList.remove('is-active');
      idx = (n + slides.length) % slides.length;
      slides[idx].classList.add('is-active');
    };

    function open(btn) {
      pop = document.querySelector('[data-deck-pop]');
      if (!pop || isOpen) return;
      isOpen = true;
      opener = btn;
      hero = btn.closest('.hero');
      slides = Array.from(pop.querySelectorAll('.deck-slide'));
      idx = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));
      const card = pop.querySelector('[data-deck-card]');
      const closeBtn = pop.querySelector('.deck-pop__close');
      const arrows = Array.from(pop.querySelectorAll('.deck-pop__prev, .deck-pop__next'));
      const controls = [closeBtn, ...arrows].filter(Boolean);
      const loader = pop.querySelector('[data-deck-loader]');
      // Clear any leftover (fill:both) animations from a previous open/close, or
      // their held end-states would re-assert (e.g. the close fade-out's opacity:0
      // would reappear and hide the controls after the slide-in is cancelled).
      [card, ...controls].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));

      savedScrollY = window.scrollY || window.pageYOffset || 0; // restore exactly on close
      document.documentElement.style.overflow = 'hidden';       // lock background scroll
      document.documentElement.classList.add('deck-open');      // slide the header up out of frame
      if (hero) hero.classList.add('is-deck-open');             // slide the hero panel down
      if (loader) loader.classList.remove('is-done');           // show the blue + bobbing-logo loader
      pop.hidden = false;
      void pop.offsetWidth;
      pop.classList.add('is-open');                             // fade the backdrop in (CSS)

      // Decode every slide image up front so paging through them never hitches.
      // Race a 5s safety cap so a slow/stuck decode can never trap the loader.
      const imgs = Array.from(pop.querySelectorAll('.deck-slide img'));
      const decoded = Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
      const preloaded = Promise.race([decoded, new Promise((res) => setTimeout(res, 5000))]);
      const reveal = () => { if (loader) loader.classList.add('is-done'); }; // logo flies up, blue fades

      // Bounce a single control out from behind the card edge. Landscape/desktop:
      // arrows from the sides, close from the top-right. Portrait: arrows up from
      // below, close down from above (the stacked layout — see the portrait media query).
      const portrait = window.matchMedia('(max-width: 820px) and (orientation: portrait)').matches;
      const slideIn = (a) => {
        const isClose = a.classList.contains('deck-pop__close');
        let from, to;
        if (portrait) {
          from = isClose ? 'translateY(34px) scale(0.4)' : 'translateY(-34px) scale(0.5)';
          to = 'translateY(0) scale(1)';
        } else {
          from = isClose
            ? 'translate(-22px, 56px) scale(0.4)'
            : `translateY(-50%) translateX(${a.classList.contains('deck-pop__prev') ? 70 : -70}px) scale(0.5)`;
          to = isClose ? 'translate(0, 0) scale(1)' : 'translateY(-50%) translateX(0) scale(1)';
        }
        a.style.opacity = '';
        const out = a.animate(
          [{ transform: from, opacity: 0 }, { transform: to, opacity: 1 }],
          { duration: 440, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' }
        );
        out.onfinish = () => { a.style.transform = ''; out.cancel(); };
      };

      if (reduceMotion) {
        card.style.transform = 'scale(1)';
        preloaded.finally(reveal);
      } else {
        controls.forEach((a) => { a.style.opacity = '0'; });    // hidden until their turn
        const grow = card.animate(
          [
            { transform: 'scale(0)', opacity: 0, offset: 0 },
            { transform: 'scale(1.06)', opacity: 1, offset: 0.72 },
            { transform: 'scale(0.985)', offset: 0.87 },
            { transform: 'scale(1)', offset: 1 },
          ],
          { duration: 540, delay: 200, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)', fill: 'both' }
        );
        const grown = grow.finished.then(() => { card.style.transform = 'scale(1)'; grow.cancel(); }).catch(() => {});
        // The X pops as soon as the card lands — it doesn't wait for the preload.
        grown.then(() => { if (isOpen && closeBtn) slideIn(closeBtn); });
        // The arrows wait until the card is up AND every slide is decoded; then the
        // loader reveals the deck and the arrows bounce out (so paging is hitch-free).
        Promise.all([grown, preloaded]).then(() => {
          if (!isOpen) return;
          reveal();
          arrows.forEach(slideIn);
        });
      }
      const frame = pop.querySelector('.deck-pop__frame');
      if (frame) frame.focus({ preventScroll: true });
    }

    function close() {
      if (!isOpen || !pop) return;
      isOpen = false;
      const _pop = pop, _hero = hero, _opener = opener;
      const card = _pop.querySelector('[data-deck-card]');
      const controls = Array.from(_pop.querySelectorAll('.deck-pop__prev, .deck-pop__next, .deck-pop__close'));
      if (_hero) _hero.classList.remove('is-deck-open');
      _pop.classList.remove('is-open');
      document.documentElement.classList.remove('deck-open'); // header slides back down
      document.documentElement.style.overflow = '';
      window.scrollTo(0, savedScrollY); // undo any scroll shift from the lock / focus
      const finish = () => {
        _pop.hidden = true;
        // Cancel the fade-out (fill:both) animations so they don't linger and
        // re-assert opacity:0 on the next open.
        card.getAnimations().forEach((a) => a.cancel());
        card.style.transform = '';
        controls.forEach((a) => { a.getAnimations().forEach((an) => an.cancel()); a.style.opacity = ''; a.style.transform = ''; });
      };
      if (reduceMotion) {
        finish();
      } else {
        controls.forEach((a) => a.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'both' }));
        const shrink = card.animate(
          [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.1)', opacity: 0 }],
          { duration: 280, easing: 'cubic-bezier(0.5, 0, 0.75, 0.2)', fill: 'both' }
        );
        shrink.onfinish = () => { shrink.cancel(); finish(); };
      }
      if (_opener && _opener.focus) _opener.focus({ preventScroll: true });
      pop = null; hero = null; opener = null;
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-deck-open]');
      if (btn) { e.preventDefault(); open(btn); return; }
      if (!isOpen) return;
      if (e.target.closest('[data-deck-close]')) { e.preventDefault(); close(); return; }
      if (e.target.closest('[data-deck-prev]')) { showSlide(idx - 1); return; }
      if (e.target.closest('[data-deck-next]')) { showSlide(idx + 1); return; }
    });
    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') showSlide(idx + 1);
      else if (e.key === 'ArrowLeft') showSlide(idx - 1);
    });
    let sx = null;
    document.addEventListener('touchstart', (e) => { if (isOpen) sx = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!isOpen || sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) showSlide(dx < 0 ? idx + 1 : idx - 1);
      sx = null;
    });
  })();

  // ======================================================================
  // PER-PAGE widgets — re-run after every soft-nav content swap. Widgets
  // that attach window-level listeners register a teardown so they don't
  // leak (or keep pointing at a removed element) across navigations.
  // ======================================================================
  let teardowns = [];

  function initContent() {
    teardowns.forEach((fn) => fn());
    teardowns = [];
    initCarousels();
    initGamesCarousel();
    initHeroParallax();
    initPressFlow();
  }

  // --- Image carousels ------------------------------------------------------
  function initCarousels() {
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
  }

  // --- Games catalogue carousel (animated swipe) ----------------------------
  function initGamesCarousel() {
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
  }

  // --- Hero parallax (smoothed with a lerp so snappy scrolls stay smooth) ----
  function initHeroParallax() {
    const media = document.querySelector('.hero__media');
    if (!media) return;
    if (reduceMotion) return;
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
    teardowns.push(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf != null) cancelAnimationFrame(raf);
    });
  }

  // --- Press-kit flow -------------------------------------------------------
  function initPressFlow() {
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
  }

  // ======================================================================
  // Soft navigation — keep the header (and its running animation) alive.
  // Only the standard "shell" pages (same layout + app.js, no per-page head
  // scripts) participate; everything else falls back to a full page load.
  // ======================================================================
  (function softNav() {
    const main = document.getElementById('main');
    if (!main || !window.history.pushState) return;
    // Don't intercept on pages with their own scripts/state (edit mode, the
    // pitch-deck viewer/editor) — those need a real load to set up correctly.
    const cls = document.body.classList;
    if (cls.contains('is-edit') || cls.contains('page-deck') || cls.contains('page-deck-edit')) return;

    const SHELL = new Set(['/', '/games', '/about', '/press']);
    let token = 0; // guards against out-of-order responses when clicking fast
    history.scrollRestoration = 'manual';

    // Mark the nav link for `path` as the current page (header + mobile dropdown).
    function setActiveNav(path) {
      document.querySelectorAll('.site-nav a, .site-nav-drop a').forEach((a) => {
        if (a.getAttribute('href') === path) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }

    async function navigate(path, push) {
      const mine = ++token;
      let html;
      try {
        const res = await fetch(path, { headers: { 'X-Requested-With': 'softnav' } });
        if (!res.ok || res.redirected) { location.href = path; return; }
        html = await res.text();
      } catch { location.href = path; return; }
      if (mine !== token) return; // a newer navigation superseded this one
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const newMain = doc.getElementById('main');
      // Bail to a full load if the target isn't a normal shell page after all.
      if (!newMain || doc.body.classList.contains('is-edit') ||
          doc.body.classList.contains('page-deck')) { location.href = path; return; }
      document.title = doc.title;
      document.body.className = doc.body.className;
      // Keep the stylesheet fresh: soft-nav swaps <main> but not <head>, so after
      // a deploy the served CSS version (?v=) changes — adopt it, or we'd keep
      // rendering swapped-in markup against stale CSS.
      const newCss = doc.querySelector('link[rel="stylesheet"][href*="/css/styles.css"]');
      const curCss = document.querySelector('link[rel="stylesheet"][href*="/css/styles.css"]');
      if (newCss && curCss && newCss.getAttribute('href') !== curCss.getAttribute('href')) {
        curCss.setAttribute('href', newCss.getAttribute('href'));
      }
      main.innerHTML = newMain.innerHTML;
      if (push) history.pushState({ softnav: true }, '', path);
      window.scrollTo(0, 0);
      setActiveNav(location.pathname); // header persists, so update its highlight here
      initContent();
      // Nudge the persistent scroll indicator to re-measure the new page height.
      window.dispatchEvent(new Event('resize'));
      // Move focus to the new content for keyboard / screen-reader users.
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }

    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest('.site-nav a, .site-nav-drop a, .brand');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
      if (u.origin !== location.origin || !SHELL.has(u.pathname)) return; // let the browser handle it
      e.preventDefault();
      if (u.pathname === location.pathname && u.search === location.search) {
        window.scrollTo({ top: 0, behavior: 'smooth' }); // same page → just go up
        return;
      }
      navigate(u.pathname + u.search, true);
    });

    window.addEventListener('popstate', () => {
      if (SHELL.has(location.pathname)) navigate(location.pathname + location.search, false);
      else location.reload();
    });
  })();

  // First (server-rendered) page.
  initContent();
})();
