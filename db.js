// Database access (Postgres). On Netlify this is a free Neon database: its
// connection string goes in the DATABASE_URL environment variable. Tables are
// created on first use, so a fresh database needs no manual setup.
// All tables start with "pf_" so they never clash with another app's tables.

import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';
import { randomToken, hmacBase64Url } from './crypto.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pf_messages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    starred BOOLEAN NOT NULL DEFAULT FALSE,
    country TEXT NOT NULL DEFAULT '',
    ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS pf_messages_created ON pf_messages (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS pf_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at DOUBLE PRECISION NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL,
    last_seen DOUBLE PRECISION NOT NULL,
    ip_masked TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS pf_rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start DOUBLE PRECISION NOT NULL DEFAULT 0,
    locked_until DOUBLE PRECISION NOT NULL DEFAULT 0,
    strikes INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pf_auth_events (
    id BIGSERIAL PRIMARY KEY,
    at DOUBLE PRECISION NOT NULL,
    kind TEXT NOT NULL,
    ip_masked TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS pf_auth_events_at ON pf_auth_events (at DESC)`,
  `CREATE TABLE IF NOT EXISTS pf_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
  )`
];

let adapter = null;

/** Lets the local dev server plug in its own database. */
export function setDatabaseAdapter(a) {
  adapter = a;
  schemaReady = null;
  saltCache = null;
}

function connectionString() {
  // NETLIFY_DATABASE_URL: a database made with Netlify's earlier (Neon) beta.
  return (process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || process.env.POSTGRES_URL || '').trim();
}

function db() {
  if (adapter) return adapter;
  const url = connectionString();
  if (!url) {
    throw new HttpError(503, 'not_configured', 'The database is not connected yet. Add your Neon connection string to Netlify as DATABASE_URL, then redeploy (README step 3).');
  }
  const sql = neon(url);
  adapter = {
    query: (text, params = []) => sql.query(text, params),
    batch: (list) => sql.transaction(list.map(([text, params]) => sql.query(text, params || [])))
  };
  return adapter;
}

/** Runs one parameterised query ($1, $2, …) and returns the rows. */
export async function query(text, params = []) {
  return db().query(text, params);
}

/** Runs several queries in one transaction. Each item is [text, params]. */
export async function batch(list) {
  return db().batch(list);
}

export async function first(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

let schemaReady = null;

export async function ensureSchema() {
  if (!schemaReady) {
    const create = () => batch(SCHEMA.map((s) => [s, []]));
    // Two fresh instances creating tables at the same moment can collide once; retry.
    schemaReady = create()
      .catch(() => new Promise((r) => setTimeout(r, 250)).then(create))
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  await schemaReady;
}

export async function getSetting(key) {
  const row = await first('SELECT value FROM pf_settings WHERE key = $1', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export async function setSetting(key, value) {
  await query(
    'INSERT INTO pf_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
    [key, JSON.stringify(value), Date.now()]
  );
}

export async function deleteSetting(key) {
  await query('DELETE FROM pf_settings WHERE key = $1', [key]);
}

let saltCache = null;

/** A random per-site salt, so stored IP fingerprints can't be reversed. */
async function ipSalt() {
  if (saltCache) return saltCache;
  await query('INSERT INTO pf_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING', ['ip_salt', JSON.stringify(randomToken(32)), Date.now()]);
  saltCache = await getSetting('ip_salt');
  return saltCache;
}

/**
 * The part of an address that identifies one network. IPv6 users usually get a
 * whole /64 block, so rate limits apply to the /64 rather than to each address.
 */
export function networkOf(ip) {
  const s = String(ip || '').trim().toLowerCase().split('%')[0];
  if (!s.includes(':')) return s;
  const v4 = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return v4[1];
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64';
}

export async function hashIp(ip) {
  return (await hmacBase64Url(await ipSalt(), networkOf(ip))).slice(0, 24);
}

export const num = (v) => (v === null || v === undefined ? 0 : Number(v));
