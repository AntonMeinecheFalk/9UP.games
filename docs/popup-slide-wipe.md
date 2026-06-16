# Pitch-deck popup — mask-wipe slide transition (archived)

The popup slide transition was a feathered **mask wipe** with a sharp white line
that **eased in/out** and **thickened with speed**. It was replaced by a fast
cross-dissolve (easier on the eyes). This file preserves the wipe so it can be
restored. Full working version: git commit **ee0c9f4**
(`Deck wipe: ease-in-out the line + thicken it with speed`).

The full-screen `/deck` viewer still uses the mask wipe — these shared pieces stay
in `styles.css` regardless: `@property --wipe`, `.deck-slide.is-entering`,
`.deck-slide.reveal-next/prev`, `.deck-viewer.is-wiping`, `@keyframes deckWipe`.

## To revert
1. Restore the **CSS** below into `public/css/styles.css` (replace the cross-dissolve
   rules `.deck-pop__stage .deck-slide.is-entering { … }` / `.is-shown { … }`).
2. Restore the **`showSlide`** function below into `public/js/app.js` (popup module),
   and keep `is-shown` out of the `open()` cleanup (not used by the wipe).

## CSS (popup-specific — add back alongside the kept viewer pieces)
```css
@property --wipew { syntax: "<percentage>"; inherits: true; initial-value: 0%; }
/* --wipe gets one clean ease-in-out (2-keyframe so the timing isn't applied
   per-segment); --wipew (white-line half-width) peaks at the fast midpoint. */
.deck-pop__stage.is-wiping { animation: deckWipe 0.3s cubic-bezier(0.76, 0, 0.24, 1) forwards, deckWipeW 0.3s ease-in-out forwards; }
@keyframes deckWipeW { 0% { --wipew: 0.6%; } 50% { --wipew: 2.8%; } 100% { --wipew: 0.6%; } }
.deck-pop__stage::after {
  content: ""; position: absolute; inset: 0; z-index: 6; pointer-events: none; opacity: 0;
}
.deck-pop__stage.is-wiping::after { opacity: 1; }
.deck-pop__stage.is-wiping.wipe-next::after {
  background: linear-gradient(260deg, transparent calc(var(--wipe) - var(--wipew)), #fff calc(var(--wipe) - var(--wipew)), #fff calc(var(--wipe) + var(--wipew)), transparent calc(var(--wipe) + var(--wipew)));
}
.deck-pop__stage.is-wiping.wipe-prev::after {
  background: linear-gradient(100deg, transparent calc(var(--wipe) - var(--wipew)), #fff calc(var(--wipe) - var(--wipew)), #fff calc(var(--wipe) + var(--wipew)), transparent calc(var(--wipe) + var(--wipew)));
}
```

## JS — `showSlide` (popup module in `public/js/app.js`)
```js
const showSlide = (dir) => {
  if (!slides.length || wiping) return;
  const t = (idx + dir + slides.length) % slides.length;
  if (t === idx) return;
  const prevEl = slides[idx], target = slides[t];
  const stage = pop && pop.querySelector('.deck-pop__stage');
  if (reduceMotion || !stage) {
    prevEl.classList.remove('is-active');
    target.classList.add('is-active');
    idx = t;
    return;
  }
  wiping = true;
  const revealCls = dir > 0 ? 'reveal-next' : 'reveal-prev';
  const dirCls = dir > 0 ? 'wipe-next' : 'wipe-prev';
  target.classList.add('is-entering', revealCls);
  stage.classList.remove('is-wiping', 'wipe-next', 'wipe-prev');
  void stage.offsetWidth; // restart the --wipe animation cleanly
  stage.classList.add('is-wiping', dirCls);
  const done = (e) => {
    if (e.target !== stage || e.animationName !== 'deckWipe') return;
    stage.removeEventListener('animationend', done);
    prevEl.classList.remove('is-active');
    target.classList.remove('is-entering', revealCls);
    target.classList.add('is-active');
    stage.classList.remove('is-wiping', dirCls);
    idx = t;
    wiping = false;
  };
  stage.addEventListener('animationend', done);
};
```
