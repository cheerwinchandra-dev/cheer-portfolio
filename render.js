// HTML for every part of the page that comes from data. All text is escaped.
// Used in the browser (live data) and by scripts/build-html.mjs (to bake the
// default content into index.html), so both always match.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const icon = (id, cls = '') => `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${id}"></use></svg>`;

const SERVICE_ICONS = ['network', 'ai', 'shield', 'data', 'cloud', 'spark'];
const PROCESS_ICONS = ['compass', 'data', 'network', 'chart', 'cloud', 'spark'];

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDate(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? dateFmt.format(new Date(t)) : '';
}

export function relativeTime(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  if (!now) return formatDate(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function host(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------- Project covers ----------

function chrome(url) {
  return `<div class="cover__bar" aria-hidden="true"><i></i><i></i><i></i><span class="cover__url">${esc(host(url) || 'github.com')}</span></div>`;
}

function coverText(p) {
  return `<div class="cover__text"><span class="cover__brand">${esc(p.title)}</span><span class="cover__headline">${esc(p.tagline || p.description || (p.demo ? 'Live on the web' : 'On GitHub'))}</span></div>`;
}

function coverEduguard() {
  // Grouped bars: false-positive vs false-negative rate per student group (illustration).
  const groups = [
    [62, 48],
    [40, 55],
    [52, 38]
  ];
  const bars = groups
    .map(([a, b], i) => {
      const x = 14 + i * 46;
      return `<rect class="bar bar--a" x="${x}" y="${100 - a}" width="14" height="${a}" rx="2"/><rect class="bar bar--b" x="${x + 17}" y="${100 - b}" width="14" height="${b}" rx="2"/><text x="${x + 15}" y="114" text-anchor="middle">G${i + 1}</text>`;
    })
    .join('');
  return `<svg class="cover__art cover__art--edu" viewBox="0 0 150 120" aria-hidden="true"><line class="axis" x1="6" y1="100" x2="146" y2="100"/><line class="limit" x1="6" y1="44" x2="146" y2="44"/>${bars}<g class="shield" transform="translate(118 6)"><path d="M12 1l10 3.8v7.4C22 18 17.8 22.6 12 24 6.2 22.6 2 18 2 12.2V4.8z"/><path d="M7.5 12.5l3.2 3.2 5.8-6.2"/></g></svg>`;
}

function coverPulse() {
  return `<div class="cover__art cover__art--pulse" aria-hidden="true"><svg viewBox="0 0 200 60" preserveAspectRatio="none"><path class="pulse-line pulse-line--base" d="M0 32 H52 L60 32 L66 12 L74 52 L82 6 L90 44 L96 32 H128 L134 26 L140 38 L146 32 H200"/><path class="pulse-line pulse-line--run" pathLength="420" d="M0 32 H52 L60 32 L66 12 L74 52 L82 6 L90 44 L96 32 H128 L134 26 L140 38 L146 32 H200"/></svg><ul class="tiers"><li class="tier tier--hot">Hot</li><li class="tier tier--high">High</li><li class="tier tier--warm">Warm</li><li class="tier tier--nurture">Nurture</li></ul></div>`;
}

function coverTerrain(p) {
  return `<canvas class="cover__art cover__art--terrain" data-terrain="${hash(p.name) % 1000}" width="320" height="200" aria-hidden="true"></canvas>`;
}

function coverAuto(p) {
  const h = hash(p.name);
  const letters = (p.title || p.name)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const rot = h % 360;
  return `<div class="cover__art cover__art--auto" data-rot="${rot}" aria-hidden="true"><span class="mono">${esc(letters)}</span><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="22"/></svg><span class="lang">${esc(p.language || 'Code')}</span></div>`;
}

export function renderCover(p) {
  const art = p.cover === 'eduguard' ? coverEduguard() : p.cover === 'pulse' ? coverPulse() : p.cover === 'terrain' ? coverTerrain(p) : coverAuto(p);
  return `<div class="cover cover--${esc(p.cover)}">${chrome(p.demo || p.url)}<div class="cover__body">${coverText(p)}${art}</div></div>`;
}

export function renderProject(p, index) {
  const primary = p.demo || p.url;
  const extra = index >= 4 ? ' is-extra' : '';
  const links = [
    p.demo ? `<a class="work__link" href="${esc(p.demo)}" target="_blank" rel="noopener noreferrer">Live demo${icon('arrow-up-right')}</a>` : '',
    p.url ? `<a class="work__link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Source${icon('arrow-up-right')}</a>` : ''
  ].join('');
  return `<article class="work${extra}" data-reveal data-spot>
  ${renderCover(p)}
  <div class="work__meta">
    <h3 class="work__title"><a class="work__main" href="${esc(primary)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a></h3>
    <p class="work__cat">${esc(p.category)}</p>
    ${p.description ? `<p class="work__desc">${esc(p.description)}</p>` : ''}
    <div class="work__links">${links}</div>
  </div>
</article>`;
}

// ---------- Regions ----------
// Each region is an element with data-r="<key>" whose inner HTML comes from here.

export const REGIONS = {
  availability: ({ content }) => `<i class="status__dot" aria-hidden="true"></i><span>${esc(content.available ? content.availabilityText || 'Available for work' : 'Not taking new work right now')}</span>`,
  heroTags: ({ content }) => esc(content.heroTags),
  heroLines: ({ content }) => content.heroLines.map((l) => `<li>${esc(l)}</li>`).join(''),
  quote: ({ content }) => esc(content.quote),
  signature: ({ content }) => esc(content.name.split(/\s+/)[0] || content.name),
  name: ({ content }) =>
    content.name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `<span class="name__line">${esc(w)}</span>`)
      .join(' '),
  role: ({ content }) => esc(content.role),
  bio: ({ content }) => esc(content.bio),
  stats: ({ github }) => {
    const s = github.stats;
    const items = [
      ['repo', s.publicRepos, 'Public', 'repos'],
      ['globe', s.liveDemos, 'Live', 'demos'],
      ['flag', s.since, 'Building', 'since']
    ];
    return items
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(
        ([ic, v, a, b]) =>
          `<li class="stat"><span class="stat__icon">${icon(ic)}</span><strong class="stat__value" data-count="${esc(v)}">${esc(v)}</strong><span class="stat__label">${esc(a)}<br>${esc(b)}</span></li>`
      )
      .join('');
  },
  services: ({ content }) =>
    content.services
      .map(
        (s, i) =>
          `<li class="service" data-reveal data-spot><span class="service__icon">${icon(SERVICE_ICONS[i % SERVICE_ICONS.length], 'icon--draw')}</span><h3 class="service__title">${esc(s.title)}</h3><p class="service__text">${esc(s.text)}</p></li>`
      )
      .join(''),
  process: ({ content }) =>
    content.process
      .map(
        (s, i) =>
          `<li class="step" data-reveal><span class="step__num">${String(i + 1).padStart(2, '0')}</span><span class="step__icon">${icon(PROCESS_ICONS[i % PROCESS_ICONS.length])}</span><div class="step__body"><h3 class="step__title">${esc(s.title)}</h3><p class="step__text">${esc(s.text)}</p></div></li>`
      )
      .join(''),
  projects: ({ github }) =>
    github.projects.length
      ? github.projects.map(renderProject).join('')
      : `<p class="empty">Projects will appear here as soon as they are on GitHub.</p>`,
  moreProjects: ({ github, content }) => {
    const n = github.projects.length;
    const url = github.profileUrl || content.github;
    if (n > 4) return `<button class="more" type="button" data-more aria-expanded="false" aria-controls="work-grid">View all ${n} projects${icon('arrow')}</button>`;
    return url ? `<a class="more" href="${esc(url)}?tab=repositories" target="_blank" rel="noopener noreferrer">View more on GitHub${icon('arrow')}</a>` : '';
  },
  aboutParagraphs: ({ content }) => content.aboutParagraphs.map((p) => `<p>${esc(p)}</p>`).join(''),
  aboutPoints: ({ content }) => content.aboutPoints.map((p) => `<li>${esc(p)}</li>`).join(''),
  tools: ({ content }) =>
    content.tools.map((t) => `<li class="tool" data-reveal><span class="tool__mark">${esc(t.abbr)}</span><span class="tool__name">${esc(t.name)}</span></li>`).join(''),
  activity: ({ github, now }) =>
    github.activity.length
      ? github.activity
          .map(
            (a) =>
              `<li class="feed__item"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><span class="feed__title">${esc(a.title)}</span><span class="feed__meta">${a.language ? `<span class="feed__lang">${esc(a.language)}</span>` : ''}<time datetime="${esc(a.pushedAt)}" title="${esc(formatDate(a.pushedAt))}">${esc(now ? 'Updated ' + relativeTime(a.pushedAt, now) : 'Updated ' + formatDate(a.pushedAt))}</time></span></a></li>`
          )
          .join('')
      : `<li class="feed__empty">No public activity yet.</li>`,
  githubLink: ({ github, content }) => {
    const url = github.profileUrl || content.github;
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">See everything on GitHub${icon('arrow-up-right')}</a>` : '';
  },
  collaborateText: ({ content }) => esc(content.collaborateText),
  contactList: ({ content }) => {
    const rows = [];
    if (content.publicEmail) rows.push(['mail', content.publicEmail, `mailto:${content.publicEmail}`]);
    if (content.phone) rows.push(['phone', content.phone, `tel:${content.phone.replace(/[^+0-9]/g, '')}`]);
    if (content.location) rows.push(['pin', content.location, '']);
    if (content.linkedin) rows.push(['link', 'LinkedIn', content.linkedin]);
    if (content.github) rows.push(['branch', 'GitHub', content.github]);
    return rows
      .map(([ic, label, href]) => {
        const ext = /^https:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
        const inner = `${icon(ic)}<span>${esc(label)}</span>`;
        return `<li>${href ? `<a href="${esc(href)}"${ext}>${inner}</a>` : inner}</li>`;
      })
      .join('');
  },
  closingLine: ({ content }) =>
    (content.closingLine.match(/[^.]+\.?/g) || [])
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `<span>${esc(part)}</span>`)
      .join(' '),
  footer: ({ content }) => `© <span data-year>2026</span> ${esc(content.name)}${content.location ? ' · ' + esc(content.location) : ''}`,
  badge: ({ content }) => esc((content.badgeText.trim() + ' ').repeat(2)),
  // The sliding band under the hero: your service titles, repeated so the loop is seamless.
  ribbon: ({ content }) => {
    const items = content.services
      .map((s, i) => `<span class="ribbon__item${i % 2 ? ' ribbon__item--outline' : ''}">${esc(s.title)}</span>${icon('star', 'ribbon__star')}`)
      .join('');
    return `<span class="ribbon__group">${items}</span>`.repeat(4);
  }
};

export function renderRegion(key, data) {
  const fn = REGIONS[key];
  return fn ? fn(data) : '';
}
