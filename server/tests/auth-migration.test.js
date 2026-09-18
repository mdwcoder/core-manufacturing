// Coverage for server/auth-migration.js: the additive-by-copy migration from the old
// single-row auth_account to the new multi-user `users` table.
//
// Real-world trigger: existing CoMa installs already have an auth_account row from the
// single-shared-login era. Adding roles must not force every install back through
// account creation and re-login on upgrade.

const Database = require('better-sqlite3');
const { migrateAuthAccountToUsers } = require('../auth-migration');

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE auth_account (
      id                      INTEGER PRIMARY KEY CHECK (id = 1),
      username                TEXT NOT NULL,
      password_hash           TEXT NOT NULL,
      password_salt           TEXT NOT NULL,
      onboarding_completed_at INTEGER,
      created_at              INTEGER NOT NULL
    );
    CREATE TABLE auth_sessions (
      token         TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      user_id       INTEGER,
      user_agent    TEXT,
      ip            TEXT,
      last_seen_at  INTEGER
    );
    CREATE TABLE users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      username              TEXT NOT NULL UNIQUE,
      password_hash         TEXT NOT NULL,
      password_salt         TEXT NOT NULL,
      role                  TEXT NOT NULL DEFAULT 'operator',
      is_active             INTEGER NOT NULL DEFAULT 1,
      must_change_password  INTEGER NOT NULL DEFAULT 0,
      created_at            INTEGER NOT NULL,
      created_by            INTEGER
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
});

test('does nothing on a brand new install (no auth_account row)', () => {
  const result = migrateAuthAccountToUsers(db);
  expect(result).toEqual({ migrated: false });
  expect(db.prepare('SELECT COUNT(*) AS c FROM users').get().c).toBe(0);
});

test('copies auth_account into users as the first admin, preserving the password hash', () => {
  db.prepare(`
    INSERT INTO auth_account (id, username, password_hash, password_salt, created_at)
    VALUES (1, 'operator', 'somehash', 'somesalt', 1000)
  `).run();

  const result = migrateAuthAccountToUsers(db);
  expect(result.migrated).toBe(true);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
  expect(user.username).toBe('operator');
  expect(user.password_hash).toBe('somehash');
  expect(user.password_salt).toBe('somesalt');
  expect(user.role).toBe('admin');
  expect(user.is_active).toBe(1);
  expect(user.must_change_password).toBe(0);

  // auth_account itself is never dropped.
  expect(db.prepare('SELECT * FROM auth_account WHERE id = 1').get()).toBeTruthy();
});

test('moves onboarding_completed_at to settings as a site-level key', () => {
  db.prepare(`
    INSERT INTO auth_account (id, username, password_hash, password_salt, onboarding_completed_at, created_at)
    VALUES (1, 'operator', 'h', 's', 5000, 1000)
  `).run();

  migrateAuthAccountToUsers(db);

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'onboarding_completed_at'").get();
  expect(setting.value).toBe('5000');
});

test('does not write an onboarding_completed_at setting when onboarding was never completed', () => {
  db.prepare(`
    INSERT INTO auth_account (id, username, password_hash, password_salt, created_at)
    VALUES (1, 'operator', 'h', 's', 1000)
  `).run();

  migrateAuthAccountToUsers(db);

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'onboarding_completed_at'").get();
  expect(setting).toBeUndefined();
});

test('reassigns existing open sessions to the new admin so nobody is logged out on upgrade', () => {
  db.prepare(`
    INSERT INTO auth_account (id, username, password_hash, password_salt, created_at)
    VALUES (1, 'operator', 'h', 's', 1000)
  `).run();
  db.prepare(`
    INSERT INTO auth_sessions (token, created_at, expires_at) VALUES ('tok1', 1000, 999999999999)
  `).run();

  const result = migrateAuthAccountToUsers(db);

  const session = db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get('tok1');
  expect(session.user_id).toBe(result.userId);
});

test('is a no-op if users already has rows (never re-migrates)', () => {
  db.prepare(`
    INSERT INTO auth_account (id, username, password_hash, password_salt, created_at)
    VALUES (1, 'operator', 'h', 's', 1000)
  `).run();
  db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
    VALUES ('already-migrated-admin', 'h2', 's2', 'admin', 1, 0, 1)
  `).run();

  const result = migrateAuthAccountToUsers(db);
  expect(result).toEqual({ migrated: false });
  expect(db.prepare('SELECT COUNT(*) AS c FROM users').get().c).toBe(1);
});
