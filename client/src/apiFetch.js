// Thin wrapper over fetch that adds the CSRF header (server/auth.js's
// requireCsrfHeader()) to every mutating request. Cookies are already SameSite=Lax
// with no CORS configuration on the server, so a plain cross-site form post or fetch
// cannot set a custom header; this is what closes the rest of the gap.
//
// Usage is a drop-in replacement for fetch: apiFetch(url, options). GET/HEAD requests
// (and any request with no explicit method, which defaults to GET like fetch itself)
// pass through unchanged, matching the server's requireCsrfHeader(), which only checks
// POST/PUT/DELETE/PATCH.
//
// Exempt from needing this: POST /api/auth/login and POST /api/auth/register (the two
// entry points that issue a session in the first place, see server/index.js). Sending
// the header there is harmless (the server only requires it on every other route), so
// callers do not need to special-case those two calls.

const CSRF_HEADER = 'X-CoMa-Request';
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (!WRITE_METHODS.has(method)) return fetch(url, options);

  const headers = new Headers(options.headers || {});
  headers.set(CSRF_HEADER, '1');
  return fetch(url, { ...options, method, headers });
}
