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
