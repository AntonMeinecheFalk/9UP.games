// Edit-mode authentication. There is NO login form: editing is unlocked by
// visiting /edit/<EDIT_SECRET>, which sets a short-lived, HMAC-signed cookie.
// The secret is never sent to the client and never appears in markup.
import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE_NAME = 'edit_session';

function sign(payloadB64) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payloadB64)
    .digest('base64url');
}

// Constant-time comparison of the supplied secret against the configured one.
export function secretMatches(candidate) {
  if (!config.editSecret) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(config.editSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function makeSessionToken() {
  const exp = Date.now() + config.sessionHours * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

export function setSessionCookie(res) {
  res.cookie(COOKIE_NAME, makeSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Populates req.editMode for every request.
export function editModeMiddleware(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : undefined;
  req.editMode = verifySessionToken(token);
  res.locals.editMode = req.editMode;
  next();
}

// Guards mutating API routes. Read paths never use this.
export function requireEdit(req, res, next) {
  if (req.editMode) return next();
  res.status(403).json({ error: 'Edit mode required.' });
}
