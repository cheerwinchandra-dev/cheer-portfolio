// Admin dashboard: sign-in, inbox, projects, profile and security.
// Everything a visitor typed is inserted with textContent, never as HTML.

import { DEFAULT_CONTENT, COVER_STYLES } from './shared/defaults.js';
import { composeProjects, prettifyName, hostOf } from './shared/projects.js';

// ------------------------------------------------------------------ helpers

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const SVG_NS = 'http://www.w3.org/2000/svg';
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function icon(id) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', `#i-${id}`);
  s.append(u);
  return s;
}

class ApiError extends Error {
  constructor(status, data) {
    super((data && data.message) || `Request failed (${status})`);
    this.status = status;
    this.data = data || {};
  }
}

let lastActiveCall = Date.now();

async function api(path, { method = 'GET', body, background = false } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (background) headers['x-cw-background'] = '1';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, { message: 'Can’t reach the server. Check your internet connection and try again.' });
  }
  if (!background) lastActiveCall = Date.now();
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401 && path.startsWith('/api/admin')) {
    sessionLost();
    throw new ApiError(401, data);
  }
  if (!res.ok || data.ok === false) throw new ApiError(res.status, data);
  return data;
}

const dtFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regionNames = null;
}

const fmtDateTime = (ms) => (Number.isFinite(ms) ? dtFmt.format(new Date(ms)) : '');
function fmtShort(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  return dayFmt.format(d);
}
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
function countryName(code) {
  if (!code || code.length !== 2 || code === 'XX' || code === 'T1') return 'Unknown location';
  try {
    return (regionNames && regionNames.of(code.toUpperCase())) || code;
  } catch {
    return code;
  }
}
function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|python|node|go-http|wget|httpie|postman/i.test(ua) ? 'Script or bot' : 'Unknown browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
const AVATAR_COLORS = ['#a3342c', '#8a4b2a', '#6d5a2c', '#3f6b4d', '#2f5f6b', '#4a4f86', '#6b3f78', '#86405a'];
function avatar(name) {
  let n = 0;
  for (const c of name) n = (n * 31 + c.codePointAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).map((w) => Array.from(w)[0] || '').slice(0, 2).join('').toUpperCase() || '?';
  const el = h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials });
  el.style.background = AVATAR_COLORS[n % AVATAR_COLORS.length];
  return el;
}

function toast(text, kind = '') {
  const box = $('#toasts');
  if (!box) return;
  const t = h('div', { class: `toast${kind ? ' toast--' + kind : ''}`, role: kind === 'err' ? 'alert' : 'status' }, kind === 'ok' ? icon('check') : null, h('span', { text }));
  box.append(t);
  setTimeout(() => {
    t.classList.add('is-out');
    setTimeout(() => t.remove(), 350);
  }, kind === 'err' ? 6500 : 4000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { value: text, readonly: true });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function setLoading(btn, on) {
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

function humanWait(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ state

const S = {
  view: null,
  tab: 'inbox',
  username: '',
  expiresAt: 0,
  messages: [],
  counts: { all: 0, unread: 0, starred: 0 },
  filter: 'all',
  q: '',
  selectedId: null,
  confirmDelete: false,
  lastSync: 0,
  settingsLoaded: false,
  repos: [],
  github: null,
  projectsSaved: null,
  projectsDraft: null,
  expanded: new Set(),
  contentSaved: null,
  contentBaseline: null,
  timers: []
};

// ------------------------------------------------------------------ sign in

let lockTimer = 0;
let lockUntil = 0;
const isLocked = () => Date.now() < lockUntil;

function showLogin(message = '', kind = '') {
  stopTimers();
  S.view = 'login';
  S.messages = [];
  S.selectedId = null;
  S.settingsLoaded = false;
  S.lastSync = 0;
  S.counts = { all: 0, unread: 0, starred: 0 };
  S.contentSaved = null;
  S.contentBaseline = null;
  S.projectsSaved = null;
  S.projectsDraft = null;
  $('#profile-form')?.replaceChildren();
  $('#repo-list')?.replaceChildren();
  clearDetail();
  $('#mail-list')?.replaceChildren();
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
  document.title = 'Sign in · Cheerwin Chandra';
  const msg = $('#login-msg');
  msg.textContent = message;
  msg.classList.toggle('is-ok', kind === 'ok');
  setTimeout(() => $('#lg-user').focus(), 50);
}

function sessionLost() {
  if (S.view !== 'app') return;
  showLogin('Your session ended. Please sign in again.');
}

function lockLogin(seconds, message) {
  const btn = $('#login-btn');
  const msg = $('#login-msg');
  lockUntil = Date.now() + seconds * 1000;
  clearInterval(lockTimer);
  btn.disabled = true;
  const tick = () => {
    const left = (lockUntil - Date.now()) / 1000;
    if (left <= 0) {
      clearInterval(lockTimer);
      lockTimer = 0;
      btn.disabled = false;
      msg.textContent = 'You can try again now.';
      return;
    }
    msg.textContent = `${message ? message.replace(/ Try again in .*$/, '') : 'Too many failed attempts.'} Try again in ${humanWait(left)}.`;
  };
  tick();
  lockTimer = setInterval(tick, 1000);
}

function bindLogin() {
  const form = $('#login-form');
  const user = $('#lg-user');
  const pass = $('#lg-pass');
  const btn = $('#login-btn');
  const msg = $('#login-msg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled || isLocked()) return;
    const username = user.value.trim();
    const password = pass.value;
    msg.classList.remove('is-ok');
    if (!username || !password) {
      msg.textContent = 'Enter your username and password.';
      (username ? pass : user).focus();
      return;
    }
    setLoading(btn, true);
    msg.textContent = '';
    try {
      await api('/api/auth/login', { method: 'POST', body: { username, password } });
      pass.value = '';
      const s = await api('/api/auth/session');
      if (!s.authenticated) throw new ApiError(0, { message: 'Signed in, but the browser did not keep the session cookie. Make sure cookies are allowed for this site.' });
      enterApp(s);
    } catch (err) {
      pass.value = '';
      form.classList.remove('is-shake');
      void form.offsetWidth;
      form.classList.add('is-shake');
      if (err.status === 401) {
        const left = err.data.attemptsLeft;
        msg.textContent = `Wrong username or password.${Number.isFinite(left) && left > 0 ? ` ${left} attempt${left === 1 ? '' : 's'} left before a 15-minute lock.` : ''}`;
      } else if (err.status === 429) {
        lockLogin(err.data.retryAfter || 900, err.data.message);
      } else {
        msg.textContent = err.data.message || 'Sign-in failed. Please try again.';
      }
      if (!isLocked()) pass.focus();
    } finally {
      btn.classList.remove('is-loading');
      btn.disabled = isLocked();
    }
  });

  const caps = $('#caps-hint');
  const checkCaps = (e) => {
    if (typeof e.getModifierState === 'function') caps.hidden = !e.getModifierState('CapsLock');
  };
  pass.addEventListener('keydown', checkCaps);
  pass.addEventListener('keyup', checkCaps);
  pass.addEventListener('blur', () => {
    caps.hidden = true;
  });
}

function bindPasswordToggles() {
  for (const btn of $$('[data-pw-toggle]')) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('data-pw-toggle'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    });
  }
}

// ------------------------------------------------------------------ app shell

const IDLE_MS = 2 * 60 * 60 * 1000;
let lastInput = Date.now();

function stopTimers() {
  S.timers.forEach(clearInterval);
  S.timers = [];
}

function enterApp(session) {
  S.view = 'app';
  S.username = session.username || '';
  S.expiresAt = session.expiresAt || 0;
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#login-msg').textContent = '';
  showTab(location.hash.slice(1) || 'inbox');
  loadMessages();
  stopTimers();
  // Auto-refresh the inbox while the tab is visible (does not extend the session).
  S.timers.push(setInterval(() => {
    if (document.visibilityState === 'visible' && S.view === 'app') loadMessages({ background: true });
  }, 20000));
  S.timers.push(setInterval(tickClock, 15000));
  tickClock();
}

function tickClock() {
  if (S.view !== 'app') return;
  if (Date.now() - lastInput > IDLE_MS) {
    logout('You were signed out after 2 hours without activity.');
    return;
  }
  const left = S.expiresAt - Date.now();
  const el = $('#session-left');
  if (el) el.textContent = left > 0 ? `Signed in as ${S.username}. Auto sign-out after 2 hours idle.` : '';
  renderSynced();
}

function bindActivity() {
  const mark = () => {
    lastInput = Date.now();
    // Keep the server session alive while you are actually using the dashboard.
    if (S.view === 'app' && Date.now() - lastActiveCall > 10 * 60 * 1000) {
      lastActiveCall = Date.now();
      api('/api/auth/session')
        .then((s) => {
          if (!s.authenticated) sessionLost();
          else S.expiresAt = s.expiresAt;
        })
        .catch(() => {});
    }
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.view === 'app') {
      tickClock();
      loadMessages({ background: true });
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (S.view === 'app' && (projectsDirty() || profileDirty())) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

async function logout(message = 'You signed out.') {
  try {
    await api('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    /* the cookie is cleared server-side when possible; show sign-in either way */
  }
  showLogin(message, 'ok');
}

const TABS = ['inbox', 'projects', 'profile', 'security'];

function showTab(name) {
  const tab = TABS.includes(name) ? name : 'inbox';
  S.tab = tab;
  for (const p of $$('[data-panel]')) p.hidden = p.getAttribute('data-panel') !== tab;
  for (const a of $$('[data-tab]')) {
    if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if ((tab === 'projects' || tab === 'profile') && !S.settingsLoaded) loadSettings();
  if (tab === 'security') loadSecurity();
  updateTitle();
  window.scrollTo(0, 0);
}

function updateTitle() {
  const names = { inbox: 'Inbox', projects: 'Projects', profile: 'Profile', security: 'Security' };
  const unread = S.counts.unread;
  document.title = `${unread ? `(${unread}) ` : ''}${names[S.tab]} · Dashboard`;
}

// ------------------------------------------------------------------ inbox

async function loadMessages({ background = false } = {}) {
  const params = new URLSearchParams({ filter: S.filter });
  if (S.q) params.set('q', S.q);
  const refresh = $('#refresh');
  if (!background) refresh?.classList.add('is-spinning');
  try {
    const d = await api(`/api/admin/messages?${params}`, { background });
    const prevAll = S.counts.all;
    const firstLoad = S.lastSync === 0;
    S.messages = d.messages;
    S.counts = d.counts;
    S.lastSync = Date.now();
    if (!firstLoad && d.counts.all > prevAll) {
      const n = d.counts.all - prevAll;
      toast(`${n} new message${n === 1 ? '' : 's'} just arrived.`, 'ok');
    }
    renderCounts();
    renderList();
    // Keep an open message on screen even if it no longer matches the filter.
    const sel = S.messages.find((m) => m.id === S.selectedId);
    if (sel && !S.confirmDelete) renderDetail(sel);
    renderSynced();
  } catch (err) {
    if (err.status !== 401 && !background) toast(err.message, 'err');
    if (err.status === 0 && background) $('#synced').textContent = 'Offline. Retrying automatically.';
  } finally {
    refresh?.classList.remove('is-spinning');
  }
}

function renderSynced() {
  const el = $('#synced');
  if (el && S.lastSync) el.textContent = `Updated ${ago(S.lastSync)} · refreshes every 20 seconds`;
}

function renderCounts() {
  const c = S.counts;
  $('#kpi-all').textContent = c.all;
  $('#kpi-unread').textContent = c.unread;
  $('#kpi-starred').textContent = c.starred;
  $('#c-all').textContent = c.all;
  $('#c-unread').textContent = c.unread;
  $('#c-starred').textContent = c.starred;
  const badge = $('#unread-badge');
  badge.hidden = !c.unread;
  badge.textContent = c.unread > 99 ? '99+' : String(c.unread);
  $('#mark-all').disabled = !c.unread;
  $('#export').setAttribute('aria-disabled', String(!c.all));
  updateTitle();
}

function renderList() {
  const list = $('#mail-list');
  if (!S.messages.length) {
    const empty = S.q
      ? ['No matches', `No messages match “${S.q}”.`]
      : S.filter === 'unread'
        ? ['All caught up', 'You have read every message.']
        : S.filter === 'starred'
          ? ['Nothing starred', 'Star important messages to find them fast.']
          : ['No messages yet', 'When someone uses the contact form on your site, their message shows up here within 20 seconds.'];
    list.replaceChildren(h('li', { class: 'mail__empty' }, icon('inbox'), h('strong', { text: empty[0] }), h('span', { text: empty[1] })));
    return;
  }
  list.replaceChildren(
    ...S.messages.map((m) => {
      const snippet = m.message.replace(/\s+/g, ' ').slice(0, 160);
      return h(
        'li',
        { class: `mail__item${m.read ? '' : ' is-unread'}${m.id === S.selectedId ? ' is-selected' : ''}` },
        h(
          'button',
          {
            type: 'button',
            class: 'mail__btn',
            'aria-label': `${m.read ? '' : 'Unread. '}${m.name}, ${fmtDateTime(m.createdAt)}. ${snippet}`,
            onclick: () => selectMessage(m.id)
          },
          avatar(m.name),
          h(
            'span',
            { class: 'mail__main' },
            h('span', { class: 'mail__top' }, h('span', { class: 'mail__name', text: m.name }), h('span', { class: 'mail__time', text: fmtShort(m.createdAt) })),
            h('span', { class: 'mail__snip', text: snippet }),
            h(
              'span',
              { class: 'mail__tags' },
              m.read ? null : h('span', { class: 'dot', title: 'Unread' }),
              m.topic ? h('span', { class: 'chip chip--topic', text: m.topic }) : null,
              m.starred ? h('span', { class: 'star-on', title: 'Starred' }, icon('star')) : null
            )
          )
        )
      );
    })
  );
}

function clearDetail() {
  S.selectedId = null;
  S.confirmDelete = false;
  $('#mail').classList.remove('is-reading');
  $('#mail-detail').replaceChildren(h('div', { class: 'placeholder' }, icon('inbox'), h('p', { text: 'Select a message to read it.' })));
}

async function selectMessage(id) {
  const m = S.messages.find((x) => x.id === id);
  if (!m) return;
  S.selectedId = id;
  S.confirmDelete = false;
  $('#mail').classList.add('is-reading');
  renderDetail(m);
  renderList();
  if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo(0, $('#mail').offsetTop - 80);
  if (!m.read) await updateMessage(m, { read: true }, { quiet: true });
}

async function updateMessage(m, patch, { quiet = false } = {}) {
  const before = { read: m.read, starred: m.starred };
  Object.assign(m, patch);
  renderList();
  if (S.selectedId === m.id) renderDetail(m);
  try {
    const d = await api(`/api/admin/messages/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: patch });
    S.counts = d.counts;
    renderCounts();
    if (!quiet) {
      toast(patch.starred === true ? 'Starred.' : patch.starred === false ? 'Removed star.' : patch.read === false ? 'Marked as unread.' : 'Updated.', 'ok');
      if (S.filter !== 'all') loadMessages();
    }
  } catch (err) {
    Object.assign(m, before);
    renderList();
    if (S.selectedId === m.id) renderDetail(m);
    if (err.status !== 401) toast(err.message, 'err');
  }
}

function replyLink(m) {
  const subject = `Re: ${m.topic || 'your message'} | Cheerwin Chandra`;
  const quoted = m.message.slice(0, 1200).split('\n').map((l) => `> ${l}`).join('\n');
  const body = `Hi ${m.name.split(' ')[0]},\n\n\n\n---\nOn ${fmtDateTime(m.createdAt)}, ${m.name} wrote:\n${quoted}`;
  return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderDetail(m) {
  const detail = $('#mail-detail');
  const actions = S.confirmDelete
    ? h(
        'div',
        { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm delete' },
        h('p', { text: `Delete the message from ${m.name}? This can’t be undone.` }),
        h('button', { type: 'button', class: 'btn btn--danger', onclick: () => deleteMessage(m) }, 'Delete'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { S.confirmDelete = false; renderDetail(m); } }, 'Cancel')
      )
    : h(
        'div',
        { class: 'msg__actions' },
        h('a', { class: 'btn', href: replyLink(m) }, icon('mail'), 'Reply by email'),
        h('button', { type: 'button', class: 'tbtn', onclick: () => updateMessage(m, { starred: !m.starred }), 'aria-pressed': String(m.starred) }, icon('star'), m.starred ? 'Unstar' : 'Star'),
        h('button', { type: 'button', class: 'tbtn', onclick: () => updateMessage(m, { read: false }) , disabled: !m.read }, icon('unread'), 'Mark as unread'),
        h('button', { type: 'button', class: 'tbtn', onclick: () => { S.confirmDelete = true; renderDetail(m); $('.confirm .btn--ghost')?.focus(); } }, icon('trash'), 'Delete')
      );
  detail.replaceChildren(
    h(
      'div',
      { class: 'msg' },
      h('button', { type: 'button', class: 'tbtn msg__back', onclick: () => { $('#mail').classList.remove('is-reading'); } }, icon('back'), 'Back to inbox'),
      h(
        'div',
        { class: 'msg__head' },
        avatar(m.name),
        h(
          'div',
          null,
          h('h2', { class: 'msg__name', text: m.name }),
          h(
            'div',
            { class: 'msg__email' },
            h('a', { href: `mailto:${encodeURIComponent(m.email)}`, text: m.email }),
            h('button', {
              type: 'button',
              class: 'iconbtn',
              'aria-label': 'Copy email address',
              title: 'Copy email address',
              onclick: async () => toast((await copyText(m.email)) ? 'Email address copied.' : 'Couldn’t copy. Select the address and copy it.', 'ok')
            }, icon('copy'))
          )
        )
      ),
      h(
        'p',
        { class: 'msg__meta' },
        h('span', { text: fmtDateTime(m.createdAt) }),
        h('span', { text: countryName(m.country) }),
        m.topic ? h('span', { class: 'chip chip--topic', text: m.topic }) : null
      ),
      h('div', { class: 'msg__body', text: m.message }),
      actions
    )
  );
}

async function deleteMessage(m) {
  const idx = S.messages.findIndex((x) => x.id === m.id);
  try {
    const d = await api(`/api/admin/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    S.counts = d.counts;
    S.messages = S.messages.filter((x) => x.id !== m.id);
    renderCounts();
    toast('Message deleted.', 'ok');
    const next = S.messages[idx] || S.messages[idx - 1];
    S.confirmDelete = false;
    if (next && !window.matchMedia('(max-width: 760px)').matches) {
      S.selectedId = next.id;
      renderDetail(next);
      if (!next.read) updateMessage(next, { read: true }, { quiet: true });
    } else {
      clearDetail();
    }
    renderList();
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
  }
}

function bindInbox() {
  for (const btn of $$('[data-filter]')) {
    btn.addEventListener('click', () => {
      S.filter = btn.getAttribute('data-filter');
      for (const b of $$('[data-filter]')) {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      loadMessages();
    });
  }
  let t = 0;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      S.q = e.target.value.trim().slice(0, 100);
      loadMessages();
    }, 300);
  });
  $('#refresh').addEventListener('click', () => loadMessages());
  $('#mark-all').addEventListener('click', async () => {
    try {
      const d = await api('/api/admin/messages/read-all', { method: 'POST', body: {} });
      S.counts = d.counts;
      S.messages.forEach((m) => {
        m.read = true;
      });
      renderCounts();
      renderList();
      toast('All messages marked as read.', 'ok');
      if (S.filter === 'unread') loadMessages();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    }
  });
  $('#export').addEventListener('click', (e) => {
    if (!S.counts.all) {
      e.preventDefault();
      toast('There are no messages to export yet.');
    }
  });
}

// ------------------------------------------------------------------ settings (projects + profile)

async function loadSettings() {
  try {
    const d = await api('/api/admin/settings');
    S.settingsLoaded = true;
    S.repos = d.repos || [];
    S.github = d.github;
    S.projectsSaved = clone(d.projects);
    S.projectsDraft = clone(d.projects);
    S.contentSaved = clone(d.content);
    renderProjects();
    renderProfile(d.content);
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
  }
}

const projectsDirty = () => Boolean(S.projectsDraft && S.projectsSaved && !same(S.projectsDraft, S.projectsSaved));

function repoState(name) {
  const d = S.projectsDraft;
  const lower = name.toLowerCase();
  if (d.pinned.some((p) => p.toLowerCase() === lower)) return 'pinned';
  if (d.hidden.some((p) => p.toLowerCase() === lower)) return 'hidden';
  return 'shown';
}

function setRepoState(name, state) {
  const d = S.projectsDraft;
  const lower = name.toLowerCase();
  d.pinned = d.pinned.filter((p) => p.toLowerCase() !== lower);
  d.hidden = d.hidden.filter((p) => p.toLowerCase() !== lower);
  if (state === 'pinned') {
    if (d.pinned.length >= 12) {
      toast('You can pin up to 12 projects.', 'err');
      return;
    }
    d.pinned.push(name);
  }
  if (state === 'hidden') d.hidden.push(name);
  renderProjects();
}

function movePin(name, dir) {
  const d = S.projectsDraft;
  const i = d.pinned.findIndex((p) => p.toLowerCase() === name.toLowerCase());
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.pinned.length) return;
  [d.pinned[i], d.pinned[j]] = [d.pinned[j], d.pinned[i]];
  renderProjects();
  $(`[data-move="${CSS.escape(name)}:${dir}"]`)?.focus();
}

function overrideOf(name) {
  const o = S.projectsDraft.overrides;
  const key = Object.keys(o).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? o[key] : null;
}

function setOverride(name, field, value) {
  const o = S.projectsDraft.overrides;
  const key = Object.keys(o).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
  const cur = { title: '', tagline: '', category: '', description: '', demo: '', cover: 'auto', ...(o[key] || {}) };
  cur[field] = value;
  if (!cur.title && !cur.tagline && !cur.category && !cur.description && !cur.demo && cur.cover === 'auto') delete o[key];
  else o[key] = cur;
  renderOrder();
  renderSavebar('projects');
}

function renderOrder() {
  const el = $('#order-preview');
  if (!el) return;
  const list = composeProjects(S.repos, S.projectsDraft);
  if (!list.length) {
    el.textContent = 'No projects will show. Pin or show at least one repository.';
    return;
  }
  const first = list.slice(0, 4);
  el.replaceChildren(
    'On your site: ',
    ...first.flatMap((p, i) => [h('b', { text: `${i + 1}. ${p.title}` }), i < first.length - 1 ? ' · ' : '']),
    list.length > 4 ? ` · +${list.length - 4} more behind “View all”` : ''
  );
}

function renderProjects() {
  if (!S.projectsDraft) return;
  const status = $('#gh-status');
  const g = S.github || {};
  status.textContent =
    g.source === 'snapshot'
      ? 'GitHub hasn’t been reached yet, so a saved copy is shown.'
      : g.fetchedAt
        ? `Last synced with GitHub ${ago(Date.parse(g.fetchedAt))}.`
        : '';
  renderOrder();
  const list = $('#repo-list');
  if (!S.repos.length) {
    list.replaceChildren(h('li', { class: 'empty-card', text: 'No repositories found on GitHub yet. Press “Sync with GitHub now” after you create one.' }));
    renderSavebar('projects');
    return;
  }
  const pinned = S.projectsDraft.pinned.map((p) => p.toLowerCase());
  const order = (r) => {
    const st = repoState(r.name);
    if (st === 'pinned') return pinned.indexOf(r.name.toLowerCase());
    if (r.fork) return 3000;
    return st === 'hidden' ? 2000 : 1000;
  };
  const repos = [...S.repos].sort((a, b) => order(a) - order(b) || (Date.parse(b.pushedAt) || 0) - (Date.parse(a.pushedAt) || 0));
  list.replaceChildren(...repos.map((r) => repoRow(r, pinned)));
  renderSavebar('projects');
}

function repoRow(r, pinned) {
  const st = r.fork ? 'fork' : repoState(r.name);
  const o = overrideOf(r.name) || {};
  const open = S.expanded.has(r.name);
  const editId = `edit-${r.name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const pinIndex = pinned.indexOf(r.name.toLowerCase());
  const visBtn = (state, label) =>
    h('button', { type: 'button', 'aria-pressed': String(st === state), onclick: () => setRepoState(r.name, state) }, label);
  const ctrl = r.fork
    ? h('span', { class: 'chip', title: 'Forks are never shown on your site' }, 'Fork · not shown')
    : h(
        'div',
        { class: 'repo__ctrl' },
        h('div', { class: 'vis', role: 'group', 'aria-label': `Visibility of ${r.name}` }, visBtn('pinned', 'Pin'), visBtn('shown', 'Show'), visBtn('hidden', 'Hide')),
        st === 'pinned'
          ? [
              h('button', { type: 'button', class: 'iconbtn', 'aria-label': `Move ${r.name} up`, disabled: pinIndex === 0, dataset: { move: `${r.name}:-1` }, onclick: () => movePin(r.name, -1) }, icon('up')),
              h('button', { type: 'button', class: 'iconbtn', 'aria-label': `Move ${r.name} down`, disabled: pinIndex === pinned.length - 1, dataset: { move: `${r.name}:1` }, onclick: () => movePin(r.name, 1) }, icon('down'))
            ]
          : null,
        h('button', {
          type: 'button',
          class: 'tbtn',
          'aria-expanded': String(open),
          'aria-controls': editId,
          onclick: () => {
            if (S.expanded.has(r.name)) S.expanded.delete(r.name);
            else S.expanded.add(r.name);
            renderProjects();
            $(`#${CSS.escape(editId)} input`)?.focus();
          }
        }, open ? 'Close' : 'Edit card')
      );
  const field = (key, label, max, placeholder, wide = false, type = 'text') => {
    const id = `${editId}-${key}`;
    const input = h(key === 'description' ? 'textarea' : 'input', {
      id,
      type: key === 'description' ? null : type,
      maxlength: max,
      placeholder,
      value: o[key] || '',
      rows: key === 'description' ? 3 : null,
      oninput: (e) => setOverride(r.name, key, e.target.value)
    });
    return h('div', { class: `field${wide ? ' field--wide' : ''}` }, h('label', { for: id, text: label }), input);
  };
  const coverId = `${editId}-cover`;
  const edit = open
    ? h(
        'div',
        { class: 'repo__edit', id: editId },
        field('title', 'Card title', 40, prettifyName(r.name)),
        field('tagline', 'Headline on the cover', 60, r.description ? r.description.slice(0, 60) : 'Short headline'),
        field('category', 'Category', 40, r.language || 'Project'),
        field('demo', 'Live demo link', 300, r.homepage || 'https://…', false, 'url'),
        field('description', 'Description', 320, r.description || 'What it does, in one or two sentences', true),
        h(
          'div',
          { class: 'field' },
          h('label', { for: coverId, text: 'Cover illustration' }),
          h(
            'select',
            { id: coverId, onchange: (e) => setOverride(r.name, 'cover', e.target.value) },
            COVER_STYLES.map((c) => h('option', { value: c, selected: (o.cover || 'auto') === c ? true : null }, { auto: 'Automatic', eduguard: 'Fairness chart', pulse: 'Pulse line', terrain: '3D terrain' }[c]))
          )
        ),
        h('p', { class: 'hint field--wide', text: 'Leave a field empty to use the value from GitHub.' })
      )
    : null;
  const meta = [r.language, r.pushedAt ? `updated ${ago(Date.parse(r.pushedAt))}` : '', r.homepage ? hostOf(r.homepage) : ''].filter(Boolean).join(' · ');
  return h(
    'li',
    { class: `repo${st === 'hidden' || st === 'fork' ? ' is-hidden' : ''}${st === 'pinned' ? ' is-pinned' : ''}` },
    h(
      'div',
      { class: 'repo__row' },
      h(
        'div',
        null,
        h('p', { class: 'repo__name' }, st === 'pinned' ? h('span', { class: 'chip chip--topic', text: `#${pinIndex + 1}` }) : null, h('span', { text: o.title || r.name }), o.title ? h('span', { class: 'repo__meta', text: `(${r.name})` }) : null, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${r.name} on GitHub`, title: 'Open on GitHub' }, icon('ext')) : null),
        h('p', { class: 'repo__desc', text: o.description || r.description || 'No description on GitHub.' }),
        h('p', { class: 'repo__meta', text: meta })
      ),
      ctrl
    ),
    edit
  );
}

function renderSavebar(which) {
  const host = which === 'projects' ? $('[data-panel="projects"]') : $('#profile-form');
  if (!host) return;
  let bar = host.querySelector(':scope > .savebar');
  const dirty = which === 'projects' ? projectsDirty() : profileDirty();
  if (!dirty) {
    bar?.remove();
    return;
  }
  if (bar) return;
  const saveBtn = h('button', { type: which === 'profile' ? 'submit' : 'button', class: 'btn' }, h('span', { text: 'Save changes' }), h('span', { class: 'spinner', 'aria-hidden': 'true' }));
  if (which === 'projects') saveBtn.addEventListener('click', () => saveProjects(saveBtn));
  bar = h(
    'div',
    { class: 'savebar', role: 'region', 'aria-label': 'Unsaved changes' },
    h('p', { text: 'You have unsaved changes.' }),
    h('div', null, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => (which === 'projects' ? discardProjects() : discardProfile()) }, 'Discard'), saveBtn)
  );
  host.append(bar);
}

async function saveProjects(btn) {
  setLoading(btn, true);
  try {
    const d = await api('/api/admin/projects', { method: 'PUT', body: { projects: S.projectsDraft } });
    S.projectsSaved = clone(d.projects);
    S.projectsDraft = clone(d.projects);
    toast('Saved. Your site shows the new projects now.', 'ok');
    renderProjects();
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
  } finally {
    setLoading(btn, false);
  }
}

function discardProjects() {
  S.projectsDraft = clone(S.projectsSaved);
  renderProjects();
  toast('Changes discarded.');
}

function bindProjects() {
  $('#gh-sync').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.classList.add('is-spinning');
    try {
      const d = await api('/api/admin/github/refresh', { method: 'POST', body: {} });
      S.repos = d.repos;
      S.github = d.github;
      renderProjects();
      toast(`Synced. ${d.repos.length} repositories found on GitHub.`, 'ok');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-spinning');
    }
  });
}

// ------------------------------------------------------------------ profile form

const LIMITS = {
  name: 60, role: 60, availabilityText: 60, heroTags: 40, heroLine: 40, quote: 140, bio: 400, aboutParagraphs: 1800, aboutPoints: 300,
  location: 60, publicEmail: 254, phone: 24, linkedin: 300, github: 300, collaborateText: 240, closingLine: 60, badgeText: 40,
  itemTitle: 30, itemText: 140, toolName: 24, toolAbbr: 4
};

function counted(input, max) {
  const count = h('span', { class: 'count', 'aria-hidden': 'true' });
  const update = () => {
    const n = Array.from(input.value).length;
    count.textContent = `${n}/${max}`;
    count.classList.toggle('is-over', n > max);
  };
  input.addEventListener('input', update);
  update();
  return count;
}

function textField(key, label, value, { max, multiline = false, type = 'text', hint = '', placeholder = '', rows = 3, autocomplete = 'off' } = {}) {
  const id = `pf-${key}`;
  const input = multiline
    ? h('textarea', { id, name: key, rows, maxlength: max, placeholder, value: value || '' })
    : h('input', { id, name: key, type, maxlength: max, placeholder, value: value || '', autocomplete, spellcheck: type === 'text' ? null : 'false' });
  return h(
    'div',
    { class: 'field', dataset: { key } },
    h('label', { for: id, text: label }),
    input,
    max ? counted(input, max) : null,
    hint ? h('p', { class: 'hint', text: hint }) : null,
    h('p', { class: 'err', dataset: { err: key } })
  );
}

function itemEditor(key, items, { min, max, fields }) {
  const wrap = h('div', { class: 'items', dataset: { items: key } });
  const draw = () => {
    const rows = $$(':scope > .item', wrap).map((row) => readItem(row, fields));
    wrap.replaceChildren(...rows.map((it, i) => itemRow(it, i, rows.length)), addBtn(rows.length));
    renderSavebar('profile');
  };
  const itemRow = (it, i, total) => {
    const inputs = fields.map((f) =>
      h(
        'div',
        { class: 'field' },
        h('label', { for: `pf-${key}-${i}-${f.key}`, text: `${f.label} ${i + 1}` }),
        h(f.multiline ? 'textarea' : 'input', { id: `pf-${key}-${i}-${f.key}`, value: it[f.key] || '', maxlength: f.max, rows: f.multiline ? 2 : null, dataset: { f: f.key }, placeholder: f.placeholder || '' })
      )
    );
    return h(
      'div',
      { class: 'item' },
      h('div', { class: `item__fields${key === 'tools' ? ' item__fields--tool' : ''}` }, inputs),
      h(
        'div',
        { class: 'item__tools' },
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': `Move item ${i + 1} up`, disabled: i === 0, onclick: (e) => move(e, -1) }, icon('up')),
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': `Move item ${i + 1} down`, disabled: i === total - 1, onclick: (e) => move(e, 1) }, icon('down')),
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': `Remove item ${i + 1}`, disabled: total <= min, onclick: (e) => { e.currentTarget.closest('.item').remove(); draw(); } }, icon('x'))
      )
    );
  };
  const move = (e, dir) => {
    const row = e.currentTarget.closest('.item');
    const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sib || !sib.classList.contains('item')) return;
    if (dir < 0) sib.before(row);
    else sib.after(row);
    draw();
  };
  const addBtn = (n) =>
    n < max
      ? h('button', { type: 'button', class: 'tbtn addbtn', onclick: () => { wrap.insertBefore(itemRow(Object.fromEntries(fields.map((f) => [f.key, ''])), n, n + 1), wrap.lastElementChild); draw(); $$('.item', wrap).at(-1)?.querySelector('input')?.focus(); } }, icon('plus'), 'Add')
      : h('p', { class: 'hint', text: `Up to ${max} items.` });
  wrap.append(...items.map((it, i) => itemRow(it, i, items.length)), addBtn(items.length));
  return wrap;
}

function readItem(row, fields) {
  const out = {};
  for (const f of fields) out[f.key] = row.querySelector(`[data-f="${f.key}"]`).value;
  return out;
}

const ITEM_FIELDS = [
  { key: 'title', label: 'Title', max: LIMITS.itemTitle },
  { key: 'text', label: 'Text', max: LIMITS.itemText, multiline: true }
];
const TOOL_FIELDS = [
  { key: 'name', label: 'Tool', max: LIMITS.toolName, placeholder: 'Python' },
  { key: 'abbr', label: 'Short mark', max: LIMITS.toolAbbr, placeholder: 'Py' }
];

function fieldset(title, hint, ...kids) {
  return h('fieldset', { class: 'fs' }, h('legend', { text: title }), hint ? h('p', { class: 'fs__hint', text: hint }) : null, kids);
}

function renderProfile(c) {
  const form = $('#profile-form');
  const lines = [...c.heroLines, '', '', ''].slice(0, 3);
  form.replaceChildren(
    fieldset(
      'Availability',
      'The badge at the top of your site.',
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', id: 'pf-available', name: 'available', checked: c.available }), h('span', { text: 'Show me as available for work' })),
      textField('availabilityText', 'Badge text', c.availabilityText, { max: LIMITS.availabilityText, placeholder: 'Open to internships & freelance' })
    ),
    fieldset(
      'Introduction',
      '',
      h('div', { class: 'grid2' }, textField('name', 'Your name', c.name, { max: LIMITS.name, autocomplete: 'name' }), textField('role', 'Role', c.role, { max: LIMITS.role })),
      h('div', { class: 'grid2' }, textField('heroTags', 'Big headline (left)', c.heroTags, { max: LIMITS.heroTags, hint: 'Example: AI / WEB / APPS' }), textField('badgeText', 'Spinning badge text', c.badgeText, { max: LIMITS.badgeText, hint: 'Shown twice around the circle.' })),
      h('div', { class: 'grid3', dataset: { key: 'heroLines' } }, lines.map((l, i) => textField(`heroLine${i}`, `Small line ${i + 1}`, l, { max: LIMITS.heroLine }))),
      h('p', { class: 'err', dataset: { err: 'heroLines' } }),
      textField('quote', 'Quote', c.quote, { max: LIMITS.quote }),
      textField('bio', 'Short bio (right of your photo)', c.bio, { max: LIMITS.bio, multiline: true })
    ),
    fieldset(
      'About me',
      '',
      textField('aboutParagraphs', 'Paragraphs', c.aboutParagraphs.join('\n\n'), { max: LIMITS.aboutParagraphs, multiline: true, rows: 7, hint: 'Leave an empty line between paragraphs (up to 3, each up to 600 characters).' }),
      textField('aboutPoints', 'Highlights', c.aboutPoints.join('\n'), { max: LIMITS.aboutPoints, multiline: true, rows: 4, hint: 'One per line (up to 6, each up to 40 characters).' })
    ),
    fieldset('What I do', 'The service cards (1 to 6).', itemEditor('services', c.services, { min: 1, max: 6, fields: ITEM_FIELDS }), h('p', { class: 'err', dataset: { err: 'services' } })),
    fieldset('My process', 'The numbered steps (1 to 6).', itemEditor('process', c.process, { min: 1, max: 6, fields: ITEM_FIELDS }), h('p', { class: 'err', dataset: { err: 'process' } })),
    fieldset('Tools I use', 'A name and a short mark of up to 4 characters, such as Py for Python.', itemEditor('tools', c.tools, { min: 0, max: 12, fields: TOOL_FIELDS }), h('p', { class: 'err', dataset: { err: 'tools' } })),
    fieldset(
      'Contact',
      'Email and phone are shown on your site only if you fill them in.',
      h('div', { class: 'grid2' }, textField('location', 'Location', c.location, { max: LIMITS.location }), textField('publicEmail', 'Public email (optional)', c.publicEmail, { max: LIMITS.publicEmail, type: 'email', autocomplete: 'email' })),
      h('div', { class: 'grid2' }, textField('phone', 'Phone (optional)', c.phone, { max: LIMITS.phone, type: 'tel', autocomplete: 'tel' }), textField('linkedin', 'LinkedIn link', c.linkedin, { max: LIMITS.linkedin, type: 'url' })),
      h('div', { class: 'grid2' }, textField('github', 'GitHub link', c.github, { max: LIMITS.github, type: 'url', hint: 'Projects always come from the GITHUB_USERNAME account (cheerwinchandra-dev unless you change it in Netlify).' }), textField('closingLine', 'Closing line', c.closingLine, { max: LIMITS.closingLine })),
      textField('collaborateText', 'Contact intro', c.collaborateText, { max: LIMITS.collaborateText, multiline: true, rows: 2 })
    ),
    h(
      'div',
      { class: 'card__row' },
      h('div', { id: 'reset-zone' }, h('button', { type: 'button', class: 'tbtn', onclick: askReset }, 'Reset to the original text')),
      h('button', { type: 'submit', class: 'btn', id: 'profile-save' }, h('span', { text: 'Save changes' }), h('span', { class: 'spinner', 'aria-hidden': 'true' }))
    )
  );
  S.contentBaseline = collectProfile();
  renderSavebar('profile');
}

function askReset() {
  const zone = $('#reset-zone');
  zone.replaceChildren(
    h('div', { class: 'confirm' }, h('p', { text: 'Replace all your text with the original version?' }), h('button', { type: 'button', class: 'btn btn--danger', onclick: resetProfile }, 'Reset'), h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => renderProfile(collectProfile()) }, 'Cancel'))
  );
  zone.querySelector('.btn--ghost').focus();
}

async function resetProfile() {
  try {
    const d = await api('/api/admin/content/reset', { method: 'POST', body: {} });
    S.contentSaved = clone(d.content);
    renderProfile(d.content);
    toast('Your text is back to the original version.', 'ok');
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
  }
}

function collectProfile() {
  const form = $('#profile-form');
  const val = (k) => (form.querySelector(`[name="${k}"]`)?.value ?? '');
  const items = (key, fields) => $$(`[data-items="${key}"] > .item`, form).map((row) => readItem(row, fields));
  return {
    name: val('name').trim(),
    role: val('role').trim(),
    available: $('#pf-available').checked,
    availabilityText: val('availabilityText').trim(),
    heroTags: val('heroTags').trim(),
    heroLines: [0, 1, 2].map((i) => val(`heroLine${i}`).trim()).filter(Boolean),
    quote: val('quote').trim(),
    bio: val('bio').trim(),
    aboutParagraphs: val('aboutParagraphs').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    aboutPoints: val('aboutPoints').split('\n').map((p) => p.trim()).filter(Boolean),
    location: val('location').trim(),
    publicEmail: val('publicEmail').trim(),
    phone: val('phone').trim(),
    linkedin: val('linkedin').trim(),
    github: val('github').trim(),
    services: items('services', ITEM_FIELDS).map((i) => ({ title: i.title.trim(), text: i.text.trim() })).filter((i) => i.title || i.text),
    process: items('process', ITEM_FIELDS).map((i) => ({ title: i.title.trim(), text: i.text.trim() })).filter((i) => i.title || i.text),
    tools: items('tools', TOOL_FIELDS).map((i) => ({ name: i.name.trim(), abbr: i.abbr.trim() })).filter((i) => i.name || i.abbr),
    collaborateText: val('collaborateText').trim(),
    closingLine: val('closingLine').trim(),
    badgeText: val('badgeText').trim()
  };
}

// Dirty = the form differs from what it showed right after the last load or save.
const profileDirty = () => Boolean(S.contentBaseline && $('#profile-form')?.childElementCount && !same(collectProfile(), S.contentBaseline));

function discardProfile() {
  renderProfile(S.contentSaved);
  toast('Changes discarded.');
}

function showProfileErrors(fields) {
  const form = $('#profile-form');
  $$('.err', form).forEach((e) => {
    e.textContent = '';
  });
  $$('.field.has-error', form).forEach((f) => f.classList.remove('has-error'));
  let first = null;
  for (const [key, text] of Object.entries(fields || {})) {
    const err = form.querySelector(`[data-err="${key}"]`);
    if (err) {
      err.textContent = text;
      err.closest('.field')?.classList.add('has-error');
      first = first || err.closest('.field, .fs');
    }
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  first?.querySelector('input, textarea')?.focus({ preventScroll: true });
}

function bindProfile() {
  const form = $('#profile-form');
  form.addEventListener('input', () => renderSavebar('profile'));
  form.addEventListener('change', () => renderSavebar('profile'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = collectProfile();
    const btn = e.submitter && e.submitter.classList.contains('btn') ? e.submitter : $('#profile-save');
    // Friendly checks before sending (the server checks everything again).
    const local = {};
    if (content.aboutParagraphs.length > 3) local.aboutParagraphs = 'Use at most 3 paragraphs.';
    if (content.aboutParagraphs.some((p) => p.length > 600)) local.aboutParagraphs = 'Each paragraph can be at most 600 characters.';
    if (content.aboutPoints.length > 6) local.aboutPoints = 'Use at most 6 highlights.';
    if (content.aboutPoints.some((p) => p.length > 40)) local.aboutPoints = 'Each highlight can be at most 40 characters.';
    if (!content.heroLines.length) local.heroLines = 'Add at least one small line.';
    if (Object.keys(local).length) {
      showProfileErrors(local);
      toast('Some fields need fixing.', 'err');
      return;
    }
    setLoading(btn, true);
    try {
      const d = await api('/api/admin/content', { method: 'PUT', body: { content } });
      S.contentSaved = clone(d.content);
      renderProfile(d.content);
      toast('Saved. Your site is updated.', 'ok');
    } catch (err) {
      if (err.status === 400) {
        showProfileErrors(err.data.fields);
        toast(err.message, 'err');
      } else if (err.status !== 401) toast(err.message, 'err');
    } finally {
      setLoading(btn, false);
    }
  });
}

// ------------------------------------------------------------------ security

const EVENTS = {
  login: ['Signed in', 'ok'],
  login_failed: ['Wrong username or password', 'bad'],
  locked: ['Locked after too many tries', 'bad'],
  blocked: ['Tried while locked', 'warn'],
  logout: ['Signed out', ''],
  password_changed: ['Password changed', 'ok'],
  password_change_failed: ['Wrong current password', 'bad'],
  sessions_revoked: ['Other devices signed out', '']
};

async function loadSecurity() {
  try {
    const d = await api('/api/admin/security');
    S.username = d.username;
    $('#pw-source').textContent =
      d.passwordSource === 'dashboard'
        ? 'You set this password here in the dashboard. Forgot it? Put a new ADMIN_PASSWORD_HASH in Netlify and redeploy.'
        : 'This is the password from your ADMIN_PASSWORD_HASH setting in Netlify. Changing it here replaces it.';
    $('#sessions').replaceChildren(
      ...d.sessions.map((s) =>
        h(
          'li',
          { class: 'session' },
          h('div', null, h('strong', { text: device(s.userAgent) }), h('p', { text: `${countryName(s.country)} · ${s.ip} · signed in ${fmtDateTime(s.createdAt)} · active ${ago(s.lastSeen)}` })),
          s.current ? h('span', { class: 'tag', text: 'This device' }) : null
        )
      )
    );
    $('#revoke-others').disabled = d.sessions.filter((s) => !s.current).length === 0;
    $('#events').replaceChildren(
      ...(d.events.length
        ? d.events.map((e) => {
            const [label, kind] = EVENTS[e.kind] || [e.kind, ''];
            return h('tr', null, h('td', { text: fmtDateTime(e.at) }), h('td', null, h('span', { class: `ev${kind ? ' ev--' + kind : ''}`, text: label })), h('td', { text: device(e.userAgent) }), h('td', { text: `${countryName(e.country)} · ${e.ip}` }));
          })
        : [h('tr', null, h('td', { colspan: '4', text: 'No activity yet.' }))])
    );
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
  }
}

function strength(pw) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

function bindSecurity() {
  const form = $('#pw-form');
  const meter = $('#pw-meter');
  const err = (k, t) => {
    const el = form.querySelector(`[data-err="${k}"]`);
    el.textContent = t || '';
    el.closest('.field').classList.toggle('has-error', Boolean(t));
  };
  $('#pw-new').addEventListener('input', (e) => {
    const s = e.target.value ? strength(e.target.value) : 0;
    meter.style.width = `${(s / 4) * 100}%`;
    meter.style.background = ['var(--err)', 'var(--err)', 'var(--warn)', 'var(--ok)', 'var(--ok)'][s];
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = $('#pw-current').value;
    const next = $('#pw-new').value;
    const confirm = $('#pw-confirm').value;
    ['currentPassword', 'newPassword', 'confirm'].forEach((k) => err(k, ''));
    let bad = false;
    if (!current) {
      err('currentPassword', 'Enter your current password.');
      bad = true;
    }
    if (next.length < 10) {
      err('newPassword', 'Use at least 10 characters.');
      bad = true;
    } else if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      err('newPassword', 'Use both letters and numbers.');
      bad = true;
    } else if (S.username && next.toLowerCase().includes(S.username.toLowerCase())) {
      err('newPassword', 'Don’t include your username in the password.');
      bad = true;
    }
    if (next !== confirm) {
      err('confirm', 'The two new passwords don’t match.');
      bad = true;
    }
    if (bad) return;
    const btn = form.querySelector('.btn');
    setLoading(btn, true);
    try {
      await api('/api/admin/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      form.reset();
      meter.style.width = '0';
      toast('Password updated. Any other signed-in devices were signed out.', 'ok');
      loadSecurity();
    } catch (ex) {
      if (ex.status === 400 && ex.data.fields) Object.entries(ex.data.fields).forEach(([k, v]) => err(k, v));
      else if (ex.status !== 401) toast(ex.message, 'err');
    } finally {
      setLoading(btn, false);
    }
  });
  $('#revoke-others').addEventListener('click', async () => {
    try {
      await api('/api/admin/sessions/revoke-others', { method: 'POST', body: {} });
      toast('Other devices were signed out.', 'ok');
      loadSecurity();
    } catch (ex) {
      if (ex.status !== 401) toast(ex.message, 'err');
    }
  });
}

// ------------------------------------------------------------------ start

async function boot() {
  bindPasswordToggles();
  bindLogin();
  bindInbox();
  bindProjects();
  bindProfile();
  bindSecurity();
  bindActivity();
  $('#logout-btn').addEventListener('click', () => logout());
  window.addEventListener('hashchange', () => {
    if (S.view === 'app') showTab(location.hash.slice(1));
  });
  try {
    const s = await api('/api/auth/session');
    if (s.authenticated) {
      enterApp(s);
      return;
    }
  } catch (err) {
    if (err.status === 503) {
      showLogin(err.message);
      return;
    }
  }
  showLogin();
}

boot();
