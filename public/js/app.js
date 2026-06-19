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
    // Play-arrow shockwave: a rounded-triangle ring (a corner circle at each of the
    // triangle's points, joined by their tangent lines) that expands equidistantly
    // and fades — the shaped analogue of the box ring. Growing the offset `r` keeps
    // every point the same distance out, so it rounds toward a circle as it travels.
    // Vertices match the play clip (#vt-clip-play).
    const TRI_VERTS = [[0.34, 0.214], [0.80, 0.50], [0.34, 0.786]];
    const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const triPath = (centers, r) => {
      const n = centers.length, nm = [];
      for (let i = 0; i < n; i++) {
        const a = centers[i], b = centers[(i + 1) % n], d = unit(b[0] - a[0], b[1] - a[1]);
        nm.push([d[1], -d[0]]); // outward edge normal (clockwise winding, y-down)
      }
      let s = '';
      for (let i = 0; i < n; i++) {
        const C = centers[i], nIn = nm[(i + n - 1) % n], nOut = nm[i];
        const ax = C[0] + r * nIn[0], ay = C[1] + r * nIn[1];
        const bx = C[0] + r * nOut[0], by = C[1] + r * nOut[1];
        s += `${i ? 'L' : 'M'} ${ax.toFixed(1)} ${ay.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)} `;
      }
      return s + 'Z';
    };
    const triShockwave = (rect) => {
      const NS = 'http://www.w3.org/2000/svg';
      const centers = TRI_VERTS.map(([x, y]) => [rect.left + x * rect.width, rect.top + y * rect.height]);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'shockwave-tri');
      svg.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none';
      const path = document.createElementNS(NS, 'path');
      svg.appendChild(path);
      fxLayer().appendChild(svg);
      const r0 = rect.width * 0.07, travel = rect.height * 0.7, DUR = 550;
      let start = null;
      const tick = (now) => {
        if (start == null) start = now;
        let t = (now - start) / DUR; if (t > 1) t = 1;
        const e = 1 - Math.pow(1 - t, 3); // ease-out, like the box ring
        path.setAttribute('d', triPath(centers, r0 + e * travel));
        path.setAttribute('stroke-width', (5 - 4 * e).toFixed(2)); // 5px → 1px, thins as it travels
        svg.style.opacity = t < 0.8 ? '1' : String(1 - (t - 0.8) / 0.2); // late fade
        if (t < 1) requestAnimationFrame(tick); else svg.remove();
      };
      requestAnimationFrame(tick);
    };
    // Box ring: starts as the button's outline (size + corner radius R) and expands
    // by a CONSTANT offset on every side (box +2d, radius +d) so it stays equidistant
    // — a pill stays two half-circles joined by parallel lines, not a bigger pill.
    const boxShockwave = (r, R) => {
      const d = r.height * 0.7; // how far the ring travels outward
      const wave = document.createElement('span');
      wave.className = 'shockwave';
      wave.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${R}px`;
      fxLayer().appendChild(wave);
      const anim = wave.animate(
        // Stays fully opaque while the line thins (5px → 1px); only at the very end —
        // once it's 1px and can't visibly get thinner — does it fade out.
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
      // Shockwave: lives in the body-level .fx-layer so a soft-nav swap can't cut it.
      const r = btn.getBoundingClientRect();
      if (!r.width) return;
      // The video toggle is shaped, so it gets shape-matched rings: a rounded-triangle
      // for the play arrow, and a rounded square for the pause bars (the toggle itself
      // has no border-radius, so the default ring would be a hard square).
      if (btn.classList.contains('video-toggle')) {
        if (btn.classList.contains('is-playing')) boxShockwave(r, r.width * 0.22);
        else triShockwave(r);
        return;
      }
      boxShockwave(r, effectiveRadius(btn, r)); // every other button: its own outline
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

  // --- Desktop nav-link wobble ----------------------------------------------
  // Rotation-only wobble on hover/focus, driven in JS so its AMPLITUDE can lerp
  // smoothly in AND out (CSS can't ease out of a removed keyframe animation). The
  // grow + pill highlight are CSS; the header persists, so this wires once.
  (function navWobble() {
    if (reduceMotion) return;
    const PERIOD = 2100, MAX = 2; // ms per cycle, peak degrees
    document.querySelectorAll('.site-nav a').forEach((link) => {
      let amp = 0, target = 0, raf = null;
      const tick = () => {
        amp += (target - amp) * 0.12; // ease amplitude toward target (0 or 1)
        if (target === 0 && amp < 0.005) { link.style.rotate = ''; raf = null; return; }
        const phase = (performance.now() % PERIOD) / PERIOD * Math.PI * 2;
        link.style.rotate = (amp * MAX * Math.sin(phase)).toFixed(3) + 'deg';
        raf = requestAnimationFrame(tick);
      };
      const set = (t) => { target = t; if (raf == null) raf = requestAnimationFrame(tick); };
      link.addEventListener('mouseenter', () => set(1));
      link.addEventListener('mouseleave', () => set(0));
      link.addEventListener('focus', () => set(1));
      link.addEventListener('blur', () => set(0));
    });
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

  // --- Drifting paw field ---------------------------------------------------
  // A 45°-rotated (diamond) lattice of paw prints that constantly drifts across
  // the page behind the content. Each paw is the PawGradient image run through the
  // #pawThreshold SVG filter; its Photoshop-style threshold is set by pre-multiplying
  // CSS brightness (b = 127.5 / T). At rest T = 220 (just the brightest specks show);
  // near the cursor we lerp T → 40 (the whole paw reveals), and back to 220 as the
  // cursor leaves. Lives on <body>, so it's wired once and survives soft-nav.
  (function pawField() {
    const field = document.querySelector('[data-paw-field]');
    if (!field) return;

    const finePointer = !window.matchMedia || window.matchMedia('(pointer: fine)').matches;
    const mobile = !finePointer;   // touch device → fewer paws + no hero layer (perf)
    const S = mobile ? 300 : 190;  // lattice pitch (px); larger on mobile = far fewer paws
    const R = 100;                 // cursor in-range radius (px) — binary check, not a gradient
    const bForT = (T) => 127.5 / Math.max(T, 1); // PS threshold T → brightness pre-multiply (T→0 ⇒ full paw)
    // Resting (out of range) each paw is a dot (threshold 220); within R it eases to
    // a full paw (threshold 40). Blooming to a paw is fast; collapsing back is slow.
    const T_REST = 220, T_NEAR = 40;
    const EASE_IN = 0.22;          // ease toward the full paw — fast
    const EASE_OUT = 0.035;        // ease back to a dot — much slower
    const PAW_SRC = field.dataset.pawSrc || '/img/paw.png';

    // Keep the SVG filter's flood colour in sync with the live --bg (top colour).
    const flood = document.querySelector('[data-paw-flood]');
    function syncColor() {
      if (!flood) return;
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) flood.setAttribute('flood-color', bg);
    }

    // Diagonal drift velocity (px/s). Slow, so it reads as a gentle constant flow.
    const vx = 9, vy = 6;
    const t0 = performance.now();
    const R2 = R * R;          // compare squared distance — skip the per-paw sqrt
    const DOT_T = T_REST - 30; // threshold at/above which a collapsing paw reads as a plain dot
    const HOLD = 1000;         // ms to hold the full paw after the cursor leaves range
    const ROT_LERP = 0.12;     // per-frame rotation ease (~0.4s) when re-aiming
    const mod = (v, m) => ((v % m) + m) % m;
    const shortAngle = (a) => ((a + 180) % 360 + 360) % 360 - 180; // → [-180,180)

    // A "surface" = one container holding a drifting lattice of paws. There is the
    // global fixed field (behind the page) and — whenever a hero is on the page — a
    // hero-local layer masked to the hero's fade. Both share one loop so their drift
    // and cursor reveal stay in sync.
    function makeSurface(el, fixed) {
      return { el, fixed, paws: [], LW: 0, LH: 0, builtW: 0, builtH: 0 };
    }
    function buildSurface(s) {
      s.el.textContent = '';
      s.paws = [];
      const r = s.el.getBoundingClientRect();
      const W = Math.max(1, r.width), H = Math.max(1, r.height);
      s.builtW = W; s.builtH = H;
      // Tile whole S-periods so the lattice wraps seamlessly (LW/LH multiples of S).
      // Margin periods so ordinary growth never forces a rebuild (smaller on mobile).
      const M = mobile ? 2 : 3;
      const NX = Math.ceil(W / S) + M, NY = Math.ceil(H / S) + M;
      s.LW = NX * S; s.LH = NY * S;
      const frag = document.createDocumentFragment();
      for (let ry = 0; ry < 2 * NY; ry++) {   // 2 lattice rows per vertical period S
        const by = ry * (S / 2);
        const off = (ry & 1) ? S / 2 : 0;     // alternate-row half-shift → 45° lattice
        for (let cx = 0; cx < NX; cx++) {
          const bx = cx * S + off;
          const img = document.createElement('img');
          img.className = 'paw';
          img.src = PAW_SRC;
          img.alt = '';
          img.decoding = 'async';
          img.style.setProperty('--b', bForT(T_REST).toFixed(3));
          img.style.transform = `translate(${bx}px, ${by}px) translate(-50%, -50%)`;
          frag.appendChild(img);
          s.paws.push({ el: img, bx, by, T: T_REST, inR: false, rotated: false, leftAt: 0, rotC: 0, rotT: 0 });
        }
      }
      s.el.appendChild(frag);
    }

    const globalSurf = makeSurface(field, true);
    const surfaces = [globalSurf];
    buildSurface(globalSurf);

    // Cursor state (client coords). active flips off when the pointer leaves. dirDeg
    // tracks the cursor's travel direction so a paw can aim its "up" axis along it on
    // entering range. atan2(dx, -dy): 0° = up (the paw's natural orientation).
    let mx = 0, my = 0, active = false, dirDeg = 0, lastX = null, lastY = null;
    if (finePointer) {
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        if (lastX != null) {
          const ddx = e.clientX - lastX, ddy = e.clientY - lastY;
          if (ddx * ddx + ddy * ddy > 4) dirDeg = Math.atan2(ddx, -ddy) * 180 / Math.PI;
        }
        lastX = e.clientX; lastY = e.clientY;
        mx = e.clientX; my = e.clientY; active = true;
      }, { passive: true });
      window.addEventListener('pointerleave', () => { active = false; });
      document.addEventListener('mouseleave', () => { active = false; });
    }

    let raf = null;
    function loop() {
      const now = performance.now();
      const t = (now - t0) / 1000;
      const ox = t * vx, oy = t * vy;   // continuous drift offset (never reset → no global jump)
      for (let si = 0; si < surfaces.length; si++) {
        const s = surfaces[si];
        for (let i = 0; i < s.paws.length; i++) {
          const p = s.paws[i];
          // Per-paw wrapped position: each paw drifts smoothly and only ever wraps
          // while OFF-SCREEN, so the on-screen pattern (and any bloomed paw) never jumps.
          const px = mod(p.bx + ox + S, s.LW) - S;
          const py = mod(p.by + oy + S, s.LH) - S;
          // Binary in-range test: within R → full paw (40), else → dot (220).
          let inR = false;
          if (active) {
            const ex = mx - px, ey = my - py;
            inR = ex * ex + ey * ey < R2;
          }
          // On entering range, aim the paw's up-axis along the cursor's travel. A fresh
          // dot snaps; one still carrying a rotation eases to the new heading (~0.4s).
          if (inR && !p.inR) {
            p.rotT = dirDeg;
            if (!p.rotated) p.rotC = dirDeg;
            p.rotated = true;
          }
          // Target threshold, with a 1s hold at full paw before collapsing back.
          let targetT;
          if (inR) { targetT = T_NEAR; p.leftAt = 0; }
          else { if (p.inR) p.leftAt = now; targetT = (p.leftAt && now - p.leftAt < HOLD) ? T_NEAR : T_REST; }
          p.inR = inR;
          const ease = targetT < p.T ? EASE_IN : EASE_OUT; // toward paw = fast, toward dot = slow
          let nt = p.T + (targetT - p.T) * ease;
          if (Math.abs(targetT - nt) < 0.5) nt = targetT; // settle exactly on target
          if (nt !== p.T) { p.T = nt; p.el.style.setProperty('--b', bForT(nt).toFixed(3)); }
          // Once back to a plain dot, drop the rotated flag so the next bloom SNAPS.
          if (!inR && p.rotated && p.T >= DOT_T) p.rotated = false;
          // Ease the rotation toward its target (shortest way around).
          if (p.rotC !== p.rotT) {
            const d = shortAngle(p.rotT - p.rotC);
            p.rotC = Math.abs(d) < 0.5 ? p.rotT : p.rotC + d * ROT_LERP;
          }
          p.el.style.transform =
            `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) rotate(${p.rotC.toFixed(1)}deg)`;
        }
      }
      raf = requestAnimationFrame(loop);
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Only rebuild a surface when it has GROWN past its built coverage. Shrinking,
        // the mobile URL bar, and minor changes keep the existing lattice — so the
        // paws never jarringly reset.
        for (const s of surfaces) {
          const r = s.el.getBoundingClientRect();
          if (r.width > s.builtW + S || r.height > s.builtH + S) buildSurface(s);
        }
      }, 300);
    });

    syncColor();
    if (reduceMotion) return; // static field, no drift/bloom
    raf = requestAnimationFrame(loop);
  })();

  // --- Custom video player --------------------------------------------------
  // Our own play/pause UI for every video on the site (pitch-deck slides + page
  // sections). The <iframe>/<video> is built lazily on first play and driven via
  // the platform JS API so ZERO native YouTube/Vimeo chrome ever shows — the only
  // control is the glass toggle. On a slide the toggle is lifted to a slide-level
  // element so it's the top layer regardless of where the video block sits, and
  // its play/pause acts on every video in that slide (there is only ever one).
  const videoPlayers = (function () {
    const controllers = new Map(); // frame element -> controller
    const groups = []; // { host, frames, btn, observer, onActive }

    // -- one controller per <video-frame>: a self-hosted <video> element -------
    function makeController(frame) {
      const mount = frame.querySelector('[data-video-media]');
      let media = null;
      let wantPlay = false; // user intent → drives the toggle icon
      const listeners = [];
      const notify = () => listeners.forEach((fn) => fn());
      const timeListeners = [];          // playhead updates (kept separate from `notify`
      const notifyTime = () => timeListeners.forEach((fn) => fn()); // so they don't re-arm hide)

      // Build the <video> lazily (or via prefetch). No native controls — our glass
      // toggle drives it. The poster lifts on first playback (is-started) and the
      // real (paused) frame is fine to show afterwards (a self-hosted file has no
      // third-party chrome to hide).
      function build() {
        if (media) return media;
        const v = document.createElement('video');
        v.src = frame.dataset.file;
        v.setAttribute('playsinline', '');
        v.playsInline = true;
        v.preload = 'auto';
        v.addEventListener('playing', () => { frame.classList.add('is-started'); });
        v.addEventListener('play', () => { wantPlay = true; notify(); });
        v.addEventListener('pause', () => { wantPlay = false; notify(); });
        v.addEventListener('ended', () => { wantPlay = false; notify(); });
        v.addEventListener('timeupdate', notifyTime);
        v.addEventListener('loadedmetadata', notifyTime);
        v.addEventListener('seeking', notifyTime);
        mount.appendChild(v);
        media = v;
        return v;
      }
      function prefetch() { build(); }
      function play() {
        const v = build();
        wantPlay = true; notify();
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      }
      function pause() { if (media) media.pause(); }
      function destroy() {
        try { if (media) { media.pause(); media.removeAttribute('src'); media.load(); media.remove(); } } catch (_) {}
        media = null;
      }
      return {
        frame, play, pause, prefetch, destroy,
        isPlaying: () => wantPlay,
        onChange: (fn) => listeners.push(fn),
        onTime: (fn) => timeListeners.push(fn),
        duration: () => (media && isFinite(media.duration) ? media.duration : 0),
        currentTime: () => (media ? media.currentTime : 0),
        seek: (t) => { const v = build(); if (isFinite(v.duration) && v.duration) v.currentTime = Math.max(0, Math.min(t, v.duration)); },
      };
    }

    function controllerFor(frame) {
      let c = controllers.get(frame);
      if (!c) { c = makeController(frame); controllers.set(frame, c); }
      return c;
    }

    // -- a control group: one glass toggle driving every video under `host` ---
    function initGroup(host, frames, isSlide) {
      const ctrls = frames.map(controllerFor);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'video-toggle' + (isSlide ? ' video-toggle--slide' : '');
      btn.setAttribute('aria-label', 'Play video');
      // The play triangle / pause bars are frosted-glass child shapes (see styles.css).
      btn.innerHTML =
        '<span class="video-toggle__play"></span>' +
        '<span class="video-toggle__pause"><i></i><i></i></span>';
      // Scrubber: a black track pinned to the frame bottom with a glass playhead.
      // Starts hidden — it only fades in after the first play (so it never sits over
      // the pre-roll overlay image), then follows the same rules as the toggle.
      const scrub = document.createElement('div');
      scrub.className = 'video-scrub is-hidden';
      scrub.innerHTML =
        '<div class="video-scrub__track"><span class="video-scrub__line"></span>' +
        '<button type="button" class="video-scrub__head" aria-label="Seek"></button></div>';
      const track = scrub.querySelector('.video-scrub__track');
      const head = scrub.querySelector('.video-scrub__head');
      const primary = ctrls[0];
      const layout = () => {
        const d = primary.duration();
        head.style.left = (d ? Math.max(0, Math.min(1, primary.currentTime() / d)) * 100 : 0) + '%';
      };
      ctrls.forEach((c) => c.onTime(layout));

      // Auto-hide while playing: both controls fade out ~1s after the last pointer
      // movement over the video, or the instant the pointer leaves the frame. Any
      // movement back over the video brings them right back; paused → always shown.
      // Hovering a control (or dragging the playhead) keeps them up — a motionless
      // pointer parked on the button isn't "movement over the frame", so without this
      // the idle timer would hide the very button you're reaching for.
      let hideTimer = null, dragging = false, overControls = false, scrubReady = false, scrubArmed = false;
      const playing = () => ctrls.some((c) => c.isPlaying());
      // The toggle shows from the start; the scrubber stays hidden until scrubReady
      // (set shortly after the first play) so it never overlaps the overlay image.
      const setHidden = (v) => {
        btn.classList.toggle('is-hidden', v);
        scrub.classList.toggle('is-hidden', v || !scrubReady);
      };
      const clearHide = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } };
      const armHide = () => { clearHide(); if (playing()) hideTimer = setTimeout(() => { if (!dragging && !overControls) setHidden(true); }, 1000); };
      // Pin the controls open while the pointer is over the toggle or the scrubber.
      [btn, track].forEach((el) => {
        el.addEventListener('pointerenter', () => { overControls = true; clearHide(); setHidden(false); });
        el.addEventListener('pointerleave', () => { overControls = false; armHide(); });
      });
      const refresh = () => {
        const on = playing();
        btn.classList.toggle('is-playing', on);
        btn.setAttribute('aria-label', on ? 'Pause video' : 'Play video');
        if (on && !scrubArmed) {
          // First play: reveal the timeline only AFTER the overlay image has slid out
          // (~0.6s) so it never overlaps it; from then on it follows the normal rules.
          scrubArmed = true;
          setTimeout(() => { if (scrub.isConnected) { scrubReady = true; setHidden(false); armHide(); } }, 600);
        }
        if (on) armHide();                  // start the idle countdown
        else { clearHide(); setHidden(false); } // paused: always visible
      };
      ctrls.forEach((c) => c.onChange(refresh));
      const prefetch = () => ctrls.forEach((c) => c.prefetch());
      const toggle = () => {
        if (ctrls.some((c) => c.isPlaying())) ctrls.forEach((c) => c.pause());
        else ctrls.forEach((c) => c.play());
      };
      btn.addEventListener('click', toggle);
      // Build as early as possible (pointerdown precedes click) so playback can
      // start inside the gesture — never stranded on YouTube's cued centre button.
      btn.addEventListener('pointerdown', prefetch);

      // Drag/click the track to seek (all videos in the group move together).
      const seekToX = (clientX) => {
        const r = track.getBoundingClientRect();
        if (!r.width) return;
        const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        const d = primary.duration();
        if (d) { ctrls.forEach((c) => c.seek(pct * d)); }
        head.style.left = pct * 100 + '%';
      };
      track.addEventListener('pointerdown', (e) => {
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch (_) {}
        seekToX(e.clientX); e.preventDefault();
      });
      track.addEventListener('pointermove', (e) => { if (dragging) seekToX(e.clientX); });
      const endDrag = (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} armHide(); };
      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);

      // Clicking anywhere on the video (its cover) also toggles play/pause.
      frames.forEach((f) => {
        const cover = f.querySelector('[data-video-cover]');
        if (cover) {
          cover.addEventListener('click', toggle);
          cover.addEventListener('pointerdown', prefetch);
          cover.addEventListener('pointerenter', prefetch);
        }
        // Reveal on movement over the video and (re)arm the idle hide; hide on exit.
        f.addEventListener('pointermove', () => { setHidden(false); armHide(); });
        f.addEventListener('pointerleave', () => { clearHide(); if (playing() && !dragging) setHidden(true); });
      });
      host.appendChild(btn);
      host.appendChild(scrub);

      const group = { host, frames, btn, observer: null, ctrls, clearHide };
      if (isSlide) {
        // Prefetch when the slide becomes active (so it's ready before the click);
        // pause when it stops being the active one.
        const sync = () => {
          if (host.classList.contains('is-active')) prefetch();
          else ctrls.forEach((c) => c.pause());
        };
        const obs = new MutationObserver(sync);
        obs.observe(host, { attributes: true, attributeFilter: ['class'] });
        group.observer = obs;
        if (host.classList.contains('is-active')) prefetch();
      } else {
        host.addEventListener('pointerenter', prefetch);
      }
      groups.push(group);
    }

    // -- scan a root for new video groups; prune any detached ones ------------
    function scan(root) {
      // Prune controllers/groups whose elements are gone (e.g. after a soft-nav).
      controllers.forEach((c, frame) => {
        if (!frame.isConnected) { c.destroy(); controllers.delete(frame); }
      });
      for (let i = groups.length - 1; i >= 0; i--) {
        if (!groups[i].host.isConnected) {
          if (groups[i].observer) groups[i].observer.disconnect();
          if (groups[i].clearHide) groups[i].clearHide();
          groups.splice(i, 1);
        }
      }
      const scope = root || document;
      // Pitch-deck slides: group by slide so the toggle controls the whole slide.
      scope.querySelectorAll('.deck-slide').forEach((slide) => {
        if (slide.querySelector('.video-toggle')) return; // already wired
        const frames = Array.from(slide.querySelectorAll('[data-video]'));
        if (frames.length) initGroup(slide, frames, true);
      });
      // Standalone videos (page sections): one toggle inside each frame.
      scope.querySelectorAll('[data-video]').forEach((frame) => {
        if (frame.closest('.deck-slide')) return; // handled above
        if (controllers.has(frame) && frame.querySelector('.video-toggle')) return;
        initGroup(frame, [frame], false);
      });
    }

    // Pre-build players inside `root` (used when the deck popup opens) so the
    // first click plays immediately, never stranding on a cued-state centre button.
    function prefetchInside(root) {
      controllers.forEach((c) => { if (root.contains(c.frame)) c.prefetch(); });
    }

    // Pause every video inside `root` (used when the deck popup closes).
    function pauseInside(root) {
      controllers.forEach((c) => { if (root.contains(c.frame)) c.pause(); });
    }

    return { scan, prefetchInside, pauseInside };
  })();

  // --- Pitch-deck popup -----------------------------------------------------
  // Open the deck in-page (over the hero) instead of navigating. Delegated, so
  // it keeps working for the popup markup swapped in by soft-nav. Sequence:
  // the hero panel slides down + the backdrop blurs/darkens, THEN the glass card
  // bounce-grows from the centre, and once it's full-size the arrows slide out
  // from behind its edges with their own bounce.
  (function deckPopup() {
    let isOpen = false, pop = null, hero = null, opener = null;
    let slides = [], idx = 0, savedScrollY = 0, wiping = false, glowAfter = false;

    // Point the outer glow at a slide's primary image (its colours bleed around
    // the card; see .deck-pop__glow). The glow has two layers (element bg + ::after)
    // that cross-dissolve slowly (~4x the slide), so the colour halo lags behind:
    // each change we put the new image on the hidden layer and toggle which shows.
    // `instant` (on open) just sets the base with no crossfade.
    const setGlow = (slide, instant) => {
      const glow = pop && pop.querySelector('[data-deck-glow]');
      if (!glow) return;
      const img = slide && slide.querySelector('.deck-slide__bg, .slide-block--image img');
      const src = img && (img.currentSrc || img.getAttribute('src'));
      const val = src ? `url("${src}")` : 'none';
      if (instant) {
        glow.style.backgroundImage = src ? `url("${src}")` : '';
        glow.style.setProperty('--glow-after', 'none');
        glow.classList.remove('is-glow-after');
        glowAfter = false;
      } else if (!glowAfter) {
        glow.style.setProperty('--glow-after', val); // new image on ::after, fade it in
        glow.classList.add('is-glow-after');
        glowAfter = true;
      } else {
        glow.style.backgroundImage = src ? `url("${src}")` : ''; // new on base, fade ::after out
        glow.classList.remove('is-glow-after');
        glowAfter = false;
      }
    };

    // Page to the next/prev slide with a fast cross-dissolve: the incoming slide
    // (is-entering, on top) fades in over the outgoing one. `dir` is kept for the
    // call sites but a dissolve has no direction.
    const showSlide = (dir) => {
      if (!slides.length || wiping) return;
      const t = (idx + dir + slides.length) % slides.length;
      if (t === idx) return;
      const prevEl = slides[idx], target = slides[t];
      setGlow(target);
      if (reduceMotion) {
        prevEl.classList.remove('is-active');
        target.classList.add('is-active');
        idx = t;
        return;
      }
      wiping = true;
      target.classList.add('is-entering'); // display flex, on top, opacity 0
      void target.offsetWidth;             // commit opacity 0 before transitioning
      target.classList.add('is-shown');    // fade opacity -> 1
      const done = (e) => {
        if (e.target !== target || e.propertyName !== 'opacity') return;
        target.removeEventListener('transitionend', done);
        prevEl.classList.remove('is-active');
        target.classList.remove('is-entering', 'is-shown');
        target.classList.add('is-active');
        idx = t;
        wiping = false;
      };
      target.addEventListener('transitionend', done);
    };

    function open(btn) {
      pop = document.querySelector('[data-deck-pop]');
      if (!pop || isOpen) return;
      isOpen = true;
      opener = btn;
      hero = btn.closest('.hero');
      slides = Array.from(pop.querySelectorAll('.deck-slide'));
      idx = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));
      // Clear any leftover transition state from a prior (interrupted) session.
      wiping = false;
      slides.forEach((s) => s.classList.remove('is-entering', 'is-shown', 'reveal-next', 'reveal-prev'));
      const stage0 = pop.querySelector('.deck-pop__stage');
      if (stage0) stage0.classList.remove('is-wiping', 'wipe-next', 'wipe-prev');
      setGlow(slides[idx], true); // glow for the first slide shown (no crossfade)
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
      videoPlayers.prefetchInside(pop);                         // pre-build videos so play is instant

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
        // `none`, not `scale(1)`: a transformed ancestor flattens descendant
        // backdrop-filter, which would kill the glass video toggle's frost. `none`
        // is visually identical at rest but lets the blur work again.
        card.style.transform = 'none';
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
        // Settle on `none` (not `scale(1)`) so the card stops being a transformed
        // ancestor — otherwise it flattens the toggle's backdrop-filter (no frost).
        const grown = grow.finished.then(() => { card.style.transform = 'none'; grow.cancel(); }).catch(() => {});
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
      videoPlayers.pauseInside(_pop); // stop any playing slide video
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
      // Clear focus on close so no trigger/control is left in a :focus-visible
      // (hover-looking) state — e.g. the opener button floating after an Escape
      // close. We intentionally don't return focus to the opener for that reason.
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      pop = null; hero = null; opener = null;
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-deck-open]');
      if (btn) { e.preventDefault(); open(btn); return; }
      if (!isOpen) return;
      if (e.target.closest('[data-deck-close]')) { e.preventDefault(); close(); return; }
      if (e.target.closest('[data-deck-prev]')) { showSlide(-1); return; }
      if (e.target.closest('[data-deck-next]')) { showSlide(1); return; }
    });
    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') showSlide(1);
      else if (e.key === 'ArrowLeft') showSlide(-1);
    });
    let sx = null;
    document.addEventListener('touchstart', (e) => { if (isOpen) sx = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!isOpen || sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) showSlide(dx < 0 ? 1 : -1);
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
    videoPlayers.scan(document);
    // Stop any playing video before the next soft-nav swaps <main> out.
    teardowns.push(() => videoPlayers.pauseInside(document));
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

    const SHELL = new Set(['/', '/contact', '/games', '/about', '/press']);
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
