#!/usr/bin/env node
// Local preview server: `npm run dev`, then open http://localhost:3000
//
// Serves public/ with the same headers and URL rules as Netlify (public/_headers
// and public/_redirects), and runs the API from lib/app.js. Without a
// DATABASE_URL it uses a local database in the .data/ folder (PGlite), so you
// can test everything offline. You never deploy this file; Netlify serves the
// site itself.

import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, mkdirSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

// ---------- environment (.env.local, then .env); values are taken literally
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(join(ROOT, '.env.local'));
loadEnv(join(ROOT, '.env'));

// ---------- database
const { setDatabaseAdapter } = await import('../lib/db.js');
let pg = null;
async function localPg() {
  if (pg) return pg;
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = join(ROOT, '.data', 'pglite');
  mkdirSync(dir, { recursive: true });
  pg = new PGlite(dir);
  await pg.waitReady;
  return pg;
}

if (!process.env.DATABASE_URL && !process.env.NETLIFY_DATABASE_URL && !process.env.POSTGRES_URL) {
  const db = await localPg();
  setDatabaseAdapter({
    query: async (text, params = []) => (await db.query(text, params)).rows,
    batch: async (list) => db.transaction(async (tx) => {
      const out = [];
      for (const [text, params] of list) out.push((await tx.query(text, params || [])).rows);
      return out;
    })
  });
  console.log('Database: local (.data/pglite)');
} else {
  console.log('Database: DATABASE_URL from your environment');
}

const { handle } = await import('../lib/app.js');

// ---------- Netlify rules: public/_headers and public/_redirects
// Path patterns: "*" matches anything, ":name" one path segment.
function pathPattern(path) {
  const body = path
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+'))
    .join('.*');
  return new RegExp('^' + body + '$');
}
function readRules(name) {
  const file = join(PUBLIC, name);
  return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
}

const headerRules = [];
for (const line of readRules('_headers')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) headerRules.push({ re: pathPattern(line.trim()), headers: [] });
  else if (headerRules.length) {
    const i = line.indexOf(':');
    if (i > 0) headerRules[headerRules.length - 1].headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
}

// Netlify matches redirect rules with or without a trailing slash.
const redirectRules = readRules('_redirects')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [from, to, code = '301'] = line.split(/\s+/);
    return { re: pathPattern(from.replace(/\/+$/, '') || '/'), to, status: Number(code.replace('!', '')) };
  });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function staticFile(pathname) {
  let p;
  try {
    p = normalize(decodeURIComponent(pathname));
  } catch {
    return null;
  }
  const full = join(PUBLIC, p);
  if (!full.startsWith(PUBLIC + sep) && full !== PUBLIC) return null;
  // Like Netlify: the file itself or a folder's index.html. (Clean addresses
  // such as /admin/setup come from public/_redirects.)
  if (/(^|[\\/])_(headers|redirects)$/.test(full)) return null;
  const candidates = [full, join(full, 'index.html')];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function applyHeaders(res, pathname) {
  for (const rule of headerRules) if (rule.re.test(pathname)) for (const [k, v] of rule.headers) res.setHeader(k, v);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const request = new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? 'half' : undefined });
      const response = await handle(request, { ip: req.socket.remoteAddress || '127.0.0.1', country: '' });
      const out = {};
      response.headers.forEach((v, k) => {
        if (k !== 'set-cookie') out[k] = v;
      });
      const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(response.status, out);
      if (response.body && req.method !== 'HEAD') Readable.fromWeb(response.body).pipe(res);
      else res.end();
      return;
    }

    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }
    // public/_redirects: 3xx sends the browser elsewhere, 200 serves another file.
    let servePath = pathname;
    const rule = redirectRules.find((r) => r.re.test(pathname.replace(/\/+$/, '') || '/'));
    if (rule && rule.status >= 300 && rule.status < 400) {
      res.writeHead(rule.status, { location: rule.to + url.search });
      res.end();
      return;
    }
    if (rule && rule.status === 200) servePath = rule.to;
    const file = staticFile(servePath);
    applyHeaders(res, pathname);
    if (!file) {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(join(PUBLIC, '404.html')).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Portfolio running at http://localhost:${PORT}  (dashboard: http://localhost:${PORT}/admin)`);
  if (!process.env.ADMIN_PASSWORD_HASH) console.log('Tip: run "npm run hash-password -- --local" once to be able to sign in locally.');
});
