const express = require('express');
const router = express.Router();

const {
  hashPassword,
  verifyPassword,
  generateTemporaryPassword,
  requireAuth,
  requireRole,
  requireMinRole,
  deleteAllSessions,
  ROLE_RANK,
} = require('../auth');
const audit = require('../audit');

const VALID_ROLES = Object.keys(ROLE_RANK);
const MIN_PASSWORD_LENGTH = 8;

// Never send password_hash/password_salt to the client.
function publicShape(user) {
  const { password_hash, password_salt, ...rest } = user;
  return rest;
}

module.exports = (db) => {
  function getUser(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  function activeAdminCount() {
    return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
  }

  // POST /api/users/me/password: the caller's own password change. Also the one
  // exempt route while must_change_password is set (see server/index.js), so this is
  // how the forced-change flow after a reset or admin-created account resolves.
  // Requires the current password even for a forced change: the caller already knows
  // it, since they just used it to log in.
  router.post('/me/password', requireAuth(db), (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !verifyPassword(String(currentPassword), req.user.password_hash, req.user.password_salt)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const { hash, salt } = hashPassword(String(newPassword));
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?')
      .run(hash, salt, req.user.id);
    audit.log(db, req.user, 'user.change_own_password', { entityType: 'user', entityId: req.user.id, ip: req.ip });
    res.json({ ok: true });
  });

  // GET /api/users: admin and manager can see the user list (read-only for manager;
  // every mutation below is admin-only).
  router.get('/', requireAuth(db), requireMinRole('manager'), (req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY username').all();
    res.json(users.map(publicShape));
  });

  // POST /api/users: creates a user with a random temporary password, returned once in
  // the response body. Never accepts a caller-chosen password: this is what "admin-
  // created passwords are always temporary and random" means in practice.
  router.post('/', requireAuth(db), requireRole('admin'), (req, res) => {
    const { username, role } = req.body || {};
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
    }
    const trimmed = String(username).trim();
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(trimmed)) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const password = generateTemporaryPassword();
    const { hash, salt } = hashPassword(password);
    const now = Date.now();
    const insert = db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at, created_by)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `).run(trimmed, hash, salt, role, now, req.user.id);

    audit.log(db, req.user, 'user.create', { entityType: 'user', entityId: insert.lastInsertRowid, note: `role=${role}`, ip: req.ip });
    res.status(201).json({ user: publicShape(getUser(insert.lastInsertRowid)), temporaryPassword: password });
  });

  // PUT /api/users/:id: partial update of role/is_active (COALESCE, updates are PUT
  // not PATCH per project convention). Guards against leaving CoMa with zero active
  // admins.
  router.put('/:id', requireAuth(db), requireRole('admin'), (req, res) => {
    const user = getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { role, is_active } = req.body || {};
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
    }
    const activeProvided = is_active !== undefined;
    const activeParam = activeProvided ? (is_active ? 1 : 0) : null;
    const nextRole = role !== undefined ? role : user.role;
    const nextActive = activeProvided ? activeParam : user.is_active;
    const wouldLoseLastAdmin =
      user.role === 'admin' && user.is_active === 1 &&
      (nextRole !== 'admin' || nextActive !== 1) &&
      activeAdminCount() <= 1;
    if (wouldLoseLastAdmin) {
      return res.status(409).json({ error: 'Cannot demote or deactivate the last active admin' });
    }

    db.prepare(`
      UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?
    `).run(role ?? null, activeParam, user.id);

    if (nextActive === 0) deleteAllSessions(db, user.id);

    audit.log(db, req.user, 'user.update', {
      entityType: 'user',
      entityId: user.id,
      note: `role: ${user.role} -> ${nextRole}, is_active: ${user.is_active} -> ${nextActive}`,
      ip: req.ip,
    });
    res.json(publicShape(getUser(user.id)));
  });

  // DELETE /api/users/:id
  router.delete('/:id', requireAuth(db), requireRole('admin'), (req, res) => {
    const user = getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin' && user.is_active === 1 && activeAdminCount() <= 1) {
      return res.status(409).json({ error: 'Cannot delete the last active admin' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    deleteAllSessions(db, user.id);
    audit.log(db, req.user, 'user.delete', { entityType: 'user', entityId: user.id, note: user.username, ip: req.ip });
    res.json({ ok: true });
  });

  // POST /api/users/:id/reset-password: admin-initiated recovery for a user who is
  // locked out. Generates a new random password, forces a change on next login, and
  // revokes every existing session of that user (a stale session should not survive a
  // password reset). Returned once, never stored or logged in plaintext.
  router.post('/:id/reset-password', requireAuth(db), requireRole('admin'), (req, res) => {
    const user = getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const password = generateTemporaryPassword();
    const { hash, salt } = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?')
      .run(hash, salt, user.id);
    deleteAllSessions(db, user.id);

    audit.log(db, req.user, 'user.reset_password', { entityType: 'user', entityId: user.id, ip: req.ip });
    res.json({ ok: true, temporaryPassword: password });
  });

  return router;
};
