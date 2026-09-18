// Manageable sessions: list and revoke logins, for the caller's own account, and (for
// admins) for any other user.
//
// auth_sessions.token stays the real primary key and is never sent back to the client:
// every session is identified by a display_id = sha256(token).slice(0, 16), computed
// here on read. That is enough to be unique in practice for the tiny number of open
// sessions this app ever has, without ever handing the client something that could be
// replayed as a cookie.

const crypto = require('crypto');
const express = require('express');

const { requireAuth, requireRole } = require('../auth');

function displayId(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function toClientShape(row, currentToken) {
  return {
    display_id: displayId(row.token),
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at,
    user_agent: row.user_agent,
    ip: row.ip,
    current: row.token === currentToken,
  };
}

// Finds a session row for a given user by its display_id, without ever comparing raw
// tokens supplied by the client (there are none: the client only ever has display_id).
function findByDisplayId(db, userId, id) {
  const rows = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ?').all(userId);
  return rows.find(r => displayId(r.token) === id) || null;
}

// GET/DELETE /api/sessions: the caller's own sessions.
function selfRouter(db) {
  const router = express.Router();

  router.get('/', requireAuth(db), (req, res) => {
    const rows = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(req.user.id);
    res.json(rows.map(r => toClientShape(r, req.session.token)));
  });

  // DELETE /api/sessions: revoke every session except the one making this request, so
  // "sign out everywhere else" cannot lock the caller out of their own request.
  router.delete('/', requireAuth(db), (req, res) => {
    const result = db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token != ?')
      .run(req.user.id, req.session.token);
    res.json({ ok: true, revoked: result.changes });
  });

  router.delete('/:displayId', requireAuth(db), (req, res) => {
    const row = findByDisplayId(db, req.user.id, req.params.displayId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(row.token);
    res.json({ ok: true });
  });

  return router;
}

// GET/DELETE /api/users/:id/sessions[...]: an admin managing another user's sessions.
// Mounted with { mergeParams: true } expectations: req.params.id is the target user.
function adminRouter(db) {
  const router = express.Router({ mergeParams: true });

  function targetUser(req, res) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    return user;
  }

  router.get('/', requireAuth(db), requireRole('admin'), (req, res) => {
    const user = targetUser(req, res);
    if (!user) return;
    const rows = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(user.id);
    res.json(rows.map(r => toClientShape(r, req.session.token)));
  });

  router.delete('/', requireAuth(db), requireRole('admin'), (req, res) => {
    const user = targetUser(req, res);
    if (!user) return;
    const result = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
    res.json({ ok: true, revoked: result.changes });
  });

  router.delete('/:displayId', requireAuth(db), requireRole('admin'), (req, res) => {
    const user = targetUser(req, res);
    if (!user) return;
    const row = findByDisplayId(db, user.id, req.params.displayId);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(row.token);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { selfRouter, adminRouter, displayId };
