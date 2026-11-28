// Local / self-hosted server: serves the front-end from public/ and the API from src/api.js.
// On Vercel this file is not used — api/index.mjs serves the API instead.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './src/api.js';
import { ready } from './src/db.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.json': 'application/json' };

async function serveStatic(res, pathname) {
  let file = normalize(join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  try { const s = await stat(file); if (s.isDirectory()) file = join(file, 'index.html'); }
  catch { file = join(PUBLIC, 'index.html'); } // SPA fallback
  try {
    const data = await readFile(file); const ext = extname(file);
    // Code and styles revalidate on every load so updates reach everyone at once; images can cache.
    const cache = ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 1e6) break; chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith('/api/')) return serveStatic(res, u.pathname);
  const out = await handle({
    method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams),
    cookie: req.headers.cookie, body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : '',
    ip: req.socket.remoteAddress, secure: process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https',
  });
  res.writeHead(out.status, out.headers);
  res.end(out.body);
});

await ready(); // create tables / first-run seed before accepting requests
server.listen(PORT, () => console.log(`  Qasr Laban Collab Manager → http://localhost:${PORT}${process.env.TURSO_DATABASE_URL ? '  (database: Turso)' : ''}`));
