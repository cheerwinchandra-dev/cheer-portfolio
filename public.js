// Public endpoints: site data for the portfolio and the contact form.

import { json, readJson, assertSameOrigin, clientInfo, HttpError } from '../http.js';
import { query, first, getSetting, hashIp } from '../db.js';
import { hit } from '../rate-limit.js';
import { getGithubData } from '../github.js';
import { validateContact, sanitizeStoredContent, sanitizeStoredProjects } from '../validate.js';
import { buildGithubView } from '../../public/js/shared/projects.js';

export function humanWait(seconds) {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** GET /api/site: profile content plus live GitHub projects and stats. */
export async function handleSite() {
  let contentRaw = null;
  let projectsRaw = null;
  try {
    [contentRaw, projectsRaw] = await Promise.all([getSetting('content'), getSetting('projects')]);
  } catch (err) {
    console.warn('Settings unavailable, using defaults:', err.message);
  }
  const content = sanitizeStoredContent(contentRaw);
  const projects = sanitizeStoredProjects(projectsRaw);
  const { data, source } = await getGithubData();
  const view = buildGithubView(data, projects);
  return json({ ok: true, content, github: { ...view, source, fetchedAt: data.fetchedAt } }, 200, { 'cache-control': 'no-cache' });
}

/** POST /api/contact: stores a message for the admin inbox. */
export async function handleContact(request, url) {
  assertSameOrigin(request, url);
  const body = await readJson(request, 16 * 1024);

  // Honeypot: a hidden field people never see. Bots fill it in; we pretend it worked.
  if (typeof body.company_site === 'string' && body.company_site.trim() !== '') {
    return json({ ok: true }, 201);
  }
  // Time trap: real people take more than a couple of seconds to write a message.
  const elapsed = Number(body.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 2500) {
    throw new HttpError(429, 'too_fast', 'That was quick! Please wait a few seconds, then press Send again.', { retryAfter: 3 });
  }

  const clean = validateContact(body);
  const info = clientInfo(request);
  const ipHash = await hashIp(info.ip);

  const perIp = await hit(`contact:${ipHash}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!perIp.allowed) {
    throw new HttpError(429, 'rate_limited', `You've already sent several messages. Please try again in ${humanWait(perIp.retryAfter)}.`, { retryAfter: perIp.retryAfter });
  }
  const daily = await hit('contact:global', { limit: 300, windowMs: 24 * 60 * 60 * 1000 });
  if (!daily.allowed) {
    throw new HttpError(429, 'busy', 'The inbox is full for today. Please try again tomorrow or message me on LinkedIn.', { retryAfter: daily.retryAfter });
  }

  const now = Date.now();
  const duplicate = await first('SELECT id FROM pf_messages WHERE email = $1 AND message = $2 AND created_at > $3 LIMIT 1', [clean.email, clean.message, now - 10 * 60 * 1000]);
  if (duplicate) return json({ ok: true }, 201);

  await query('INSERT INTO pf_messages (id, name, email, topic, message, created_at, country, ip_hash, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    crypto.randomUUID(),
    clean.name,
    clean.email,
    clean.topic,
    clean.message,
    now,
    info.country,
    ipHash,
    info.userAgent
  ]);
  return json({ ok: true }, 201);
}
