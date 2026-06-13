// Application entry point. Express, minimal middleware, mounts all routes.
import express from 'express';
import path from 'node:path';
import { config, ROOT, editConfigured } from './config.js';
import { editModeMiddleware } from './auth.js';
import { registerRoutes } from './routes.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // safe behind nginx/caddy; needed for Secure cookies

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

// Static client assets (long cache; files are versioned by content rarely so
// keep a modest cache to ease updates on a Pi).
app.use(
  '/css',
  express.static(path.join(ROOT, 'public/css'), { maxAge: '1h' })
);
app.use('/js', express.static(path.join(ROOT, 'public/js'), { maxAge: '1h' }));

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

app.listen(config.port, config.host, () => {
  console.log(`9UP Games site listening on http://${config.host}:${config.port}`);
  console.log(`  DB:    ${config.dbPath}`);
  console.log(`  Media: ${config.mediaDir}`);
  if (!editConfigured) {
    console.log('  Edit mode: DISABLED (set a strong EDIT_SECRET in .env to enable).');
  } else {
    console.log('  Edit mode: enabled — unlock at /edit/<EDIT_SECRET>');
  }
});
