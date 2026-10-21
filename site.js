// Cheerwin Chandra — portfolio front end.
// Loads live content (/api/site), renders it, and runs the animations.

import Lenis from './vendor/lenis.mjs';
import { DEFAULT_CONTENT, DEFAULT_PROJECTS, GITHUB_USERNAME } from './shared/defaults.js';
import { shapeRepo, shapeProfile, buildGithubView } from './shared/projects.js';
import { REGIONS, relativeTime, formatDate, esc } from './shared/render.js';

const root = document.documentElement;
root.classList.add('site-running');
const reduceMotion = root.classList.contains('reduced');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let state = null; // { content, github }

// ---------------------------------------------------------------- data

async function fetchJson(url, ms = 4000, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: 'application/json', ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadFromGithubDirectly() {
  const base = 'https://api.github.com/users/' + encodeURIComponent(GITHUB_USERNAME);
  const [profile, repos] = await Promise.all([fetchJson(base, 5000), fetchJson(base + '/repos?per_page=100&type=owner&sort=pushed', 5000)]);
  if (!Array.isArray(repos)) throw new Error('Unexpected GitHub response');
  return { fetchedAt: new Date().toISOString(), profile: shapeProfile(profile, GITHUB_USERNAME), repos: repos.map(shapeRepo).filter(Boolean) };
}

async function loadData() {
  try {
    const d = await fetchJson('/api/site', 5000);
    if (d && d.ok && d.content && d.github) return { content: d.content, github: d.github };
  } catch {
    /* fall through to the browser-side fallback */
  }
  // Fallback: default content + GitHub straight from the browser, else the saved snapshot.
  let raw = null;
  let source = 'live';
  try {
    raw = await loadFromGithubDirectly();
  } catch {
    source = 'snapshot';
    try {
      raw = (await import('./shared/snapshot.js')).default;
    } catch {
      raw = { fetchedAt: '', profile: null, repos: [] };
    }
  }
  return { content: { ...DEFAULT_CONTENT }, github: { ...buildGithubView(raw, DEFAULT_PROJECTS), source, fetchedAt: raw.fetchedAt } };
}

// ---------------------------------------------------------------- render

function render(data) {
  state = data;
  const ctx = { content: data.content, github: data.github, now: Date.now() };
  for (const el of $$('[data-r]')) {
    const key = el.getAttribute('data-r');
    if (!REGIONS[key]) continue;
    const html = REGIONS[key](ctx);
    if (el.__html === html) continue;
    el.innerHTML = html;
    el.__html = html;
    hydrate(el);
  }
  const { content, github } = data;
  $('.status')?.classList.toggle('is-off', !content.available);
  for (const y of $$('[data-year]')) y.textContent = String(new Date().getFullYear());
  if (content.name && content.name !== DEFAULT_CONTENT.name) document.title = `${content.name} · Portfolio`;
  updateSync(github);
  updateQrs(content);
  staggerChildren();
  window.dispatchEvent(new Event('cw:rendered'));
}

function updateSync(github) {
  const el = $('[data-sync]');
  if (!el) return;
  if (github.source === 'snapshot') {
    el.textContent = github.fetchedAt ? `Saved copy · ${formatDate(github.fetchedAt)}` : 'Saved copy';
  } else if (github.fetchedAt) {
    el.textContent = `Synced ${relativeTime(github.fetchedAt, Date.now())}`;
  } else {
    el.textContent = '';
  }
}

const QR_DEFAULTS = { linkedin: DEFAULT_CONTENT.linkedin, github: DEFAULT_CONTENT.github };

async function updateQrs(content) {
  for (const key of ['linkedin', 'github']) {
    const link = $(`[data-qr="${key}"]`);
    if (!link) continue;
    const url = content[key];
    link.hidden = !url;
    if (!url) continue;
    link.href = url;
    if (url === QR_DEFAULTS[key] || link.dataset.qrFor === url) continue;
    try {
      const { default: qrcode } = await import('./vendor/qrcode.mjs');
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 1} ${r + 1}h1v1h-1z`;
      const svg = `<svg viewBox="0 0 ${n + 2} ${n + 2}" role="img" aria-label="QR code for ${esc(key === 'linkedin' ? 'LinkedIn' : 'GitHub')}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#efe3cf"/><path d="${d}" fill="#160c0c"/></svg>`;
      const old = link.querySelector('img, svg');
      old?.insertAdjacentHTML('afterend', svg);
      old?.remove();
      link.dataset.qrFor = url;
    } catch (err) {
      console.warn('QR code update failed', err);
    }
  }
}

function staggerChildren() {
  for (const group of $$('.services, .work-grid, .tools, .steps, .qrs')) {
    $$('[data-reveal]', group).forEach((el, i) => el.style.setProperty('--d', String((i % 8) * 85)));
  }
  $$('.hero [data-anim]').forEach((el, i) => el.style.setProperty('--d', String(i * 110)));
}

// ---------------------------------------------------------------- reveal on scroll

// Slides an element in, then marks it settled so its own hover transitions take over.
function reveal(el) {
  if (el.classList.contains('is-in')) return;
  el.classList.add('is-in');
  const delay = Number(el.style.getPropertyValue('--d')) || 0;
  setTimeout(() => el.classList.add('is-settled'), reduceMotion ? 0 : delay + 1800);
}

// Elements that start fully masked (clip-path) can't be watched directly: the browser sees
// them as invisible. Their parent is watched instead and reveals them.
const MASKED = '.h-section, .closing, .about__photo';
const viaParent = new Map();

const revealer =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            revealer.unobserve(e.target);
            const kids = viaParent.get(e.target);
            if (kids) {
              viaParent.delete(e.target);
              kids.forEach(reveal);
              if (!e.target.matches('[data-reveal]')) continue;
            }
            reveal(e.target);
            if (e.target.matches('.stats')) runCounters(e.target);
          }
        },
        { rootMargin: '0px 0px -6% 0px', threshold: 0.1 }
      )
    : null;

function observeReveal(el) {
  if (!revealer || reduceMotion) {
    el.classList.add('is-in', 'is-settled');
    return;
  }
  if (el.matches(MASKED) && el.parentElement) {
    const parent = el.parentElement;
    if (!viaParent.has(parent)) viaParent.set(parent, new Set());
    viaParent.get(parent).add(el);
    revealer.observe(parent);
  } else revealer.observe(el);
}

function hydrate(scope) {
  const nodes = scope.matches?.('[data-reveal]') ? [scope] : [];
  nodes.push(...$$('[data-reveal]', scope));
  nodes.forEach(observeReveal);
  if (finePointer) {
    $$('[data-spot]', scope).forEach(bindSpotlight);
    $$('.work', scope).forEach(bindTilt);
  }
  $$('canvas[data-terrain]', scope).forEach(initTerrain);
  if (scope.matches?.('[data-r="moreProjects"]')) bindMore(scope);
  if (scope.matches?.('[data-r="stats"]') && root.classList.contains('is-ready')) runCounters(scope);
}

// ---------------------------------------------------------------- counters

function runCounters(scope) {
  for (const el of $$('[data-count]', scope)) {
    const target = Number(el.getAttribute('data-count'));
    if (!Number.isFinite(target) || target > 999 || reduceMotion || el.__counted) {
      el.textContent = el.getAttribute('data-count');
      continue;
    }
    el.__counted = true;
    const start = performance.now();
    const dur = 1500;
    const tick = (now) => {
      const p = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(2, -10 * p);
      el.textContent = String(Math.round(target * (p === 1 ? 1 : eased)));
      if (p < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------- pointer effects

function bindSpotlight(el) {
  if (el.__spot) return;
  el.__spot = true;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

function bindTilt(card) {
  if (card.__tilt) return;
  card.__tilt = true;
  const target = card.querySelector('.cover') || card;
  card.addEventListener('pointermove', (e) => {
    const r = target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    target.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
    target.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
  });
  card.addEventListener('pointerleave', () => {
    target.style.setProperty('--ry', '0deg');
    target.style.setProperty('--rx', '0deg');
  });
}

function bindMagnetic() {
  if (!finePointer || reduceMotion) return;
  for (const btn of $$('[data-magnetic]')) {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${(x * 0.18).toFixed(1)}px, ${(y * 0.3).toFixed(1)}px)`;
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.transform = '';
    });
  }
}

function bindAboutTilt() {
  const el = $('[data-tilt]');
  if (!el || !finePointer || reduceMotion) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${(-((e.clientY - r.top) / r.height - 0.5) * 8).toFixed(2)}deg`);
  });
  el.addEventListener('pointerleave', () => {
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--rx', '0deg');
  });
}

// ---------------------------------------------------------------- "view all projects"

function bindMore(scope) {
  const btn = scope.querySelector('[data-more]');
  const grid = $('#work-grid');
  if (!btn || !grid) return;
  const total = grid.querySelectorAll('.work').length;
  btn.addEventListener('click', () => {
    const open = !grid.classList.contains('is-expanded');
    grid.classList.toggle('is-expanded', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.firstChild.textContent = open ? 'Show fewer projects' : `View all ${total} projects`;
    if (open) {
      $$('.work.is-extra', grid).forEach((el, i) => {
        el.style.setProperty('--d', String(i * 90));
        el.classList.remove('is-in', 'is-settled');
        requestAnimationFrame(() => requestAnimationFrame(() => reveal(el)));
      });
    } else {
      scrollToEl($('#work'));
    }
  });
}

// ---------------------------------------------------------------- hero word fit

function fitWord() {
  const hero = $('.hero');
  const word = $('[data-word]');
  if (!hero || !word) return;
  const cs = getComputedStyle(hero);
  const avail = hero.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  word.style.fontSize = '100px';
  let measured = 0;
  for (const ch of word.children) measured += ch.getBoundingClientRect().width;
  word.style.fontSize = '';
  if (!measured || !avail) return;
  const size = clamp((100 * avail) / measured, 40, 320);
  hero.style.setProperty('--word', `${size.toFixed(2)}px`);
}

// ---------------------------------------------------------------- scroll-linked motion

let lenis = null;
let scrollY = window.scrollY;
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

// Gentle start, gentle landing: anchor jumps glide instead of snapping.
const easeInOutQuint = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);

function scrollToEl(el) {
  if (!el) return;
  if (lenis) {
    const distance = Math.abs(el.getBoundingClientRect().top);
    lenis.scrollTo(el, { offset: -72, duration: clamp(0.8 + distance / 4000, 1, 1.7), easing: easeInOutQuint });
  } else el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function bindAnchors() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    scrollToEl(target);
    const focusTarget = target.matches('main, section, [tabindex]') ? target : target.querySelector('h1, h2') || target;
    if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
    setTimeout(() => focusTarget.focus({ preventScroll: true }), reduceMotion ? 0 : 900);
  });
}

function setupMotion() {
  if (!reduceMotion) {
    try {
      // lerp: each frame moves 8% of the way to the target, so the page glides and settles softly.
      lenis = new Lenis({ lerp: 0.08, smoothWheel: true, wheelMultiplier: 0.95, touchMultiplier: 1.15 });
      lenis.on('scroll', (e) => {
        scrollY = e.scroll ?? window.scrollY;
      });
    } catch (err) {
      console.warn('Smooth scrolling unavailable', err);
      lenis = null;
    }
  }
  window.addEventListener('scroll', () => {
    if (!lenis) scrollY = window.scrollY;
  }, { passive: true });

  if (finePointer && !reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = e.clientX / window.innerWidth - 0.5;
      pointer.ty = e.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }

  const word = $('[data-word]');
  const figure = $('[data-parallax]');
  const sun = $('.hero__sun');
  const steps = $('[data-steps]');
  const dock = $('[data-dock]');
  const hero = $('.hero');
  const bar = $('[data-progress]');
  const ribbon = $('[data-ribbon]');
  const track = ribbon ? $('.ribbon__track', ribbon) : null;
  const band = { x: 0, speed: 1, dir: 1, groupW: 0, visible: true, lastY: scrollY, lastT: 0 };
  const measureBand = () => {
    const g = track ? $('.ribbon__group', track) : null;
    band.groupW = g ? g.getBoundingClientRect().width : 0;
    // Short titles: add copies until the band is always wider than the screen.
    if (g && band.groupW > 0) {
      let copies = track.children.length;
      while (copies * band.groupW < window.innerWidth + band.groupW * 2 && copies < 40) {
        track.append(g.cloneNode(true));
        copies++;
      }
    }
  };
  measureBand();
  document.fonts?.ready.then(measureBand);
  window.addEventListener('cw:rendered', measureBand);
  if (ribbon && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      band.visible = e.isIntersecting;
    }).observe(ribbon);
  }
  let progress = 0;

  let heroH = hero ? hero.offsetHeight : 800;
  let horizontal = false;
  let processSection = $('#process');
  const measure = () => {
    heroH = hero ? hero.offsetHeight : 800;
    horizontal = steps ? getComputedStyle(steps).gridTemplateColumns.split(' ').length > 1 : false;
  };
  measure();
  window.addEventListener('resize', () => {
    measure();
    measureBand();
  });
  const last = { word: '', figure: '', sun: '', progress: '', dock: null, bar: '' };

  const frame = (time) => {
    if (lenis) lenis.raf(time);
    const vh = window.innerHeight;
    const y = clamp(scrollY, 0, heroH * 1.2);

    if (!reduceMotion) {
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      const w = `translate3d(0, ${(y * 0.22).toFixed(1)}px, 0)`;
      const f = `translate3d(${(pointer.x * 14).toFixed(1)}px, ${(-y * 0.05 + pointer.y * 8).toFixed(1)}px, 0)`;
      const sn = `${(pointer.x * -22).toFixed(1)}px ${(pointer.y * -12).toFixed(1)}px`;
      if (word && w !== last.word) word.style.transform = last.word = w;
      if (figure && f !== last.figure) figure.style.transform = last.figure = f;
      if (sun && sn !== last.sun) sun.style.translate = last.sun = sn;
    }

    // The sliding band: drifts on its own, speeds up as you scroll and follows your direction.
    if (track && band.groupW && !reduceMotion) {
      const dt = band.lastT ? Math.min(time - band.lastT, 50) : 16.7;
      band.lastT = time;
      const v = lenis ? lenis.velocity : scrollY - band.lastY;
      band.lastY = scrollY;
      if (Math.abs(v) > 0.4) band.dir = v > 0 ? 1 : -1;
      const target = band.dir * (0.55 + Math.min(Math.abs(v), 70) * 0.22);
      band.speed += (target - band.speed) * 0.07;
      if (band.visible) {
        band.x = (band.x - band.speed * (dt / 16.7)) % band.groupW;
        if (band.x > 0) band.x -= band.groupW;
        const skew = clamp(-v * 0.12, -7, 7);
        track.style.transform = `translate3d(${band.x.toFixed(2)}px, 0, 0) skewX(${skew.toFixed(2)}deg)`;
      }
    }

    if (bar) {
      const max = document.documentElement.scrollHeight - vh;
      const b = max > 0 ? clamp(scrollY / max, 0, 1).toFixed(4) : '0';
      if (b !== last.bar) bar.style.transform = `scaleX(${(last.bar = b)})`;
    }

    if (steps) {
      // Progress follows the process section while it scrolls past, eased so the line glides.
      const box = (horizontal ? steps : processSection || steps).getBoundingClientRect();
      const goal = horizontal ? clamp((vh * 0.85 - box.top) / (vh * 0.5), 0, 1) : clamp((vh * 0.6 - box.top) / Math.max(box.height - vh * 0.3, 1), 0, 1);
      progress = reduceMotion ? goal : progress + (goal - progress) * 0.12;
      if (Math.abs(goal - progress) < 0.0005) progress = goal;
      const p = progress;
      const ps = p.toFixed(3);
      if (ps !== last.progress) {
        last.progress = ps;
        steps.style.setProperty('--progress', ps);
        const items = steps.children;
        for (let i = 0; i < items.length; i++) items[i].classList.toggle('is-active', p >= (i + 0.35) / items.length);
      }
    }

    if (dock) {
      const on = scrollY > heroH - 120;
      if (on !== last.dock) {
        last.dock = on;
        dock.classList.toggle('is-on', on);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Highlight the section you're in.
  if ('IntersectionObserver' in window && dock) {
    const links = $$('a[href^="#"]', dock);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          links.forEach((l) => l.classList.toggle('is-current', l.getAttribute('href') === '#' + e.target.id));
        }
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    ['work', 'process', 'about', 'contact'].forEach((id) => {
      const s = document.getElementById(id);
      if (s) io.observe(s);
    });
  }
}

// ---------------------------------------------------------------- canvases (terrain + globe)

const animated = new Set();
let canvasLoop = 0;

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeNoise(seed) {
  const rand = seeded(seed + 7);
  const size = 64;
  const grid = Array.from({ length: size * size }, rand);
  const at = (x, y) => grid[((y % size) + size) % size * size + (((x % size) + size) % size)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * xf;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  };
}

function sizeCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return { w, h, dpr };
}

function initTerrain(c) {
  if (c.__init) return;
  c.__init = true;
  const noise = makeNoise(Number(c.getAttribute('data-terrain')) || 1);
  const ctx = c.getContext('2d');
  if (!ctx) return;
  c.__draw = (t) => {
    const { w, h } = sizeCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const N = 22;
    const cx = w / 2;
    const dx = w / (N * 1.25);
    const dy = dx * 0.5;
    const top = h * 0.22;
    const amp = h * 0.36;
    const pt = (i, j) => {
      const n = noise(i * 0.22 + t * 0.12, j * 0.22 + t * 0.05) * 0.75 + noise(i * 0.5 - t * 0.1, j * 0.5) * 0.25;
      return [cx + (i - j) * dx * 0.5, top + (i + j) * dy * 0.5 + (1 - n) * amp * 0.6, n];
    };
    ctx.lineWidth = Math.max(1, w / 420);
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a <= N; a++) {
        ctx.beginPath();
        for (let b = 0; b <= N; b++) {
          const [x, y] = pass === 0 ? pt(a, b) : pt(b, a);
          if (b === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const depth = a / N;
        ctx.strokeStyle = `rgba(216, 67, 58, ${(0.25 + depth * 0.6).toFixed(3)})`;
        ctx.stroke();
      }
    }
  };
  c.__draw(0);
  watchCanvas(c);
}

function initGlobe() {
  const c = $('[data-globe]');
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  c.__draw = (t) => {
    const { w, h } = sizeCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const r = Math.min(w, h) * 0.44;
    const cx = w / 2;
    const cy = h / 2;
    const rot = t * 0.18;
    const tilt = 0.38;
    ctx.lineWidth = Math.max(1, w / 360);
    const project = (lat, lon) => {
      const x = Math.cos(lat) * Math.sin(lon + rot);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.cos(lon + rot);
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return [cx + x * r, cy - y2 * r, z2];
    };
    const line = (points) => {
      for (let i = 1; i < points.length; i++) {
        const [x1, y1, z1] = points[i - 1];
        const [x2, y2, z2] = points[i];
        const front = (z1 + z2) / 2 > 0;
        ctx.strokeStyle = front ? 'rgba(216, 67, 58, .55)' : 'rgba(216, 67, 58, .14)';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };
    for (let k = -4; k <= 4; k++) {
      const lat = (k / 5) * (Math.PI / 2);
      const pts = [];
      for (let s = 0; s <= 48; s++) pts.push(project(lat, (s / 48) * Math.PI * 2));
      line(pts);
    }
    for (let m = 0; m < 12; m++) {
      const lon = (m / 12) * Math.PI * 2;
      const pts = [];
      for (let s = 0; s <= 36; s++) pts.push(project(-Math.PI / 2 + (s / 36) * Math.PI, lon));
      line(pts);
    }
  };
  c.__draw(0);
  watchCanvas(c);
}

const canvasIO = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) animated.add(e.target);
        else animated.delete(e.target);
      }
      if (animated.size && !canvasLoop && !reduceMotion) canvasLoop = requestAnimationFrame(tickCanvases);
    })
  : null;

function watchCanvas(c) {
  if (canvasIO) canvasIO.observe(c);
}

function tickCanvases(now) {
  const t = now / 1000;
  animated.forEach((c) => {
    if (c.isConnected) c.__draw?.(t);
    else animated.delete(c);
  });
  canvasLoop = animated.size ? requestAnimationFrame(tickCanvases) : 0;
}

// ---------------------------------------------------------------- contact form

const DRAFT_KEY = 'cw-contact-draft';
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
const loadedAt = Date.now();

function setupForm() {
  const form = $('#contact-form');
  if (!form) return;
  const btn = form.querySelector('.btn');
  const label = form.querySelector('.btn__label');
  const status = form.querySelector('.form__status');
  const msg = form.elements.message;
  const count = $('#cf-count');

  const updateCount = () => {
    const n = Array.from(msg.value).length;
    count.textContent = `${n} / 4000`;
    count.classList.toggle('is-near', n > 3600);
  };

  // Restore an unsent draft (only in this browser).
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && typeof draft === 'object') {
      for (const k of ['name', 'email', 'topic', 'message']) if (typeof draft[k] === 'string' && form.elements[k]) form.elements[k].value = draft[k];
    }
  } catch {
    /* storage unavailable */
  }
  updateCount();

  let saveTimer = 0;
  form.addEventListener('input', (e) => {
    if (e.target === msg) updateCount();
    const field = e.target.closest('.field');
    if (field?.classList.contains('has-error')) setError(e.target.name, '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const d = {};
        for (const k of ['name', 'email', 'topic', 'message']) d[k] = form.elements[k].value;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch {
        /* ignore */
      }
    }, 400);
  });

  function setError(name, text) {
    const input = form.elements[name];
    if (!input) return;
    const field = input.closest('.field');
    const err = field.querySelector('.field__err');
    field.classList.toggle('has-error', Boolean(text));
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (err) err.textContent = text;
  }

  function validate(values) {
    const errors = {};
    const nameLen = Array.from(values.name).length;
    if (nameLen < 2) errors.name = 'Please enter your name.';
    else if (nameLen > 80) errors.name = 'Please keep your name under 80 characters.';
    else if (/https?:|www\.|<|>/i.test(values.name)) errors.name = 'Please enter just your name.';
    if (!values.email) errors.email = 'Please enter your email address.';
    else if (!EMAIL_RE.test(values.email)) errors.email = 'Please enter a valid email address, like name@example.com.';
    const m = Array.from(values.message).length;
    if (m < 10) errors.message = 'Please write a little more (at least 10 characters).';
    else if (m > 4000) errors.message = 'Please keep your message under 4,000 characters.';
    return errors;
  }

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.className = 'form__status' + (kind ? ' is-' + kind : '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.classList.contains('is-loading')) return;
    const values = {
      name: form.elements.name.value.replace(/\s+/g, ' ').trim(),
      email: form.elements.email.value.trim(),
      topic: form.elements.topic.value,
      message: form.elements.message.value.trim()
    };
    const errors = validate(values);
    for (const k of ['name', 'email', 'topic', 'message']) setError(k, errors[k] || '');
    const first = Object.keys(errors)[0];
    if (first) {
      setStatus('Please fix the highlighted fields.', 'err');
      form.elements[first].focus();
      return;
    }
    btn.classList.add('is-loading');
    label.textContent = 'Sending…';
    setStatus('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...values, company_site: form.elements.company_site.value, elapsedMs: Date.now() - loadedAt }),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        btn.classList.remove('is-loading');
        btn.classList.add('is-done');
        label.textContent = 'Sent';
        setStatus(`Thanks, ${values.name.split(' ')[0]}! Your message is in. I'll reply to ${values.email}.`, 'ok');
        form.reset();
        updateCount();
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          btn.classList.remove('is-done');
          label.textContent = 'Send message';
        }, 4500);
        return;
      }
      if (data.fields) for (const [k, v] of Object.entries(data.fields)) setError(k, v);
      setStatus(data.message || 'Something went wrong. Please try again.', 'err');
    } catch {
      setStatus("Couldn't send right now. Check your connection and try again. Your message is still here.", 'err');
    } finally {
      clearTimeout(timer);
      btn.classList.remove('is-loading');
      if (!btn.classList.contains('is-done')) label.textContent = 'Send message';
    }
  });
}

// ---------------------------------------------------------------- start

function startIntro() {
  $$('.ch').forEach((el, i) => el.style.setProperty('--i', String(i)));
  staggerChildren();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      root.classList.add('is-ready');
      setTimeout(() => {
        const stats = $('.stats');
        if (stats) observeReveal(stats);
      }, reduceMotion ? 0 : 1300);
    })
  );
}

async function main() {
  hydrate(document.body);
  const dataPromise = loadData();
  const fonts = document.fonts?.ready ?? Promise.resolve();
  let rendered = false;
  dataPromise.then((d) => {
    render(d);
    rendered = true;
  }).catch((err) => console.warn('Could not load site data', err));

  await Promise.race([Promise.all([dataPromise.catch(() => {}), fonts]), wait(1300)]);
  fitWord();
  startIntro();
  setupMotion();
  bindAnchors();
  bindMagnetic();
  bindAboutTilt();
  setupForm();
  initGlobe();
  if (!rendered) $$('[data-r]').forEach(hydrate);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitWord();
      animated.forEach((c) => c.__draw?.(performance.now() / 1000));
    }, 120);
  });
  fonts.then(fitWord);

  // Keep "x minutes ago" labels fresh.
  setInterval(() => {
    if (state) {
      const el = $('[data-r="activity"]');
      if (el) {
        const html = REGIONS.activity({ ...state, now: Date.now() });
        if (html !== el.__html) {
          el.innerHTML = html;
          el.__html = html;
        }
      }
      updateSync(state.github);
    }
  }, 60000);
}

main();
