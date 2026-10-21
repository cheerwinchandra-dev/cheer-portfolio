// Small HTTP helpers: JSON responses, safe body parsing, origin checks and
// security headers for API responses. (Pages and files get their headers
// from public/_headers; Netlify doesn't apply those to function responses,
// so the API sets its own below.)

import { AsyncLocalStorage } from 'node:async_hooks';

// What the platform knows about the current request: the visitor's IP and
// country (from Netlify, which visitors can't fake) and waitUntil.
const platformStore = new AsyncLocalStorage();

/** Runs fn with the platform details for one request. */
export function runWithPlatform(platform, fn) {
  return platformStore.run(platform || {}, fn);
}

/** Lets work finish after the response is sent (Netlify's context.waitUntil). */
export function runInBackground(promise) {
  const waitUntil = platformStore.getStore()?.waitUntil;
  if (typeof waitUntil === 'function') {
    try {
      waitUntil(promise);
    } catch {
      /* the promise still runs */
    }
  }
  return promise;
}

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    const headers = {};
    if (err.extra && err.extra.retryAfter) headers['retry-after'] = String(err.extra.retryAfter);
    return json({ ok: false, error: err.code, message: err.message, ...err.extra }, err.status, headers);
  }
  console.error('Unhandled error', err && err.stack ? err.stack : err);
  return json({ ok: false, error: 'server_error', message: 'Something went wrong on the server. Please try again.' }, 500);
}

/** Reads a JSON object body, refusing anything that is not small JSON. */
export async function readJson(request, maxBytes = 8 * 1024) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Requests must be sent as JSON.');
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large', 'That request is too large.');
  const reader = request.body ? request.body.getReader() : null;
  const chunks = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HttpError(413, 'payload_too_large', 'That request is too large.');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_json', 'The request body must be a JSON object.');
  }
  return value;
}

/**
 * Blocks cross-site requests (CSRF). Browsers always send Origin on POST,
 * PUT, PATCH and DELETE; anything from another site is refused.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function assertSameOrigin(request, url) {
  const refuse = () => new HttpError(403, 'bad_origin', 'Requests from other websites are not allowed.');
  const origin = request.headers.get('origin');
  if (origin) {
    let o;
    try {
      o = new URL(origin);
    } catch {
      throw refuse();
    }
    // Compare hosts with the visited domain (request URL, Host or
    // X-Forwarded-Host); the scheme is checked separately below.
    const hosts = new Set(
      [url.host, request.headers.get('host'), (request.headers.get('x-forwarded-host') || '').split(',')[0]]
        .map((h) => (h || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const host = o.host.toLowerCase();
    const secure = o.protocol === 'https:' || (o.protocol === 'http:' && LOCAL_HOST.test(host));
    if (!secure || !hosts.has(host)) throw refuse();
    return;
  }
  const site = request.headers.get('sec-fetch-site');
  if (site !== 'same-origin') throw refuse();
}

/**
 * Who is calling. The IP and country come from the platform (Netlify's
 * context.ip and context.geo), never from request headers, because a visitor
 * can send any header they like and would otherwise dodge the rate limits.
 */
export function clientInfo(request) {
  const platform = platformStore.getStore() || {};
  const ip = String(platform.ip || '').trim().slice(0, 64) || 'unknown';
  const country = String(platform.country || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
  const userAgent = (request.headers.get('user-agent') || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  return { ip, country, userAgent };
}

export function maskIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes('.') && !ip.includes(':')) {
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.x.x` : 'unknown';
  }
  const groups = ip.split(':').filter(Boolean);
  return groups.length ? `${groups.slice(0, 3).join(':')}::/48` : 'unknown';
}

export const API_SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
  'strict-transport-security': 'max-age=63072000; includeSubDomains'
};

export function withApiHeaders(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) res.headers.set(k, v);
  if (!res.headers.has('cache-control')) res.headers.set('cache-control', 'no-store');
  return res;
}
