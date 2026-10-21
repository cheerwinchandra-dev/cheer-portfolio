// Keeps a fresh copy of your GitHub profile and repositories.
// - Refreshed whenever a visitor arrives and the copy is older than 15 minutes,
//   plus once a day by the scheduled function (netlify/functions/github-refresh.mjs).
// - If GitHub is unreachable, the last good copy is used, then the bundled
//   snapshot, so the site never shows an empty projects section.

import { runInBackground } from './http.js';
import snapshot from '../public/js/shared/snapshot.js';
import { GITHUB_USERNAME } from '../public/js/shared/defaults.js';
import { shapeRepo, shapeProfile } from '../public/js/shared/projects.js';
import { getSetting, setSetting } from './db.js';

const FRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
let inFlight = null;
let lastAttempt = 0;

function config() {
  const user = (process.env.GITHUB_USERNAME || GITHUB_USERNAME).trim();
  const base = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
  return { user, base };
}

async function getJson(url) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'cheerwin-portfolio (+https://github.com/cheerwinchandra-dev)',
    'x-github-api-version': '2022-11-28'
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return res.json();
}

export async function refreshGithub() {
  if (inFlight) return inFlight;
  lastAttempt = Date.now();
  inFlight = (async () => {
    const { user, base } = config();
    const reposUrl = (page) => `${base}/users/${encodeURIComponent(user)}/repos?per_page=100&type=owner&sort=pushed&page=${page}`;
    const [profileRaw, firstPage] = await Promise.all([getJson(`${base}/users/${encodeURIComponent(user)}`), getJson(reposUrl(1))]);
    if (!Array.isArray(firstPage)) throw new Error('GitHub returned an unexpected repository list');
    const reposRaw = [...firstPage];
    for (let page = 2, last = firstPage; page <= 3 && last.length === 100; page++) {
      last = await getJson(reposUrl(page));
      if (!Array.isArray(last)) break;
      reposRaw.push(...last);
    }
    const data = {
      fetchedAt: new Date().toISOString(),
      profile: shapeProfile(profileRaw, user),
      repos: reposRaw.map(shapeRepo).filter(Boolean)
    };
    try {
      await setSetting('github_cache', data);
    } catch (err) {
      console.warn('Could not store GitHub cache:', err.message);
    }
    return data;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

function usable(data) {
  return data && Array.isArray(data.repos) && data.profile && typeof data.fetchedAt === 'string';
}

/** Returns { data, source } where source is "live", "cache" or "snapshot". */
export async function getGithubData() {
  let cached = null;
  try {
    cached = await getSetting('github_cache');
  } catch {
    cached = null;
  }
  if (usable(cached)) {
    const age = Date.now() - Date.parse(cached.fetchedAt);
    if (!(age < FRESH_MS) && Date.now() - lastAttempt > RETRY_MS) {
      // Answer now with the saved copy; refresh in the background.
      runInBackground(refreshGithub().catch((err) => console.warn('GitHub refresh failed:', err.message)));
    }
    return { data: cached, source: 'cache' };
  }
  if (Date.now() - lastAttempt > RETRY_MS) {
    try {
      return { data: await refreshGithub(), source: 'live' };
    } catch (err) {
      console.warn('GitHub fetch failed, using snapshot:', err.message);
    }
  }
  return { data: snapshot, source: 'snapshot' };
}
