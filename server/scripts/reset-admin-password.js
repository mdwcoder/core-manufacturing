#!/usr/bin/env node
// Local password recovery for when no admin can log in to use the normal reset flow
// (POST /api/users/:id/reset-password).
//
// Run directly on the machine hosting CoMa:
//   node server/scripts/reset-admin-password.js <username> <new-password> [--role admin]
//
// This has no HTTP surface and no rate limiting of its own: the security boundary is
// SSH/console access to the machine, which is the correct boundary for a LAN app with
// no SMTP-based "forgot password" flow (see docs/installation.md and docs/security.md).
// Unlike an admin-created account, the password here is typed in by the person with
// that console access, so must_change_password is left at 0.
//
// If `username` does not exist, this creates it (as an active account with the given
// role, default 'admin'). If it exists, its password is replaced and every open
// session for that user is revoked, so a possibly-compromised session cannot survive
// the reset.

const { hashPassword, deleteAllSessions } = require('../auth');
const db = require('../db');

const MIN_PASSWORD_LENGTH = 8;
const VALID_ROLES = ['admin', 'manager', 'operator', 'viewer'];

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const roleFlagIndex = args.indexOf('--role');
  const role = roleFlagIndex !== -1 ? args[roleFlagIndex + 1] : 'admin';
  return { username: positional[0], password: positional[1], role };
}

function main() {
  const { username, password, role } = parseArgs(process.argv);

  if (!username || !password) {
    console.error('Usage: node server/scripts/reset-admin-password.js <username> <new-password> [--role admin]');
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`--role must be one of ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const { hash, salt } = hashPassword(password);
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (existing) {
    db.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, is_active = 1, must_change_password = 0
      WHERE id = ?
    `).run(hash, salt, existing.id);
    deleteAllSessions(db, existing.id);
    console.log(`[reset-admin-password] Reset password for existing user "${username}" (role unchanged: ${existing.role}), revoked open sessions.`);
  } else {
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 1, 0, ?)
    `).run(username, hash, salt, role, Date.now());
    console.log(`[reset-admin-password] Created user "${username}" with role "${role}".`);
  }
}

main();
