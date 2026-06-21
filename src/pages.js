// Composes full pages from the rendering components + data models.
import {
  layout,
  renderHero,
  renderHomeLanding,
  renderSection,
  renderTeamCard,
  renderGamesCarousel,
  addSectionMenu,
} from './render.js';
import { escapeHtml } from './sanitize.js';
import { Games, Sections, Team, Site, Slides } from './models.js';

// --- Landing page -----------------------------------------------------------
// The homepage is a brand-first "glass logo" landing (see renderHomeLanding):
// the company logo as a giant glass shape revealing a game's key art, a tagline,
// and social links. Per-game content lives on each game's own page.
export function renderHome(editMode) {
  const body = renderHomeLanding(editMode);
  return layout({ title: null, body, editMode, bodyClass: 'page-home' });
}

// --- A standalone game page (for non-featured games) ------------------------
export function renderGamePage(game, editMode) {
  let body = renderHero(game, editMode, Slides.forGame(game.id));
  body += `<div class="wrap sections" data-sections-owner="game" data-owner-id="${game.id}">`;
  for (const section of Sections.list('game', game.id)) {
    body += renderSection(section, editMode);
  }
  if (editMode) {
    body += addSectionMenu('game', game.id);
    body += `<div class="game-edit-extra">
      <a class="ctl" href="/game/${escapeHtml(game.slug)}/deck">Edit pitch deck →</a>
      <button type="button" class="ctl ctl--danger" data-action="delete-game" data-game-id="${game.id}">Delete this game</button>
    </div>`;
  }
  body += `</div>`;
  return layout({ title: game.title, body, editMode, bodyClass: 'page-game' });
}

// --- Games catalogue page ---------------------------------------------------
export function renderGamesPage(editMode) {
  const games = Games.all();
  let body = `<div class="wrap games-head">
    <h1>Our games</h1>
    <p class="lede">Swipe or use the arrows to browse the catalogue.</p>
    ${
      editMode
        ? '<div class="toolbar"><button type="button" class="ctl" data-action="create-game">+ New game</button></div>'
        : ''
    }
  </div>`;
  body += renderGamesCarousel(games);
  return layout({ title: 'Games', body, editMode, bodyClass: 'page-games' });
}

// --- About page -------------------------------------------------------------
export function renderAbout(editMode) {
  const mission = Site.mission();
  const team = Team.all();

  let body = `<div class="wrap">
    <section class="mission">
      <div class="richtext-wrap">
        ${
          editMode
            ? `<div class="richtext" data-richtext data-target="mission">
                 <div class="richtext__toolbar" aria-hidden="true">
                   <button type="button" data-cmd="bold"><b>B</b></button>
                   <button type="button" data-cmd="italic"><i>I</i></button>
                   <button type="button" data-cmd="h2">H2</button>
                   <button type="button" data-cmd="h3">H3</button>
                   <button type="button" data-cmd="p" title="Normal text">¶</button>
                   <button type="button" data-cmd="ul">• List</button>
                   <button type="button" data-cmd="link">Link</button>
                   <button type="button" data-cmd="save" class="richtext__save">Save</button>
                 </div>
                 <div class="richtext__area prose" contenteditable="true">${mission}</div>
               </div>`
            : `<div class="prose">${mission}</div>`
        }
      </div>
    </section>

    <div class="section-rule" aria-hidden="true"></div>

    <section class="team">
      <h2>Team</h2>
      ${
        editMode
          ? '<div class="toolbar"><button type="button" class="ctl" data-action="add-member">+ Add team member</button></div>'
          : ''
      }
      <div class="team-grid" data-team-grid>
        ${
          team.length
            ? team.map((m) => renderTeamCard(m, editMode)).join('')
            : `<p class="muted">No team members yet.${
                editMode ? ' Click “Add team member”.' : ''
              }</p>`
        }
      </div>
    </section>
  </div>`;

  return layout({ title: 'About', body, editMode, bodyClass: 'page-about' });
}

// --- Contact page -----------------------------------------------------------
// A single editable rich-text block (same mechanism as the About mission), so the
// contact details are managed in the browser like everything else.
export function renderContact(editMode) {
  const contact = Site.contact();
  const body = `<div class="wrap">
    <h1>Contact</h1>
    <section class="contact-page">
      <p class="contact-email"><a href="mailto:contact@9up.games">contact@9up.games</a></p>
      <div class="richtext-wrap">
        ${
          editMode
            ? `<div class="richtext" data-richtext data-target="contact">
                 <div class="richtext__toolbar" aria-hidden="true">
                   <button type="button" data-cmd="bold"><b>B</b></button>
                   <button type="button" data-cmd="italic"><i>I</i></button>
                   <button type="button" data-cmd="h2">H2</button>
                   <button type="button" data-cmd="h3">H3</button>
                   <button type="button" data-cmd="p" title="Normal text">¶</button>
                   <button type="button" data-cmd="ul">• List</button>
                   <button type="button" data-cmd="link">Link</button>
                   <button type="button" data-cmd="save" class="richtext__save">Save</button>
                 </div>
                 <div class="richtext__area prose" contenteditable="true">${contact}</div>
               </div>`
            : contact
              ? `<div class="prose">${contact}</div>`
              : ''
        }
      </div>
    </section>
  </div>`;
  return layout({ title: 'Contact', body, editMode, bodyClass: 'page-contact' });
}

// --- Press Kit page ---------------------------------------------------------
export function renderPressKit(editMode) {
  const games = Games.all();
  const assetSections = Sections.list('page', 'presskit');

  let body = `<div class="wrap">
    <h1>Press Kit</h1>
    <p class="lede">Request Steam keys and download press assets for ${escapeHtml(
      Site.title()
    )}.</p>

    <section class="press-request" data-press-flow>
      <h2>Request Steam keys</h2>
      <div class="press-step" data-step="type">
        <p>First, tell us who you are:</p>
        <div class="press-type-choice">
          <button type="button" class="btn btn--secondary" data-press-type="creator">I'm a content creator</button>
          <button type="button" class="btn btn--secondary" data-press-type="editorial">I'm editorial / press</button>
        </div>
      </div>

      <form class="press-step press-form" data-step="form" hidden>
        <input type="hidden" name="press_type" value="">
        <p class="press-form__intro" data-form-intro></p>

        <label>Your name<input type="text" name="name" required></label>
        <label>Email<input type="email" name="email" required></label>

        <label data-field="outlet"><span data-label-outlet>Channel / publication name</span>
          <input type="text" name="outlet" required></label>
        <label>Channel / publication URL<input type="url" name="outlet_url"></label>

        <label data-field="audience"><span data-label-audience>Audience size</span>
          <input type="text" name="audience" placeholder="e.g. 50k subscribers"></label>

        <label data-field="role" hidden>Your role
          <input type="text" name="role" placeholder="e.g. Staff writer, Editor"></label>

        <fieldset class="press-games">
          <legend>Which game(s)?</legend>
          ${
            games.length
              ? games
                  .map(
                    (g) =>
                      `<label class="check"><input type="checkbox" name="games" value="${escapeHtml(
                        g.title
                      )}"> ${escapeHtml(g.title)}</label>`
                  )
                  .join('')
              : '<p class="muted">No games listed yet.</p>'
          }
        </fieldset>

        <label>Message<textarea name="message" rows="4" placeholder="Anything else we should know?"></textarea></label>

        <div class="press-form__actions">
          <button type="button" class="btn btn--ghost" data-press-back>← Back</button>
          <button type="submit" class="btn btn--primary">Send request</button>
        </div>
        <p class="press-form__status" role="status" aria-live="polite"></p>
      </form>

      <div class="press-step press-confirm" data-step="confirm" hidden>
        <h3>Thank you!</h3>
        <p>Your request has been received. We'll be in touch at the email you provided.</p>
      </div>
    </section>

    <section class="press-assets sections" data-sections-owner="page" data-owner-id="presskit">
      <h2>Press assets</h2>
      ${assetSections.map((s) => renderSection(s, editMode)).join('')}
      ${editMode ? addSectionMenu('page', 'presskit') : ''}
    </section>
  </div>`;

  return layout({ title: 'Press Kit', body, editMode, bodyClass: 'page-press' });
}

// --- Submissions admin view (edit mode only) --------------------------------
export function renderSubmissions(editMode, submissions) {
  const rows = submissions
    .map((s) => {
      let games = [];
      try {
        games = JSON.parse(s.games || '[]');
      } catch {
        games = [];
      }
      return `<tr>
        <td>${escapeHtml(s.created_at)}</td>
        <td>${escapeHtml(s.press_type)}</td>
        <td>${escapeHtml(s.name)}<br><a href="mailto:${escapeHtml(s.email)}">${escapeHtml(
        s.email
      )}</a></td>
        <td>${escapeHtml(s.outlet)}${
        s.outlet_url
          ? `<br><a href="${escapeHtml(s.outlet_url)}" target="_blank" rel="noopener">link</a>`
          : ''
      }</td>
        <td>${escapeHtml(s.audience)}${s.role ? `<br>${escapeHtml(s.role)}` : ''}</td>
        <td>${escapeHtml(games.join(', '))}</td>
        <td>${escapeHtml(s.message)}</td>
        <td>${s.emailed ? '✓' : '—'}</td>
      </tr>`;
    })
    .join('');

  const body = `<div class="wrap">
    <h1>Key requests</h1>
    <p class="muted">${submissions.length} submission(s). Stored locally in SQLite.</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Contact</th><th>Outlet</th>
          <th>Audience/Role</th><th>Games</th><th>Message</th><th>Emailed</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">No submissions yet.</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;

  return layout({ title: 'Key requests', body, editMode, bodyClass: 'page-admin' });
}
