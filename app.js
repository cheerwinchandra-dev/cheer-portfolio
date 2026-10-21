// The API: one router for every /api/* request (one Netlify Function,
// netlify/functions/api.mjs).

import { errorResponse, withApiHeaders, HttpError, runWithPlatform } from './http.js';
import { ensureSchema } from './db.js';
import { pruneRateLimits } from './rate-limit.js';
import { refreshGithub } from './github.js';
import { handleSite, handleContact } from './routes/public.js';
import { handleLogin, handleLogout, handleSessionStatus } from './routes/auth.js';
import { handleAdmin } from './routes/admin.js';

function only(method, ...allowed) {
  if (!allowed.includes(method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
}

/**
 * The daily job (netlify/functions/github-refresh.mjs): pulls your newest
 * repositories and clears old rate-limit rows. Netlify runs it on a schedule,
 * and it can't be called from the web.
 */
export async function runDailyJob() {
  const result = { ok: true };
  await ensureSchema();
  try {
    const data = await refreshGithub();
    result.repos = data.repos.length;
  } catch (err) {
    result.ok = false;
    result.github = `failed: ${String(err.message || err).slice(0, 120)}`;
  }
  await pruneRateLimits().catch(() => {});
  return result;
}

async function route(request, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/site') {
    only(method, 'GET', 'HEAD');
    // The public site still works (with default content) if the database is missing.
    await ensureSchema().catch((err) => console.warn('Database unavailable:', err.message));
    return handleSite();
  }
  await ensureSchema();
  if (pathname === '/api/contact') {
    only(method, 'POST');
    return handleContact(request, url);
  }
  if (pathname === '/api/auth/login') {
    only(method, 'POST');
    return handleLogin(request, url);
  }
  if (pathname === '/api/auth/logout') {
    only(method, 'POST');
    return handleLogout(request, url);
  }
  if (pathname === '/api/auth/session') {
    only(method, 'GET');
    return handleSessionStatus(request);
  }
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
    return handleAdmin(request, url);
  }
  throw new HttpError(404, 'not_found', 'Not found.');
}

/**
 * Answers one API request. `platform` carries what the host knows about the
 * visitor: { ip, country, waitUntil } (from Netlify's context, or from the
 * local dev server).
 */
export function handle(request, platform = {}) {
  return runWithPlatform(platform, async () => {
    let response;
    try {
      response = await route(request, new URL(request.url));
    } catch (err) {
      response = errorResponse(err);
    }
    return withApiHeaders(response);
  });
}
