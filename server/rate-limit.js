// Login rate limiting: an in-memory sliding window, keyed by IP+username. No new
// dependency, same spirit as the "no new dependency" comment in server/auth.js:
// crypto.scrypt is already slow enough to make raw brute force expensive, this stops
// an automated retry loop from hammering the login/register/reset-password endpoints.
//
// State lives in a plain Map for the process lifetime. It resets on restart (acceptable
// for a LAN app with no cron-style job runner, same tradeoff server/auth.js makes for
// session expiry) and is bounded by clearing stale keys lazily on access rather than a
// background sweep timer, so it adds no interval/handle for tests or the process to
// manage.

const DEFAULT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_ATTEMPTS = 10;

// key -> array of attempt timestamps (ms), within the current window.
const attempts = new Map();

function pruneAndCount(key, windowMs, now) {
  const existing = attempts.get(key);
  if (!existing) return [];
  const kept = existing.filter(t => now - t < windowMs);
  if (kept.length === 0) {
    attempts.delete(key);
  } else {
    attempts.set(key, kept);
  }
  return kept;
}

// Express middleware factory. `keyFn(req)` builds the rate-limit key (typically
// IP+username); returning null/undefined skips limiting for that request (e.g. a
// register call with no username yet, which the route's own 400 handles instead).
function rateLimit({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_ATTEMPTS, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();

    const now = Date.now();
    const kept = pruneAndCount(key, windowMs, now);
    if (kept.length >= max) {
      const retryAfterMs = windowMs - (now - kept[0]);
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({ error: 'Too many attempts, try again later' });
    }

    kept.push(now);
    attempts.set(key, kept);
    next();
  };
}

// Standard key for login/register: IP + the username in the request body (lowercased,
// trimmed), so one IP hammering many usernames and one username hammered from many IPs
// are both bounded independently as well as together.
function loginKey(req) {
  const username = req.body && req.body.username ? String(req.body.username).trim().toLowerCase() : '';
  if (!username) return null;
  return `${req.ip}:${username}`;
}

// Key for an admin resetting a specific user's password: IP + target user id.
function resetPasswordKey(req) {
  if (!req.params || !req.params.id) return null;
  return `${req.ip}:reset:${req.params.id}`;
}

// Test-only escape hatch: clears all rate-limit state between test cases so one test's
// attempts don't bleed into the next.
function _resetForTests() {
  attempts.clear();
}

module.exports = { rateLimit, loginKey, resetPasswordKey, _resetForTests, DEFAULT_WINDOW_MS, DEFAULT_MAX_ATTEMPTS };
