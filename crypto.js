// Password hashing (PBKDF2-SHA256), random tokens and constant-time compare,
// all with the Web Crypto API built into Node.js and every modern browser.
// Shared by the server and the password setup page (public/admin/setup.html).

// 310,000 rounds of PBKDF2-SHA256: slow for anyone trying to crack a stolen
// hash, but fast enough (about 0.1 s) to stay well within the free hosting
// plan's CPU allowance even during an attack. Hashes with other round counts still
// verify, so a hash made by an earlier version keeps working.
export const PBKDF2_ITERATIONS = 310000;
const MIN_ITERATIONS = 10000;
const MAX_ITERATIONS = 2000000;
const enc = new TextEncoder();

export function toBase64Url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(byteLength = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function sha256Base64Url(text) {
  return toBase64Url(await sha256(text));
}

export async function hmacBase64Url(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

export function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  if (crypto.subtle && typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations, bits) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const out = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bits);
  return new Uint8Array(out);
}

/** Format: pbkdf2_sha256$<iterations>$<salt>$<hash> (base64url). */
export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations, 256);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export function isValidHashFormat(stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  return Number.isInteger(iterations) && iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS && parts[2].length >= 16 && parts[3].length >= 32;
}

// A fixed decoy hash so a wrong username takes as long as a wrong password.
const DECOY = `pbkdf2_sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

export async function verifyPassword(password, stored) {
  const usable = isValidHashFormat(stored);
  const [, iter, saltText, hashText] = (usable ? stored.trim() : DECOY).split('$');
  const expected = fromBase64Url(hashText);
  const actual = await pbkdf2(String(password), fromBase64Url(saltText), Number(iter), expected.length * 8);
  return usable && timingSafeEqual(actual, expected);
}

export async function safeStringEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  return timingSafeEqual(ha, hb);
}
