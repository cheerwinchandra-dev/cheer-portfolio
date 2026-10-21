// Input validation for every form the site accepts.

import { DEFAULT_CONTENT, DEFAULT_PROJECTS, COVER_STYLES, CONTACT_TOPICS } from '../public/js/shared/defaults.js';
import { safeUrl } from '../public/js/shared/projects.js';
import { HttpError } from './http.js';

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f]/g;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

export function oneLine(value) {
  return typeof value === 'string' ? value.replace(CONTROL_ALL, ' ').replace(/\s+/g, ' ').trim() : '';
}

export function multiLine(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_EXCEPT_NEWLINE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value);
}

function charLength(s) {
  return Array.from(s).length;
}

// ---------- Contact form ----------

export function validateContact(body) {
  const errors = {};
  const name = oneLine(body.name);
  const email = oneLine(body.email).toLowerCase();
  const topic = oneLine(body.topic);
  const message = multiLine(body.message);

  if (charLength(name) < 2) errors.name = 'Please enter your name.';
  else if (charLength(name) > 80) errors.name = 'Please keep your name under 80 characters.';
  else if (/https?:|www\.|<|>/i.test(name)) errors.name = 'Please enter just your name.';

  if (!email) errors.email = 'Please enter your email address.';
  else if (!isEmail(email)) errors.email = 'Please enter a valid email address, like name@example.com.';

  if (topic && !CONTACT_TOPICS.includes(topic)) errors.topic = 'Please choose a topic from the list.';

  const msgLen = charLength(message);
  if (msgLen < 10) errors.message = 'Please write a little more (at least 10 characters).';
  else if (msgLen > 4000) errors.message = 'Please keep your message under 4,000 characters.';
  else if ((message.match(/https?:\/\//gi) || []).length > 5) errors.message = 'Please include no more than 5 links.';

  if (Object.keys(errors).length) {
    throw new HttpError(400, 'validation_failed', 'Please check the highlighted fields.', { fields: errors });
  }
  return { name, email, topic, message };
}

// ---------- Profile content (dashboard) ----------

const str = (min, max) => ({ kind: 'str', min, max });
const text = (min, max) => ({ kind: 'text', min, max });
const list = (item, min, max) => ({ kind: 'list', item, min, max });
const obj = (fields) => ({ kind: 'obj', fields });

const CONTENT_SCHEMA = {
  name: str(2, 60),
  role: str(2, 60),
  available: { kind: 'bool' },
  availabilityText: str(0, 60),
  heroTags: str(1, 40),
  heroLines: list(str(1, 40), 1, 3),
  quote: str(0, 140),
  bio: text(0, 400),
  aboutParagraphs: list(text(1, 600), 1, 3),
  aboutPoints: list(str(1, 40), 0, 6),
  location: str(0, 60),
  publicEmail: { kind: 'email' },
  phone: { kind: 'phone' },
  linkedin: { kind: 'url' },
  github: { kind: 'url' },
  services: list(obj({ title: str(1, 30), text: str(0, 140) }), 1, 6),
  process: list(obj({ title: str(1, 30), text: str(0, 140) }), 1, 6),
  tools: list(obj({ name: str(1, 24), abbr: str(1, 4) }), 0, 12),
  collaborateText: text(0, 240),
  closingLine: str(0, 60),
  badgeText: str(3, 40)
};

const LABELS = {
  name: 'Name', role: 'Role', availabilityText: 'Availability text', heroTags: 'Hero headline', heroLines: 'Hero lines',
  quote: 'Quote', bio: 'Short bio', aboutParagraphs: 'About paragraphs', aboutPoints: 'About highlights', location: 'Location',
  publicEmail: 'Public email', phone: 'Phone', linkedin: 'LinkedIn URL', github: 'GitHub URL', services: 'What I do',
  process: 'My process', tools: 'Tools', collaborateText: 'Contact intro', closingLine: 'Closing line', badgeText: 'Badge text'
};

function checkValue(spec, value, label) {
  switch (spec.kind) {
    case 'bool':
      if (typeof value !== 'boolean') throw `${label} must be on or off.`;
      return value;
    case 'str':
    case 'text': {
      if (typeof value !== 'string') throw `${label} must be text.`;
      const v = spec.kind === 'str' ? oneLine(value) : multiLine(value);
      const n = charLength(v);
      if (n < spec.min) throw spec.min === 1 ? `${label} can't be empty.` : `${label} needs at least ${spec.min} characters.`;
      if (n > spec.max) throw `${label} can be at most ${spec.max} characters (now ${n}).`;
      return v;
    }
    case 'email': {
      const v = oneLine(value).toLowerCase();
      if (v && !isEmail(v)) throw `${label} must be a valid email address or empty.`;
      return v;
    }
    case 'phone': {
      const v = oneLine(value);
      if (v && !/^\+?[0-9 ()-]{6,24}$/.test(v)) throw `${label} can only contain digits, spaces, ( ) - and a leading +.`;
      return v;
    }
    case 'url': {
      const raw = oneLine(value);
      if (!raw) return '';
      const v = safeUrl(raw);
      if (!v || !v.startsWith('https://')) throw `${label} must be a full https:// link.`;
      return v;
    }
    case 'list': {
      if (!Array.isArray(value)) throw `${label} must be a list.`;
      if (value.length < spec.min) throw `${label} needs at least ${spec.min} item${spec.min === 1 ? '' : 's'}.`;
      if (value.length > spec.max) throw `${label} can have at most ${spec.max} items.`;
      return value.map((item, i) => checkValue(spec.item, item, `${label} item ${i + 1}`));
    }
    case 'obj': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw `${label} is not in the right format.`;
      const out = {};
      for (const [k, s] of Object.entries(spec.fields)) out[k] = checkValue(s, value[k] === undefined ? '' : value[k], `${label} ${k}`);
      return out;
    }
    default:
      throw `${label} is not supported.`;
  }
}

/** Validates a full or partial content object and returns it merged with defaults. */
export function validateContent(input, current = DEFAULT_CONTENT) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'validation_failed', 'Content must be an object.');
  }
  const out = { ...DEFAULT_CONTENT, ...current };
  const errors = {};
  for (const [key, spec] of Object.entries(CONTENT_SCHEMA)) {
    if (!(key in input)) continue;
    try {
      out[key] = checkValue(spec, input[key], LABELS[key] || key);
    } catch (msg) {
      errors[key] = String(msg);
    }
  }
  if (Object.keys(errors).length) {
    throw new HttpError(400, 'validation_failed', 'Some fields need fixing.', { fields: errors });
  }
  return out;
}

/** Saved content can be from an older version; drop anything that no longer validates. */
export function sanitizeStoredContent(stored) {
  const out = { ...DEFAULT_CONTENT };
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, spec] of Object.entries(CONTENT_SCHEMA)) {
    if (!(key in stored)) continue;
    try {
      out[key] = checkValue(spec, stored[key], key);
    } catch {
      /* keep default */
    }
  }
  return out;
}

// ---------- Project settings (dashboard) ----------

const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function validateProjects(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'validation_failed', 'Project settings must be an object.');
  }
  const errors = {};
  const names = (value, field, max) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      errors[field] = 'Must be a list of repository names.';
      return [];
    }
    if (value.length > max) errors[field] = `At most ${max} repositories.`;
    const out = [];
    for (const n of value.slice(0, max)) {
      if (typeof n !== 'string' || !REPO.test(n)) {
        errors[field] = `"${String(n).slice(0, 40)}" is not a valid repository name.`;
        continue;
      }
      if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
    }
    return out;
  };
  const pinned = names(input.pinned, 'pinned', 12);
  const hidden = names(input.hidden, 'hidden', 200);
  const overrides = {};
  const raw = input.overrides === undefined ? {} : input.overrides;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.overrides = 'Overrides must be an object.';
  } else {
    const entries = Object.entries(raw);
    if (entries.length > 200) errors.overrides = 'Too many project overrides.';
    for (const [repo, o] of entries.slice(0, 200)) {
      if (!REPO.test(repo) || !o || typeof o !== 'object' || Array.isArray(o)) {
        errors.overrides = `Settings for "${repo.slice(0, 40)}" are not valid.`;
        continue;
      }
      try {
        const item = {
          title: checkValue(str(0, 40), o.title ?? '', 'Title'),
          tagline: checkValue(str(0, 60), o.tagline ?? '', 'Tagline'),
          category: checkValue(str(0, 40), o.category ?? '', 'Category'),
          description: checkValue(str(0, 320), o.description ?? '', 'Description'),
          demo: checkValue({ kind: 'url' }, o.demo ?? '', 'Live demo link'),
          cover: COVER_STYLES.includes(o.cover) ? o.cover : 'auto'
        };
        if (item.title || item.tagline || item.category || item.description || item.demo || item.cover !== 'auto') overrides[repo] = item;
      } catch (msg) {
        errors[`override:${repo}`] = `${repo}: ${msg}`;
      }
    }
  }
  if (pinned.some((p) => hidden.some((h) => h.toLowerCase() === p.toLowerCase()))) {
    errors.pinned = 'A repository can’t be pinned and hidden at the same time.';
  }
  if (Object.keys(errors).length) {
    throw new HttpError(400, 'validation_failed', Object.values(errors)[0], { fields: errors });
  }
  return { pinned, hidden, overrides };
}

export function sanitizeStoredProjects(stored) {
  if (!stored) return structuredClone(DEFAULT_PROJECTS);
  try {
    return validateProjects(stored);
  } catch {
    return structuredClone(DEFAULT_PROJECTS);
  }
}

// ---------- Password policy ----------

// Fragments that make a password easy to guess wherever they appear.
const WEAK_PARTS = ['password', 'passw0rd', 'qwerty', '123456', 'letmein', 'iloveyou', 'abc123'];

export function passwordProblem(password, username) {
  if (typeof password !== 'string') return 'Enter a new password.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers.';
  const lower = password.toLowerCase();
  if (username && lower.includes(username.toLowerCase())) return 'Don’t include your username in the password.';
  if (WEAK_PARTS.some((c) => lower.includes(c))) return 'That password is too easy to guess. Avoid words like “password” or runs like “123456”.';
  if (/^(.)\1+$/.test(password)) return 'Don’t repeat a single character.';
  return '';
}
