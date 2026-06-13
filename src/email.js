// Best-effort transactional email for press-kit notifications. Submissions are
// always persisted to SQLite by the caller BEFORE this runs; email is a
// notification layer on top. Uses the provider's HTTP API via fetch (no SDK
// dependency). If unconfigured, logs clearly and returns {sent:false}.
import { config } from './config.js';
import { escapeHtml } from './sanitize.js';

const { provider, apiKey, to, from } = config.email;

export function emailConfigured() {
  return Boolean(provider && apiKey);
}

function buildBody(submission) {
  const lines = [
    ['Press type', submission.press_type],
    ['Name', submission.name],
    ['Email', submission.email],
    ['Outlet / channel', submission.outlet],
    ['Outlet URL', submission.outlet_url],
    ['Audience / readership', submission.audience],
    ['Role', submission.role],
    ['Games requested', submission.games],
    ['Message', submission.message],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html =
    '<h2>New Steam key request</h2><table cellpadding="6" style="border-collapse:collapse">' +
    lines
      .map(
        ([k, v]) =>
          `<tr><td style="font-weight:bold;vertical-align:top">${escapeHtml(k)}</td>` +
          `<td>${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`
      )
      .join('') +
    '</table>';
  return { text, html };
}

// Provider adapters: each returns a fetch Promise.
const adapters = {
  resend: ({ subject, text, html, replyTo }) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html, reply_to: replyTo }),
    }),

  postmark: ({ subject, text, html, replyTo }) =>
    fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: text,
        HtmlBody: html,
        ReplyTo: replyTo,
        MessageStream: 'outbound',
      }),
    }),

  sendgrid: ({ subject, text, html, replyTo }) =>
    fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
    }),
};

// Returns { sent: boolean, reason?: string }.
export async function sendSubmissionEmail(submission) {
  if (!emailConfigured()) {
    console.log(
      '[email] delivery unconfigured (no EMAIL_PROVIDER/EMAIL_API_KEY). ' +
        `Submission #${submission.id} saved to DB only.`
    );
    return { sent: false, reason: 'unconfigured' };
  }
  const adapter = adapters[provider];
  if (!adapter) {
    console.warn(`[email] unknown EMAIL_PROVIDER "${provider}". Submission saved to DB only.`);
    return { sent: false, reason: 'unknown-provider' };
  }

  const { text, html } = buildBody(submission);
  const subject = `Steam key request — ${submission.name || 'unknown'} (${submission.press_type})`;
  // Reply-to the applicant so the team can respond directly.
  const replyTo = submission.email || undefined;

  try {
    const resp = await adapter({ subject, text, html, replyTo });
    if (resp.ok) return { sent: true };
    const detail = await resp.text().catch(() => '');
    console.error(`[email] provider ${provider} returned ${resp.status}: ${detail}`);
    return { sent: false, reason: `provider-${resp.status}` };
  } catch (err) {
    console.error(`[email] send failed: ${err.message}`);
    return { sent: false, reason: 'network-error' };
  }
}
