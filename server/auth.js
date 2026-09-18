// Local authentication for CoMa: multiple named accounts, each with a role
// (admin/manager/operator/viewer), gating entry to the whole app. No new dependency:
// password hashing uses Node's built-in crypto.scrypt, and sessions are random tokens
// stored in the `auth_sessions` table and read back from an HttpOnly cookie.
//
// This module used to back a single shared account (see server/auth-migration.js for
// how that account becomes the first admin on upgrade). See docs/security.md for the
// full picture: roles, audit log, CSRF header, rate limiting, and local password
// recovery.

const crypto = require('crypto');

const COOKIE_NAME = 'coma_session';
// Sessions outlive a shift and a weekend so an operator is not re-logging into a shop
// floor kiosk every morning. This is a convenience window for a shared device, not a
// security boundary tied to the scheduler's process lifetime.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// A random password for admin-created accounts and password resets. Admin-created
// passwords are always temporary and random (never chosen by the admin creating them),
// paired with must_change_password=1 so the real password is only ever known to the
// person who typed it in on first login. base64url keeps it URL/copy-paste safe while
// staying well above MIN_PASSWORD_LENGTH.
function generateTemporaryPassword() {
  return crypto.randomBytes(15).toString('base64url');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

// No `Secure` attribute: this app is documented as a LAN-only, typically-http install
// (see docs/installation.md). Adding `Secure` would silently break the cookie there.
function setSessionCookie(res, token) {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

// Creates a session row for a given user and returns the token. Callers set the cookie
// separately. userAgent/ip are stored so the manageable-sessions screen can show what
// each session is, and are best-effort (undefined is stored as NULL).
function createSession(db, userId, { userAgent, ip } = {}) {
  const token = generateToken();
  const now = Date.now();
  db.prepare(`
    INSERT INTO auth_sessions (token, created_at, expires_at, user_id, user_agent, ip, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, now, now + SESSION_TTL_MS, userId, userAgent ?? null, ip ?? null, now);
  return token;
}

// Looks up a session by token; returns the row if valid, else null. Expired sessions
// are deleted lazily on lookup (the row count is always tiny) rather than through a
// background sweep, since this app has no cron-style job runner. Touches
// last_seen_at so the sessions screen reflects recent activity.
function getValidSession(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    return null;
  }
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token = ?').run(Date.now(), token);
  return row;
}

function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

// Deletes every session for one user (used by admin password reset and by a user
// changing their own password). With no userId, deletes every session for every user
// (used by delete-account style flows and tests).
function deleteAllSessions(db, userId) {
  if (userId != null) {
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
  } else {
    db.prepare('DELETE FROM auth_sessions').run();
  }
}

function getUserById(db, userId) {
  if (userId == null) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// Express middleware: 401s any request without a valid session belonging to an active
// user, and attaches req.user / req.session for downstream role checks.
function requireAuth(db) {
  return (req, res, next) => {
    const session = getValidSession(db, getSessionToken(req));
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    const user = getUserById(db, session.user_id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Not authenticated' });
    req.session = session;
    req.user = user;
    next();
  };
}

// Role rank, lowest to highest. Used by requireMinRole and by blockViewerWrites to know
// which role is "viewer" without hardcoding the string in two places.
const ROLE_RANK = { viewer: 0, operator: 1, manager: 2, admin: 3 };

// Express middleware factory: 403s unless req.user.role is one of `roles`. Must run
// after requireAuth(db) so req.user exists.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not permitted for your role' });
    }
    next();
  };
}

// Express middleware factory: 403s unless req.user's role rank is at least minRole's.
// Must run after requireAuth(db).
function requireMinRole(minRole) {
  const minRank = ROLE_RANK[minRole];
  return (req, res, next) => {
    if (!req.user || ROLE_RANK[req.user.role] === undefined || ROLE_RANK[req.user.role] < minRank) {
      return res.status(403).json({ error: 'Not permitted for your role' });
    }
    next();
  };
}

// Global, method-based gate: any mutating request (POST/PUT/DELETE/PATCH) from a
// viewer is rejected. This is the "coarse" permission granularity for the ~20 existing
// route files (printers, projects, parts, ...): viewers can read everything the app
// shows them but cannot change anything, without touching each route file individually.
// Endpoints that need a tighter role (users, backup restore, audit log) layer
// requireRole/requireMinRole on top of this, inline at their mount point.
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
function blockViewerWrites() {
  return (req, res, next) => {
    if (req.user && req.user.role === 'viewer' && WRITE_METHODS.has(req.method)) {
      return res.status(403).json({ error: 'Viewers cannot make changes' });
    }
    next();
  };
}

// Express middleware factory: once req.user.must_change_password is set (a fresh
// admin-created account, or a password reset), every route is blocked except the ones
// in `allowedPaths` (the self password-change route, plus whatever the login gate
// already exempts before this even runs). Must run after requireAuth(db).
function blockOnForcedPasswordChange(allowedPaths) {
  const allowed = new Set(allowedPaths);
  return (req, res, next) => {
    if (!req.user || !req.user.must_change_password) return next();
    if (allowed.has(req.path)) return next();
    return res.status(403).json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' });
  };
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  ROLE_RANK,
  hashPassword,
  verifyPassword,
  generateToken,
  generateTemporaryPassword,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  createSession,
  getValidSession,
  deleteSession,
  deleteAllSessions,
  getUserById,
  requireAuth,
  requireRole,
  requireMinRole,
  blockViewerWrites,
  blockOnForcedPasswordChange,
};
