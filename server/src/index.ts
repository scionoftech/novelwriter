import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { novelsRouter } from './routes/novels';
import { codexRouter } from './routes/codex';
import { snapshotsRouter } from './routes/snapshots';
import { chatsRouter } from './routes/chats';
import { settingsRouter } from './routes/settings';
import { aiRouter } from './routes/ai';
import { exportRouter } from './routes/export';
import { syncRouter } from './routes/sync';
import { importRouter } from './routes/import';

const app = express();
const PORT = Number(process.env.PORT || 3717);
const HOST = process.env.HOST || '127.0.0.1';

// Only the app's own origins may call the API from a browser; otherwise any web
// page the user visits could read or modify the manuscript via localhost.
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)),
  })
);

// CORS only blocks cross-origin *reads*. Also reject requests that a foreign page
// could send blindly (cross-site POSTs carry an Origin header), and — when bound to
// loopback — requests with a foreign Host header (DNS rebinding).
const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, '127.0.0.1:5173', 'localhost:5173']);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'forbidden origin' });
  if (LOOPBACK && req.headers.host && !ALLOWED_HOSTS.has(req.headers.host)) {
    return res.status(403).json({ error: 'forbidden host' });
  }
  next();
});
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/novels', novelsRouter);
app.use('/api/codex', codexRouter);
app.use('/api/snapshots', snapshotsRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/export', exportRouter);
app.use('/api/sync', syncRouter);
app.use('/api/import', importRouter);

// Serve the built client in production
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) {
    // body-parser and multer errors carry a 4xx status
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err?.message || 'internal error' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`NovelWriter running at http://${HOST}:${PORT}`);
});
