// Application entry point. Express, minimal middleware, mounts all routes.
import express from 'express';
import path from 'node:path';
import { config, ROOT, editConfigured } from './config.js';
import { editModeMiddleware } from './auth.js';
import { registerRoutes } from './routes.js';
import { shutdownDb } from './db.js';
import { resumePending } from './transcode.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // safe behind nginx/caddy; needed for Secure cookies

// Force HTTPS when behind the TLS-terminating proxy (the Cloudflare tunnel sets
// X-Forwarded-Proto to the visitor's scheme). Plain-HTTP visitors get a 301 to
// HTTPS. Direct local requests carry no XFP header and are left alone, so
// localhost health checks (127.0.0.1:3000) keep working.
app.use((req, res, next) => {
  const xfp = req.headers['x-forwarded-proto'];
  if (xfp && xfp !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }
  // HSTS: tell browsers to always use HTTPS for this host going forward (only
  // honored when delivered over HTTPS). Clears the "Not secure" stickiness that
  // earlier plain-HTTP/cert-error visits leave behind. No includeSubDomains so
  // it can't affect mail/other subdomains. 1 year.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// Body parsers (JSON for the edit API; urlencoded for the press form fallback).
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Tiny cookie parser (avoids the cookie-parser dependency).
app.use((req, res, next) => {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) req.cookies[k] = decodeURIComponent(v);
    }
  }
  next();
});

// Determine edit mode for every request.
app.use(editModeMiddleware);

// Static client assets. We use ETag/Last-Modified revalidation (maxAge: 0)
// rather than a long max-age so that edits to CSS/JS show up on the next load
// without forcing a hard refresh. Responses are tiny 304s when unchanged, which
// is cheap even on a Pi. (Uploaded media, which has unique filenames, is still
// cached aggressively — see the media routes.)
const assetOpts = { maxAge: 0, etag: true, lastModified: true };
app.use('/css', express.static(path.join(ROOT, 'public/css'), assetOpts));
app.use('/js', express.static(path.join(ROOT, 'public/js'), assetOpts));

registerRoutes(app);

// 404 + error handlers.
app.use((req, res) => {
  res.status(404).type('html').send('<h1>404 — Not found</h1><p><a href="/">Home</a></p>');
});
app.use((err, req, res, next) => {
  // Multer / upload errors arrive here.
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(status).json({ error: err.message || 'Server error' });
  }
  res.status(status).type('html').send(`<h1>${status}</h1><p>${err.message || 'Server error'}</p>`);
});

const server = app.listen(config.port, config.host, () => {
  console.log(`9UP Games site listening on http://${config.host}:${config.port}`);
  console.log(`  DB:    ${config.dbPath}`);
  console.log(`  Media: ${config.mediaDir}`);
  if (!editConfigured) {
    console.log('  Edit mode: DISABLED (set a strong EDIT_SECRET in .env to enable).');
  } else {
    console.log('  Edit mode: enabled — unlock at /edit/<EDIT_SECRET>');
  }
  resumePending(); // resume any video transcode interrupted by a restart
});

// Graceful shutdown: stop accepting connections, checkpoint + close the DB so
// `site.db` is fully consolidated before the process exits (systemd sends
// SIGTERM on `systemctl stop`).
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} — closing server and checkpointing DB.`);
  server.close(() => {
    shutdownDb();
    process.exit(0);
  });
  // Fallback if connections linger.
  setTimeout(() => {
    shutdownDb();
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
