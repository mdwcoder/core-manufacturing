const express = require('express');
const router = express.Router();

const {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  getValidSession,
  deleteSession,
  deleteAllSessions,
  getUserById,
  requireAuth,
} = require('../auth');
const audit = require('../audit');

const MIN_PASSWORD_LENGTH = 8;

module.exports = (db) => {
  function userCount() {
    return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  }

  function findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  }

  function activeAdminCount() {
    return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
  }

  function onboardingCompleted() {
    return !!db.prepare("SELECT value FROM settings WHERE key = 'onboarding_completed_at'").get();
  }

  // GET /api/auth/status: tells the client which screen to show: create-account,
  // login, the one-time setup guide, or the app itself. Deliberately not gated by
  // requireAuth: this is what decides whether to ask for a session at all.
  router.get('/status', (req, res) => {
    const session = getValidSession(db, getSessionToken(req));
    const user = session ? getUserById(db, session.user_id) : null;
    res.json({
      hasAccount: userCount() > 0,
      authenticated: !!user && !!user.is_active,
      onboardingCompleted: onboardingCompleted(),
      username: user ? user.username : undefined,
      role: user ? user.role : undefined,
      mustChangePassword: user ? !!user.must_change_password : undefined,
    });
  });

  // POST /api/auth/register: creates the very first account (always an admin) on a
  // fresh install. Once any user exists, new users are created by an admin through
  // POST /api/users instead (see server/routes/users.js).
  router.post('/register', (req, res) => {
    if (userCount() > 0) {
      return res.status(409).json({ error: 'An account already exists' });
    }
    const { username, password } = req.body || {};
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const { hash, salt } = hashPassword(String(password));
    const now = Date.now();
    const insert = db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES (?, ?, ?, 'admin', 1, 0, ?)
    `).run(String(username).trim(), hash, salt, now);

    const token = createSession(db, insert.lastInsertRowid, {
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });
    setSessionCookie(res, token);
    audit.log(db, { id: insert.lastInsertRowid, username: String(username).trim() }, 'auth.register', { entityType: 'user', entityId: insert.lastInsertRowid, ip: req.ip });
    res.status(201).json({ ok: true, onboardingCompleted: false });
  });

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      audit.log(db, { username: username ? String(username).trim() : null }, 'auth.login_failed', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = findByUsername(String(username).trim());
    const passwordMatches = user && verifyPassword(String(password), user.password_hash, user.password_salt);
    if (!user || !passwordMatches) {
      audit.log(db, { username: String(username).trim() }, 'auth.login_failed', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = createSession(db, user.id, {
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });
    setSessionCookie(res, token);
    audit.log(db, user, 'auth.login', { entityType: 'user', entityId: user.id, ip: req.ip });
    res.json({ ok: true, onboardingCompleted: onboardingCompleted(), role: user.role, mustChangePassword: !!user.must_change_password });
  });

  // POST /api/auth/logout
  router.post('/logout', (req, res) => {
    const token = getSessionToken(req);
    const session = getValidSession(db, token);
    const user = session ? getUserById(db, session.user_id) : null;
    deleteSession(db, token);
    clearSessionCookie(res);
    if (user) audit.log(db, user, 'auth.logout', { entityType: 'user', entityId: user.id, ip: req.ip });
    res.json({ ok: true });
  });

  // POST /api/auth/complete-onboarding: marks the one-time setup guide as done, for the
  // whole install (settings is a site-level key/value store, not per-account). Any
  // authenticated user can complete it, since it only runs once right after the first
  // admin registers.
  router.post('/complete-onboarding', requireAuth(db), (req, res) => {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('onboarding_completed_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(Date.now()));
    res.json({ ok: true });
  });

  // POST /api/auth/delete-account: deletes the caller's own account. Requires the
  // current password even though the caller already holds a valid session, since this
  // is destructive. Blocked with 409 if the caller is the last active admin -- CoMa
  // must always have at least one admin who can manage the rest of the users.
  router.post('/delete-account', requireAuth(db), (req, res) => {
    const { password } = req.body || {};
    if (!password || !verifyPassword(String(password), req.user.password_hash, req.user.password_salt)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    if (req.user.role === 'admin' && activeAdminCount() <= 1) {
      return res.status(409).json({ error: 'Cannot delete the last active admin' });
    }

    audit.log(db, req.user, 'auth.delete_account', { entityType: 'user', entityId: req.user.id, ip: req.ip });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    deleteAllSessions(db, req.user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
};
