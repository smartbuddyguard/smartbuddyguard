// HTTP-Server: statische Dateien, REST-API, Medien und WebSocket-Upgrade.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';
import { handleApi, json } from './api.js';
import { handleConnection, startHeartbeat } from './hub.js';
import { saveSync, UPLOAD_DIR } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.pdf': 'application/pdf'
};

function sendFile(req, res, filePath, { cache = 'no-cache' } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
      return;
    }
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
    const headers = {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': cache,
      etag,
      'accept-ranges': 'bytes'
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    // Range-Requests, damit Audio/Video im Browser springen können.
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : stat.size - 1;
        if (start < stat.size && end < stat.size && start <= end) {
          res.writeHead(206, {
            ...headers,
            'content-range': `bytes ${start}-${end}/${stat.size}`,
            'content-length': end - start + 1
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

/** Verhindert das Ausbrechen aus dem Zielverzeichnis (Path Traversal). */
function safeJoin(base, target) {
  const resolved = path.resolve(base, '.' + path.posix.normalize('/' + target));
  return resolved.startsWith(base) ? resolved : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (!res.headersSent) json(res, 400, { error: err.message || 'Ungültige Anfrage.' });
      else res.end();
    }
    return;
  }

  if (url.pathname.startsWith('/media/')) {
    const file = safeJoin(UPLOAD_DIR, url.pathname.slice('/media'.length));
    if (!file) { res.writeHead(403).end(); return; }
    sendFile(req, res, file, { cache: 'public, max-age=31536000, immutable' });
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = safeJoin(PUBLIC_DIR, rel);
  if (!file) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, stat) => {
    // Unbekannte Pfade laden die App (Single-Page-Verhalten).
    if (err || !stat.isFile()) sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    else sendFile(req, res, file);
  });
});

attachWebSocket(server, (conn, req) => handleConnection(conn, req));
startHeartbeat();

server.listen(PORT, HOST, () => {
  console.log(`TeleGroove läuft auf http://localhost:${PORT}`);
  console.log('Zum Testen: zweites Browserfenster (privater Modus) öffnen und zweites Konto anlegen.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    saveSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
