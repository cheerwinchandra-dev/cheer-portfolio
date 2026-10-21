// Fixed-window rate limits and login lockouts, stored in Postgres.

import { first, query, num } from './db.js';

/**
 * Counts one event atomically. Returns allowed=false once more than `limit`
 * events happen inside `windowMs`.
 */
export async function hit(key, { limit, windowMs }, now = Date.now()) {
  const row = await first(
    `INSERT INTO pf_rate_limits (key, count, window_start) VALUES ($1, 1, $2::float8)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN pf_rate_limits.window_start <= $2::float8 - $3::float8 THEN 1 ELSE pf_rate_limits.count + 1 END,
       window_start = CASE WHEN pf_rate_limits.window_start <= $2::float8 - $3::float8 THEN $2::float8 ELSE pf_rate_limits.window_start END
     RETURNING count, window_start`,
    [key, now, windowMs]
  );
  const count = num(row.count);
  if (count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((num(row.window_start) + windowMs - now) / 1000)) };
  }
  return { allowed: true, remaining: limit - count };
}

/** Seconds until `key` is unlocked, or 0 when it is not locked. */
export async function lockedFor(key, now = Date.now()) {
  const row = await first('SELECT locked_until FROM pf_rate_limits WHERE key = $1', [key]);
  const until = row ? num(row.locked_until) : 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/**
 * Records a failed attempt. After `max` failures inside `windowMs` the key is
 * locked; with `escalate`, each repeat lockout doubles the lock (up to 24 hours).
 */
export async function recordFailure(key, { max, windowMs, lockMs, escalate = true }, now = Date.now()) {
  const row = await first(
    `INSERT INTO pf_rate_limits (key, count, window_start) VALUES ($1, 1, $2::float8)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN pf_rate_limits.window_start <= $2::float8 - $3::float8 THEN 1 ELSE pf_rate_limits.count + 1 END,
       window_start = CASE WHEN pf_rate_limits.window_start <= $2::float8 - $3::float8 THEN $2::float8 ELSE pf_rate_limits.window_start END
     RETURNING count, strikes`,
    [key, now, windowMs]
  );
  const count = num(row.count);
  if (count < max) return { locked: 0, remaining: max - count };
  const strikes = Math.min(num(row.strikes) + 1, 10);
  const duration = escalate ? Math.min(lockMs * 2 ** (strikes - 1), 24 * 60 * 60 * 1000) : lockMs;
  await query('UPDATE pf_rate_limits SET count = 0, window_start = $2, locked_until = $3, strikes = $4 WHERE key = $1', [key, now, now + duration, strikes]);
  return { locked: Math.ceil(duration / 1000), remaining: 0 };
}

export async function clearKey(key) {
  await query('DELETE FROM pf_rate_limits WHERE key = $1', [key]);
}

/** Housekeeping: drop counters nobody has touched for two days. */
export async function pruneRateLimits(now = Date.now()) {
  await query('DELETE FROM pf_rate_limits WHERE window_start < $1 AND locked_until < $2', [now - 2 * 24 * 60 * 60 * 1000, now]);
}
