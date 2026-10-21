#!/usr/bin/env node
// Build step (Netlify runs this as "npm run build", see netlify.toml).
// 1. Bakes the default content into public/index.html so the page is complete
//    before JavaScript runs (good for search engines and slow connections).
// 2. Makes link-preview URLs absolute (LinkedIn and WhatsApp need full URLs),
//    using your site's main address from Netlify (the URL build variable).

import { readFileSync, writeFileSync } from 'node:fs';
import { REGIONS } from '../public/js/shared/render.js';
import { DEFAULT_CONTENT, DEFAULT_PROJECTS } from '../public/js/shared/defaults.js';
import { buildGithubView } from '../public/js/shared/projects.js';
import snapshot from '../public/js/shared/snapshot.js';

const file = new URL('../public/index.html', import.meta.url);
const ctx = { content: DEFAULT_CONTENT, github: { ...buildGithubView(snapshot, DEFAULT_PROJECTS), source: 'snapshot', fetchedAt: snapshot.fetchedAt }, now: null };

let html = readFileSync(file, 'utf8');
let count = 0;
html = html.replace(/(data-r="(\w+)"[^>]*>)<!--r-->[\s\S]*?<!--\/r-->/g, (match, open, key) => {
  if (!REGIONS[key]) throw new Error(`Unknown region "${key}"`);
  count++;
  return `${open}<!--r-->${REGIONS[key](ctx)}<!--/r-->`;
});

const host = (process.env.SITE_URL || process.env.URL || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const origin = /^[A-Za-z0-9.-]+(:\d+)?$/.test(host) ? `https://${host}` : '';
html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${origin}/img/og.jpg">`);
html = html.replace(/\n?<meta property="og:url" content="[^"]*">/, '').replace(/\n?<link rel="canonical" href="[^"]*">/, '');
if (origin) {
  html = html.replace(/(<meta property="og:image" content="[^"]*">)/, `$1\n<meta property="og:url" content="${origin}/">\n<link rel="canonical" href="${origin}/">`);
}
writeFileSync(file, html);
console.log(`Baked ${count} regions into public/index.html${origin ? ` · share links use ${origin}` : ''}`);
