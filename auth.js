// Admin credentials and sessions.
//
// - The password is never stored in plain text: only a PBKDF2 hash, kept in the
//   Netlify environment variable ADMIN_PASSWORD_HASH or, after you change it in
//   the dashboard, in the database.
// - A session is a random 256-bit token in an HttpOnly, Secure, SameSite=Strict
//   cookie. Only a SHA-256 of the token is stored, so a database leak can't be
//   used to sign in.

import { query, first, batch, getSetting, num } from './db.js';
import { HttpError, maskIp } from './http.js';
import { randomToken, sha256Base64Url, isValidHashFormat } from './crypto.js';

export const SESSION_COOKIE = '__Host-cw_session';
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // signed out after 2 hours idle
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // and after 12 hours at most
const MAX_SESSIONS = 5;

const envHash = () => (process.env.ADMIN_PASSWORD_HASH || '').trim();

/** Ties a dashboard password to the ADMIN_PASSWORD_HASH it replaced. */
export async function envFingerprint() {
  return sha256Base64Url(`env:${envHash()}`);
}

/**
 * A password changed in the dashboard wins, until you put a new
 * ADMIN_PASSWORD_HASH in Netlify: then that one wins (your "forgot password" reset).
 */
export async function getCredentials() {
  const stored = await getSetting('admin_password_hash');
  const fromDashboard = Boolean(stored && typeof stored === 'object' && isValidHashFormat(stored.hash) && stored.env === (await envFingerprint()));
  const hash = fromDashboard ? stored.hash : envHash();
  const username = (process.env.ADMIN_USERNAME || 'cheerwin').trim().toLowerCase();
  if (!isValidHashFormat(hash)) {
    throw new HttpError(503, 'not_configured', 'Sign-in is not set up yet. Open /admin/setup on this site to create your password, add it to Netlify as ADMIN_PASSWORD_HASH, then redeploy (README step 4).');
  }
  return { username, hash, source: fromDashboard ? 'dashboard' : 'environment' };
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}`;
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function createSession(info, now = Date.now()) {
  const token = randomToken(32);
  const tokenHash = await sha256Base64Url(token);
  await batch([
    ['DELETE FROM pf_sessions WHERE expires_at < $1 OR last_seen < $2', [now, now - SESSION_IDLE_MS]],
    [
      'INSERT INTO pf_sessions (token_hash, created_at, expires_at, last_seen, ip_masked, country, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [tokenHash, now, now + SESSION_MAX_MS, now, maskIp(info.ip), info.country, info.userAgent]
    ],
    ['DELETE FROM pf_sessions WHERE token_hash NOT IN (SELECT token_hash FROM pf_sessions ORDER BY created_at DESC LIMIT $1)', [MAX_SESSIONS]]
  ]);
  return token;
}

/** Returns the current session, or null. Slides the idle timeout forward. */
export async function getSession(request, now = Date.now()) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length < 40 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const tokenHash = await sha256Base64Url(token);
  const row = await first('SELECT created_at, expires_at, last_seen FROM pf_sessions WHERE token_hash = $1', [tokenHash]);
  if (!row) return null;
  const expiresAt = num(row.expires_at);
  let lastSeen = num(row.last_seen);
  if (expiresAt <= now || lastSeen + SESSION_IDLE_MS <= now) {
    await query('DELETE FROM pf_sessions WHERE token_hash = $1', [tokenHash]);
    return null;
  }
  // Background polling (the inbox auto-refresh) must not keep an idle session alive.
  const background = request.headers.get('x-cw-background') === '1';
  if (!background && now - lastSeen > 60 * 1000) {
    await query('UPDATE pf_sessions SET last_seen = $1 WHERE token_hash = $2', [now, tokenHash]);
    lastSeen = now;
  }
  return { tokenHash, createdAt: num(row.created_at), expiresAt: Math.min(expiresAt, lastSeen + SESSION_IDLE_MS) };
}

export async function requireSession(request) {
  const session = await getSession(request);
  if (!session) throw new HttpError(401, 'unauthorized', 'Please sign in again.');
  return session;
}

export async function destroySession(tokenHash) {
  await query('DELETE FROM pf_sessions WHERE token_hash = $1', [tokenHash]);
}

export async function destroyOtherSessions(keepTokenHash) {
  await query('DELETE FROM pf_sessions WHERE token_hash <> $1', [keepTokenHash]);
}

export async function logAuthEvent(kind, info, now = Date.now()) {
  await batch([
    ['INSERT INTO pf_auth_events (at, kind, ip_masked, country, user_agent) VALUES ($1, $2, $3, $4, $5)', [now, kind, maskIp(info.ip), info.country, info.userAgent]],
    ['DELETE FROM pf_auth_events WHERE id NOT IN (SELECT id FROM pf_auth_events ORDER BY at DESC, id DESC LIMIT 200)', []]
  ]);
}
