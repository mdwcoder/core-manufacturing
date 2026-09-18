// Coverage for server/routes/audit-log.js (GET /api/audit-log, manager+ read-only) and
// server/audit.js (the log() helper it reads back).

const request  = require('supertest');
const express  = require('express');
const Database = require('better-sqlite3');

const audit = require('../audit');
const { createSession, hashPassword } = require('../auth');

let db;
let app;

function schema() {
  db.exec(`
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
    CREATE TABLE auth_sessions (
      token         TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      user_id       INTEGER,
      user_agent    TEXT,
      ip            TEXT,
      last_seen_at  INTEGER
    );
    CREATE TABLE audit_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER,
      username     TEXT,
      action       TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    INTEGER,
      note         TEXT,
      ip           TEXT,
      created_at   INTEGER NOT NULL
    );
  `);
}

function seedUser(role) {
  const { hash, salt } = hashPassword('supersecret1');
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
    VALUES (?, ?, ?, ?, 1, 0, ?)
  `).run(`user-${role}-${Math.random()}`, hash, salt, role, Date.now());
  return info.lastInsertRowid;
}

function cookieAs(role) {
  const userId = seedUser(role);
  const token = createSession(db, userId);
  return `coma_session=${token}`;
}

beforeEach(() => {
  db = new Database(':memory:');
  schema();
  jest.resetModules();
  app = express();
  app.use(express.json());
  app.use('/api/audit-log', require('../routes/audit-log')(db));
});

describe('audit.log()', () => {
  test('writes a row with the given user, action, and metadata', () => {
    audit.log(db, { id: 3, username: 'alice' }, 'user.create', { entityType: 'user', entityId: 7, note: 'role=operator', ip: '10.0.0.5' });
    const row = db.prepare('SELECT * FROM audit_log').get();
    expect(row.user_id).toBe(3);
    expect(row.username).toBe('alice');
    expect(row.action).toBe('user.create');
    expect(row.entity_type).toBe('user');
    expect(row.entity_id).toBe(7);
    expect(row.note).toBe('role=operator');
    expect(row.ip).toBe('10.0.0.5');
    expect(typeof row.created_at).toBe('number');
  });

  test('accepts a user with no id (failed login attempt), storing the attempted username if given', () => {
    audit.log(db, { username: 'ghost' }, 'auth.login_failed', { ip: '10.0.0.9' });
    const row = db.prepare('SELECT * FROM audit_log').get();
    expect(row.user_id).toBeNull();
    expect(row.username).toBe('ghost');
  });
});

describe('GET /api/audit-log', () => {
  test('requires an active session', async () => {
    expect((await request(app).get('/api/audit-log')).status).toBe(401);
  });

  test('requires manager or above', async () => {
    expect((await request(app).get('/api/audit-log').set('Cookie', cookieAs('operator'))).status).toBe(403);
    expect((await request(app).get('/api/audit-log').set('Cookie', cookieAs('viewer'))).status).toBe(403);
  });

  test('manager and admin can read it', async () => {
    audit.log(db, { id: 1, username: 'admin1' }, 'auth.login', {});
    expect((await request(app).get('/api/audit-log').set('Cookie', cookieAs('manager'))).status).toBe(200);
    expect((await request(app).get('/api/audit-log').set('Cookie', cookieAs('admin'))).status).toBe(200);
  });

  test('returns rows newest first, with total/limit/offset', async () => {
    audit.log(db, { id: 1 }, 'action.one', {});
    audit.log(db, { id: 1 }, 'action.two', {});
    const res = await request(app).get('/api/audit-log').set('Cookie', cookieAs('manager'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.rows.length).toBe(2);
    expect(res.body.rows[0].action).toBe('action.two'); // newest first
  });

  test('filters by user_id, action, entity_type, and date range', async () => {
    const t0 = Date.now() - 10_000;
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, created_at) VALUES (1, 'user.create', 'user', ?)`).run(t0);
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, created_at) VALUES (2, 'user.delete', 'user', ?)`).run(t0 + 1000);
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, created_at) VALUES (1, 'printer.set_ready', 'printer', ?)`).run(t0 + 2000);
    const cookie = cookieAs('manager');

    const byUser = await request(app).get('/api/audit-log').set('Cookie', cookie).query({ user_id: 1 });
    expect(byUser.body.total).toBe(2);

    const byAction = await request(app).get('/api/audit-log').set('Cookie', cookie).query({ action: 'user.delete' });
    expect(byAction.body.total).toBe(1);

    const byEntity = await request(app).get('/api/audit-log').set('Cookie', cookie).query({ entity_type: 'printer' });
    expect(byEntity.body.total).toBe(1);

    const byRange = await request(app).get('/api/audit-log').set('Cookie', cookie).query({ from: t0 + 500, to: t0 + 1500 });
    expect(byRange.body.total).toBe(1);
    expect(byRange.body.rows[0].action).toBe('user.delete');
  });

  test('paginates with limit/offset and caps limit at 200', async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO audit_log (action, created_at) VALUES ('a', ?)`).run(Date.now() + i);
    }
    const cookie = cookieAs('manager');
    const page = await request(app).get('/api/audit-log').set('Cookie', cookie).query({ limit: 2, offset: 1 });
    expect(page.body.rows.length).toBe(2);
    expect(page.body.total).toBe(5);
    expect(page.body.limit).toBe(2);
    expect(page.body.offset).toBe(1);

    const capped = await request(app).get('/api/audit-log').set('Cookie', cookie).query({ limit: 9999 });
    expect(capped.body.limit).toBe(200);
  });
});
