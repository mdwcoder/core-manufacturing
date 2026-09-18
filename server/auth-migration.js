// One-time, additive-by-copy migration from the old single-row auth_account to the new
// multi-user `users` table with roles.
//
// Pure function so it is testable without loading the real db.js singleton (see
// server/tests/auth-migration.test.js), matching the "heavyweight test" rule in
// CLAUDE.md.
//
// What it does, only when `users` is empty and an `auth_account` row exists:
//  1. Copies the account into `users` as the first admin (same username, password hash
//     and salt, so the existing password keeps working).
//  2. Moves `auth_account.onboarding_completed_at` to the `settings` table, since the
//     setup wizard is a per-installation event, not a per-account one.
//  3. Reassigns every row in `auth_sessions` to the new admin's id, so an operator who
//     upgrades CoMa is not forced to log back in.
//
// `auth_account` itself is never deleted (no destructive migrations, per CLAUDE.md): it
// is left orphaned but intact, in case something needs to read it later.
function migrateAuthAccountToUsers(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return { migrated: false };

  const account = db.prepare('SELECT * FROM auth_account WHERE id = 1').get();
  if (!account) return { migrated: false };

  const migrate = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES (?, ?, ?, 'admin', 1, 0, ?)
    `).run(account.username, account.password_hash, account.password_salt, account.created_at);
    const newUserId = insert.lastInsertRowid;

    if (account.onboarding_completed_at) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('onboarding_completed_at', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(account.onboarding_completed_at));
    }

    db.prepare('UPDATE auth_sessions SET user_id = ? WHERE user_id IS NULL').run(newUserId);

    return newUserId;
  });

  const userId = migrate();
  console.log(`[auth-migration] Migrated auth_account "${account.username}" to users.id=${userId} (admin)`);
  return { migrated: true, userId };
}

module.exports = { migrateAuthAccountToUsers };
