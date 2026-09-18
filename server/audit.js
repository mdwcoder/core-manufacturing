// Persistent audit log: records who did what to the login/user/backup surface, and to
// completed_qty-crediting operator actions. Never pruned, same policy as
// printer_events (server/events.js). No FK on user_id, so a row survives the user being
// deleted.
//
// Unlike server/events.js, this takes `db` as a parameter rather than requiring the
// real server/db.js singleton at module scope: it is wired into server/routes/auth.js,
// users.js, sessions.js, and backup.js, all of which are exercised by tests that build
// their own in-memory db (see CLAUDE.md's "heavyweight test" rule) and must not
// transitively pull in the real database file.
//
// Excluded from backup export/restore (server/routes/backup.js), the same way
// auth_account/auth_sessions/users are: an audit log from one machine should not be
// mixed into another machine's history when a backup is restored onto it.

// `user` is a users-table row, or null for a failed login attempt (no session exists
// yet); pass { username } in that case so the attempt is still attributable to a name.
function log(db, user, action, { entityType = null, entityId = null, note = null, ip = null } = {}) {
  db.prepare(`
    INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, note, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user && user.id != null ? user.id : null,
    user && user.username ? user.username : null,
    action,
    entityType,
    entityId,
    note,
    ip,
    Date.now()
  );
}

module.exports = { log };
