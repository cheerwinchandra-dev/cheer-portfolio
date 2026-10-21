// Turns raw GitHub data into the project cards and stats the site shows.
// Used by both the server (src/) and the browser (fallback mode), so the rules
// are identical everywhere.

import { COVER_STYLES } from './defaults.js';

// "Label: value" pairs that look like credentials. Matching text is never shown.
const CRED_PAIR = /(?:user(?:name)?|login|pass(?:word|wd|code)?|pwd|e-?mail|token|api[ _-]?key|secret|otp)\s*[:=]\s*(\S+)/gi;
const CRED_TEST = /(?:user(?:name)?|login|pass(?:word|wd|code)?|pwd|e-?mail|token|api[ _-]?key|secret|otp)\s*[:=]/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function cleanText(input, max = 280) {
  if (typeof input !== 'string') return '';
  return input.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Removes anything that looks like a login/password from a repo description.
 * "Login: User: x | Password: y  EduGuard is ..." -> "EduGuard is ..."
 * Returns '' when nothing safe is left.
 */
export function cleanDescription(input) {
  const text = cleanText(input, 1000);
  if (!text) return '';
  if (!CRED_TEST.test(text)) return text.slice(0, 280);
  let end = -1;
  CRED_PAIR.lastIndex = 0;
  let m;
  while ((m = CRED_PAIR.exec(text)) !== null) end = m.index + m[0].length;
  let rest = end === -1 ? '' : text.slice(end);
  rest = rest.replace(/^[\s|,;:/–—-]+/, '');
  rest = rest.replace(/^role\s*:\s*[^.|]*(?:[.|]\s*|$)/i, '').trim();
  if (rest.length < 12 || CRED_TEST.test(rest)) return '';
  return rest.slice(0, 280);
}

export function safeUrl(input) {
  if (typeof input !== 'string') return '';
  let u = input.trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

export function prettifyName(name) {
  return cleanText(String(name || ''), 100)
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Keeps only the fields the site needs, cleaned. */
export function shapeRepo(raw) {
  if (!raw || typeof raw !== 'object' || !REPO_NAME.test(String(raw.name || ''))) return null;
  return {
    name: String(raw.name),
    description: cleanDescription(raw.description),
    language: cleanText(raw.language || '', 40),
    stars: Number.isFinite(raw.stargazers_count) ? raw.stargazers_count : Number(raw.stars) || 0,
    url: safeUrl(raw.html_url || raw.url || ''),
    homepage: safeUrl(raw.homepage || ''),
    pushedAt: validDate(raw.pushed_at || raw.pushedAt),
    createdAt: validDate(raw.created_at || raw.createdAt),
    fork: Boolean(raw.fork),
    archived: Boolean(raw.archived)
  };
}

export function shapeProfile(raw, fallbackLogin) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const login = REPO_NAME.test(String(r.login || '')) ? String(r.login) : fallbackLogin;
  return {
    login,
    url: safeUrl(r.html_url || '') || `https://github.com/${login}`,
    publicRepos: Number.isFinite(r.public_repos) ? r.public_repos : Number.isFinite(r.publicRepos) ? r.publicRepos : null,
    createdAt: validDate(r.created_at || r.createdAt)
  };
}

function validDate(value) {
  if (typeof value !== 'string') return '';
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

function lowerSet(list) {
  return new Set((Array.isArray(list) ? list : []).map((n) => String(n).toLowerCase()));
}

function byPushedDesc(a, b) {
  return (Date.parse(b.pushedAt) || 0) - (Date.parse(a.pushedAt) || 0);
}

/** Visible repos only: no forks, no archived, nothing on the hidden list. */
export function visibleRepos(repos, settings) {
  const hidden = lowerSet(settings && settings.hidden);
  return (Array.isArray(repos) ? repos : []).filter((r) => r && !r.fork && !r.archived && !hidden.has(r.name.toLowerCase()));
}

/** Pinned projects first (in pin order), then everything else, newest push first. */
export function composeProjects(repos, settings) {
  const s = settings || {};
  const list = visibleRepos(repos, s);
  const byName = new Map(list.map((r) => [r.name.toLowerCase(), r]));
  const pinnedNames = (Array.isArray(s.pinned) ? s.pinned : []).map((n) => String(n).toLowerCase());
  const pinned = [];
  for (const n of pinnedNames) {
    const r = byName.get(n);
    if (r && !pinned.includes(r)) pinned.push(r);
  }
  const rest = list.filter((r) => !pinned.includes(r)).sort(byPushedDesc);
  const overrides = s.overrides && typeof s.overrides === 'object' ? s.overrides : {};
  const findOverride = (name) => {
    const key = Object.keys(overrides).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? overrides[key] || {} : {};
  };
  return [...pinned, ...rest].map((r) => {
    const o = findOverride(r.name);
    const cover = COVER_STYLES.includes(o.cover) ? o.cover : 'auto';
    const demo = safeUrl(o.demo || '') || r.homepage;
    return {
      name: r.name,
      title: cleanText(o.title || '', 40) || prettifyName(r.name),
      tagline: cleanText(o.tagline || '', 60),
      category: cleanText(o.category || '', 40) || r.language || 'Project',
      description: cleanText(o.description || '', 320) || r.description,
      language: r.language,
      url: r.url,
      demo,
      pushedAt: r.pushedAt,
      stars: r.stars,
      cover,
      pinned: pinned.includes(r)
    };
  });
}

/** The repos you pushed to most recently (activity feed). */
export function recentActivity(repos, settings, count = 3) {
  return visibleRepos(repos, settings).filter((r) => r.pushedAt).sort(byPushedDesc).slice(0, count);
}

export function computeStats(profile, repos, projects) {
  const all = Array.isArray(repos) ? repos : [];
  const years = all.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite);
  if (profile && Date.parse(profile.createdAt)) years.push(Date.parse(profile.createdAt));
  const since = years.length ? new Date(Math.min(...years)).getUTCFullYear() : null;
  const publicRepos = profile && Number.isFinite(profile.publicRepos) ? profile.publicRepos : all.filter((r) => !r.fork).length;
  return {
    publicRepos,
    liveDemos: (projects || []).filter((p) => p.demo).length,
    since
  };
}

/** Everything the page needs from GitHub, in one object. */
export function buildGithubView(data, settings) {
  const repos = (data && Array.isArray(data.repos) ? data.repos : []).filter(Boolean);
  const profile = data && data.profile ? data.profile : null;
  const projects = composeProjects(repos, settings);
  return {
    profileUrl: profile ? profile.url : '',
    projects,
    activity: recentActivity(repos, settings, 3).map((r) => {
      const p = projects.find((x) => x.name === r.name);
      return { name: r.name, title: p ? p.title : prettifyName(r.name), url: r.url, pushedAt: r.pushedAt, language: r.language };
    }),
    stats: computeStats(profile, repos, projects)
  };
}
