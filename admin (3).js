// Admin-only endpoints. Every request here needs a valid session; every
// change also needs to come from this site (CSRF protection).

import { json, readJson, assertSameOrigin, clientInfo, HttpError } from '../http.js';
import { query, first, getSetting, setSetting, deleteSetting, hashIp, num } from '../db.js';
import { requireSession, getCredentials, destroyOtherSessions, logAuthEvent, envFingerprint } from '../auth.js';
import { verifyPassword, hashPassword } from '../crypto.js';
import { recordFailure, lockedFor, clearKey } from '../rate-limit.js';
import { refreshGithub, getGithubData } from '../github.js';
import { validateContent, validateProjects, sanitizeStoredContent, sanitizeStoredProjects, passwordProblem } from '../validate.js';
import { humanWait } from './public.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_COLUMNS = 'id, name, email, topic, message, created_at, is_read, starred, country';

function rowToMessage(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    topic: r.topic,
    message: r.message,
    createdAt: num(r.created_at),
    read: r.is_read === true,
    starred: r.starred === true,
    country: r.country
  };
}

async function counts() {
  const row = await first(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT is_read)::int AS unread, COUNT(*) FILTER (WHERE starred)::int AS starred FROM pf_messages'
  );
  return { all: num(row.total), unread: num(row.unread), starred: num(row.starred) };
}

async function listMessages(url) {
  const filter = url.searchParams.get('filter') || 'all';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const where = [];
  const args = [];
  if (filter === 'unread') where.push('NOT is_read');
  else if (filter === 'starred') where.push('starred');
  else if (filter !== 'all') throw new HttpError(400, 'bad_filter', 'Unknown filter.');
  if (q) {
    args.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    const p = `$${args.length}`;
    where.push(`(name ILIKE ${p} ESCAPE '\\' OR email ILIKE ${p} ESCAPE '\\' OR message ILIKE ${p} ESCAPE '\\' OR topic ILIKE ${p} ESCAPE '\\')`);
  }
  const rows = await query(
    `SELECT ${MESSAGE_COLUMNS} FROM pf_messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`,
    args
  );
  return json({ ok: true, messages: rows.map(rowToMessage), counts: await counts(), serverTime: Date.now() });
}

async function updateMessage(request, id) {
  const body = await readJson(request, 512);
  const sets = [];
  const args = [];
  if ('read' in body) {
    if (typeof body.read !== 'boolean') throw new HttpError(400, 'validation_failed', '"read" must be true or false.');
    args.push(body.read);
    sets.push(`is_read = $${args.length}`);
  }
  if ('starred' in body) {
    if (typeof body.starred !== 'boolean') throw new HttpError(400, 'validation_failed', '"starred" must be true or false.');
    args.push(body.starred);
    sets.push(`starred = $${args.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'validation_failed', 'Nothing to update.');
  args.push(id);
  const rows = await query(`UPDATE pf_messages SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING id`, args);
  if (!rows.length) throw new HttpError(404, 'not_found', 'That message no longer exists.');
  return json({ ok: true, counts: await counts() });
}

async function deleteMessage(id) {
  await query('DELETE FROM pf_messages WHERE id = $1', [id]);
  return json({ ok: true, counts: await counts() });
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv() {
  const rows = await query(`SELECT ${MESSAGE_COLUMNS} FROM pf_messages ORDER BY created_at DESC`);
  const header = ['Date (UTC)', 'Name', 'Email', 'Topic', 'Message', 'Read', 'Starred', 'Country', 'ID'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [new Date(num(r.created_at)).toISOString().replace('T', ' ').slice(0, 19), r.name, r.email, r.topic, r.message, r.is_read ? 'yes' : 'no', r.starred ? 'yes' : 'no', r.country, r.id]
        .map(csvCell)
        .join(',')
    );
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="portfolio-messages-${day}.csv"`,
      'cache-control': 'no-store'
    }
  });
}

async function getSettings() {
  const [contentRaw, projectsRaw] = await Promise.all([getSetting('content'), getSetting('projects')]);
  const { data, source } = await getGithubData();
  return json({
    ok: true,
    content: sanitizeStoredContent(contentRaw),
    contentCustomized: Boolean(contentRaw),
    projects: sanitizeStoredProjects(projectsRaw),
    repos: data.repos,
    github: { source, fetchedAt: data.fetchedAt, profileUrl: data.profile ? data.profile.url : '' }
  });
}

async function securityOverview(session) {
  const [sessions, events, creds] = await Promise.all([
    query('SELECT token_hash, created_at, last_seen, ip_masked, country, user_agent FROM pf_sessions ORDER BY last_seen DESC LIMIT 20'),
    query('SELECT at, kind, ip_masked, country, user_agent FROM pf_auth_events ORDER BY at DESC, id DESC LIMIT 50'),
    getCredentials()
  ]);
  return json({
    ok: true,
    passwordSource: creds.source,
    username: creds.username,
    sessions: sessions.map((s) => ({
      current: s.token_hash === session.tokenHash,
      createdAt: num(s.created_at),
      lastSeen: num(s.last_seen),
      ip: s.ip_masked,
      country: s.country,
      userAgent: s.user_agent
    })),
    events: events.map((e) => ({ at: num(e.at), kind: e.kind, ip: e.ip_masked, country: e.country, userAgent: e.user_agent }))
  });
}

async function changePassword(request, session) {
  const body = await readJson(request, 2048);
  const info = clientInfo(request);
  const key = `pwchange:${await hashIp(info.ip)}`;
  const wait = await lockedFor(key);
  if (wait) throw new HttpError(429, 'locked', `Too many wrong attempts. Try again in ${humanWait(wait)}.`, { retryAfter: wait });

  const current = typeof body.currentPassword === 'string' ? body.currentPassword.slice(0, 256) : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  const creds = await getCredentials();
  if (!(await verifyPassword(current, creds.hash))) {
    const r = await recordFailure(key, { max: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
    await logAuthEvent('password_change_failed', info);
    throw new HttpError(400, 'validation_failed', 'Your current password is not correct.', { fields: { currentPassword: 'Your current password is not correct.' }, attemptsLeft: r.remaining });
  }
  const problem = passwordProblem(next, creds.username);
  if (problem) throw new HttpError(400, 'validation_failed', problem, { fields: { newPassword: problem } });
  if (next === current) {
    throw new HttpError(400, 'validation_failed', 'The new password must be different.', { fields: { newPassword: 'The new password must be different.' } });
  }
  await setSetting('admin_password_hash', { hash: await hashPassword(next), env: await envFingerprint() });
  await clearKey(key);
  await destroyOtherSessions(session.tokenHash);
  await logAuthEvent('password_changed', info);
  return json({ ok: true });
}

export async function handleAdmin(request, url) {
  const session = await requireSession(request);
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(request, url);
  const path = url.pathname.replace(/^\/api\/admin/, '') || '/';

  if (path === '/messages' && method === 'GET') return listMessages(url);
  if (path === '/messages.csv' && method === 'GET') return exportCsv();
  if (path === '/messages/read-all' && method === 'POST') {
    await query('UPDATE pf_messages SET is_read = TRUE WHERE NOT is_read');
    return json({ ok: true, counts: await counts() });
  }
  const m = path.match(/^\/messages\/([^/]+)$/);
  if (m) {
    if (!UUID.test(m[1])) throw new HttpError(404, 'not_found', 'That message no longer exists.');
    if (method === 'PATCH') return updateMessage(request, m[1]);
    if (method === 'DELETE') return deleteMessage(m[1]);
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  }

  if (path === '/settings' && method === 'GET') return getSettings();
  if (path === '/content' && method === 'PUT') {
    const body = await readJson(request, 32 * 1024);
    const current = sanitizeStoredContent(await getSetting('content'));
    const content = validateContent(body.content, current);
    await setSetting('content', content);
    return json({ ok: true, content });
  }
  if (path === '/content/reset' && method === 'POST') {
    await deleteSetting('content');
    return json({ ok: true, content: sanitizeStoredContent(null) });
  }
  if (path === '/projects' && method === 'PUT') {
    const body = await readJson(request, 64 * 1024);
    const projects = validateProjects(body.projects);
    await setSetting('projects', projects);
    return json({ ok: true, projects });
  }
  if (path === '/github/refresh' && method === 'POST') {
    try {
      const data = await refreshGithub();
      return json({ ok: true, repos: data.repos, github: { source: 'live', fetchedAt: data.fetchedAt, profileUrl: data.profile.url } });
    } catch (err) {
      throw new HttpError(502, 'github_unavailable', 'GitHub could not be reached right now. The site keeps showing the last saved copy. Try again in a few minutes.', { detail: String(err.message || '').slice(0, 120) });
    }
  }

  if (path === '/security' && method === 'GET') return securityOverview(session);
  if (path === '/password' && method === 'POST') return changePassword(request, session);
  if (path === '/sessions/revoke-others' && method === 'POST') {
    await destroyOtherSessions(session.tokenHash);
    await logAuthEvent('sessions_revoked', clientInfo(request));
    return json({ ok: true });
  }

  throw new HttpError(404, 'not_found', 'Not found.');
}
