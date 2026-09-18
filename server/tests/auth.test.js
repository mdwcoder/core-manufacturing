// Coverage for local authentication: server/auth.js (hashing, sessions, cookie helpers,
// requireAuth/requireRole/requireMinRole/blockViewerWrites) and server/routes/auth.js
// (register/login/logout/status/complete-onboarding/delete-account).
//
// Real-world trigger: CoMa had no authentication at all, so anyone on the LAN who could
// reach the web UI could dispatch jobs, delete parts, or wipe the fleet via restore. This
// adds named accounts with roles that gate the whole app on first run, plus a one-time
// setup guide that runs once per installation.

const request  = require('supertest');
const express  = require('express');
const Database = require('better-sqlite3');

const { requireAuth, requireRole, requireMinRole, blockViewerWrites, blockOnForcedPasswordChange, requireCsrfHeader } = require('../auth');

let db;
let app;

function schema() {
  db.exec(`
    CREATE TABLE users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      username              TEXT NOT NULL UNIQUE,
      password_hash         TEXT NOT NULL,
      password_salt         TEXT NOT NULL,
      role                  TEXT NOT NULL DEFAULT 'operator'
                              CHECK (role IN ('admin','manager','operator','viewer')),
      is_active             INTEGER NOT NULL DEFAULT 1,
      must_change_password  INTEGER NOT NULL DEFAULT 0,
      created_at            INTEGER NOT NULL,
      created_by            INTEGER REFERENCES users(id)
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
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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

beforeEach(() => {
  db = new Database(':memory:');
  schema();

  // server/routes/auth.js declares its Express router at module scope, like every route
  // file in this codebase (see the identical note in backup-restore.test.js). Without
  // resetting the module registry, a second require() in this same process would reuse
  // that router object (and every route handler already added to it, closing over a
  // previous test's now-stale db) instead of building fresh ones around this test's db.
  jest.resetModules();
  app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth')(db));

  // A dummy protected route, mounted the same way server/index.js gates every other
  // /api/* route, to exercise requireAuth() itself against a real cookie round trip.
  app.get('/api/protected', requireAuth(db), (req, res) => res.json({ ok: true, role: req.user.role }));
  app.post('/api/admin-only', requireAuth(db), requireRole('admin'), (req, res) => res.json({ ok: true }));
  app.get('/api/manager-up', requireAuth(db), requireMinRole('manager'), (req, res) => res.json({ ok: true }));
  app.post('/api/writeish', requireAuth(db), blockViewerWrites(), (req, res) => res.json({ ok: true }));
  app.get('/api/users/me/password', requireAuth(db), blockOnForcedPasswordChange(['/api/users/me/password']), (req, res) => res.json({ ok: true }));
  app.get('/api/anything-else', requireAuth(db), blockOnForcedPasswordChange(['/api/users/me/password']), (req, res) => res.json({ ok: true }));
  app.post('/api/csrf-check', requireCsrfHeader(), (req, res) => res.json({ ok: true }));
  app.get('/api/csrf-check', requireCsrfHeader(), (req, res) => res.json({ ok: true }));
});

describe('GET /api/auth/status', () => {
  test('reports no account on a fresh install', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasAccount: false, authenticated: false, onboardingCompleted: false });
  });
});

describe('POST /api/auth/register', () => {
  test('creates the first account as admin, logs the caller in, and blocks a second registration', async () => {
    const agent = request.agent(app);

    const res = await agent
      .post('/api/auth/register')
      .send({ username: 'operator', password: 'supersecret1' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, onboardingCompleted: false });

    const status = await agent.get('/api/auth/status');
    expect(status.body).toEqual({
      hasAccount: true,
      authenticated: true,
      onboardingCompleted: false,
      username: 'operator',
      role: 'admin',
      mustChangePassword: false,
    });

    const second = await request(app)
      .post('/api/auth/register')
      .send({ username: 'someone-else', password: 'anotherpassword' });
    expect(second.status).toBe(409);
  });

  test('rejects a missing username', async () => {
    const res = await request(app).post('/api/auth/register').send({ password: 'supersecret1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  test('rejects a password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'operator', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });
  });

  test('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('rejects a wrong username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'someone-else', password: 'supersecret1' });
    expect(res.status).toBe(401);
  });

  test('rejects a deactivated user even with the right password', async () => {
    db.prepare("UPDATE users SET is_active = 0 WHERE username = 'operator'").run();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'supersecret1' });
    expect(res.status).toBe(401);
  });

  test('logs in with the right credentials and sets a session cookie', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'supersecret1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.role).toBe('admin');

    const protectedRes = await agent.get('/api/protected');
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.role).toBe('admin');
  });

  test('rate limits repeated failed login attempts for the same IP+username', async () => {
    const { DEFAULT_MAX_ATTEMPTS } = require('../rate-limit');
    // The beforeEach register() call already used one of the shared login/register
    // attempts for this username, since both routes key on the same IP+username.
    for (let i = 1; i < DEFAULT_MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/api/auth/login').send({ username: 'operator', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ username: 'operator', password: 'wrongpassword' });
    expect(blocked.status).toBe(429);

    // A different username is not affected by operator's attempts.
    const otherUser = await request(app).post('/api/auth/login').send({ username: 'someone-else', password: 'x' });
    expect(otherUser.status).toBe(401);
  });
});

describe('requireAuth middleware', () => {
  test('401s a request with no session cookie', async () => {
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(401);
  });

  test('401s a request with a garbage cookie', async () => {
    const res = await request(app).get('/api/protected').set('Cookie', 'coma_session=not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('requireRole / requireMinRole / blockViewerWrites', () => {
  async function loginAs(role) {
    const now = Date.now();
    const { hashPassword } = require('../auth');
    const { hash, salt } = hashPassword('supersecret1');
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 1, 0, ?)
    `).run(`user-${role}`, hash, salt, role, now);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: `user-${role}`, password: 'supersecret1' });
    return agent;
  }

  test('requireRole(admin) 403s a non-admin', async () => {
    const agent = await loginAs('operator');
    const res = await agent.post('/api/admin-only');
    expect(res.status).toBe(403);
  });

  test('requireRole(admin) allows an admin', async () => {
    const agent = await loginAs('admin');
    const res = await agent.post('/api/admin-only');
    expect(res.status).toBe(200);
  });

  test('requireMinRole(manager) 403s an operator and a viewer', async () => {
    const operator = await loginAs('operator');
    expect((await operator.get('/api/manager-up')).status).toBe(403);
    const viewer = await loginAs('viewer');
    expect((await viewer.get('/api/manager-up')).status).toBe(403);
  });

  test('requireMinRole(manager) allows manager and admin', async () => {
    const manager = await loginAs('manager');
    expect((await manager.get('/api/manager-up')).status).toBe(200);
    const admin = await loginAs('admin');
    expect((await admin.get('/api/manager-up')).status).toBe(200);
  });

  test('blockViewerWrites 403s a viewer POST but allows operator/manager/admin POSTs', async () => {
    const viewer = await loginAs('viewer');
    expect((await viewer.post('/api/writeish')).status).toBe(403);

    for (const role of ['operator', 'manager', 'admin']) {
      const agent = await loginAs(role);
      expect((await agent.post('/api/writeish')).status).toBe(200);
    }
  });
});

describe('requireCsrfHeader', () => {
  test('403s a mutating request with no X-CoMa-Request header', async () => {
    const res = await request(app).post('/api/csrf-check');
    expect(res.status).toBe(403);
  });

  test('403s a mutating request with the wrong header value', async () => {
    const res = await request(app).post('/api/csrf-check').set('X-CoMa-Request', 'yes');
    expect(res.status).toBe(403);
  });

  test('allows a mutating request with the header set to 1', async () => {
    const res = await request(app).post('/api/csrf-check').set('X-CoMa-Request', '1');
    expect(res.status).toBe(200);
  });

  test('does not gate a GET request at all', async () => {
    const res = await request(app).get('/api/csrf-check');
    expect(res.status).toBe(200);
  });
});

describe('blockOnForcedPasswordChange', () => {
  async function loginWithForcedChange() {
    const { hashPassword } = require('../auth');
    const { hash, salt } = hashPassword('temp-password-1');
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES ('forced-user', ?, ?, 'operator', 1, 1, ?)
    `).run(hash, salt, Date.now());
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'forced-user', password: 'temp-password-1' });
    return agent;
  }

  test('blocks any route except the allowed one while must_change_password is set', async () => {
    const agent = await loginWithForcedChange();
    expect((await agent.get('/api/anything-else')).status).toBe(403);
    expect((await agent.get('/api/users/me/password')).status).toBe(200);
  });

  test('does not block a normal user (must_change_password = 0)', async () => {
    const now = Date.now();
    const { hashPassword } = require('../auth');
    const { hash, salt } = hashPassword('supersecret1');
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES ('normal-user', ?, ?, 'operator', 1, 0, ?)
    `).run(hash, salt, now);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'normal-user', password: 'supersecret1' });
    expect((await agent.get('/api/anything-else')).status).toBe(200);
  });
});

describe('POST /api/auth/complete-onboarding', () => {
  test('requires an active session', async () => {
    const res = await request(app).post('/api/auth/complete-onboarding');
    expect(res.status).toBe(401);
  });

  test('marks onboarding complete for the whole install, and it stays complete on the next login', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });

    const complete = await agent.post('/api/auth/complete-onboarding');
    expect(complete.status).toBe(200);

    const status = await agent.get('/api/auth/status');
    expect(status.body.onboardingCompleted).toBe(true);

    // A brand new session (e.g. a different browser tab, or after logout) must still see
    // onboarding as complete: it is a site-level settings key, not a per-account flag.
    const freshAgent = request.agent(app);
    const freshLogin = await freshAgent.post('/api/auth/login').send({ username: 'operator', password: 'supersecret1' });
    expect(freshLogin.body.onboardingCompleted).toBe(true);
  });
});

describe('POST /api/auth/delete-account', () => {
  test('requires an active session', async () => {
    const res = await request(app).post('/api/auth/delete-account').send({ password: 'supersecret1' });
    expect(res.status).toBe(401);
  });

  test('rejects the wrong password and leaves the account intact', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });

    const res = await agent.post('/api/auth/delete-account').send({ password: 'wrongpassword' });
    expect(res.status).toBe(401);

    const status = await agent.get('/api/auth/status');
    expect(status.body.hasAccount).toBe(true);
  });

  test('blocks deleting the last active admin', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });

    const del = await agent.post('/api/auth/delete-account').send({ password: 'supersecret1' });
    expect(del.status).toBe(409);

    const status = await agent.get('/api/auth/status');
    expect(status.body.hasAccount).toBe(true);
  });

  test('with a second admin present, deletes the caller and logs them out without touching the other admin', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });

    // A second admin, seeded directly (register only bootstraps the very first user;
    // every subsequent user comes from POST /api/users, added in a later commit).
    const { hashPassword } = require('../auth');
    const { hash, salt } = hashPassword('otherpassword');
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES ('other-admin', ?, ?, 'admin', 1, 0, ?)
    `).run(hash, salt, Date.now());

    const del = await agent.post('/api/auth/delete-account').send({ password: 'supersecret1' });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    // The deleted caller's session no longer authenticates.
    expect((await agent.get('/api/protected')).status).toBe(401);

    // The other admin's own login still works.
    const otherAgent = request.agent(app);
    const otherLogin = await otherAgent.post('/api/auth/login').send({ username: 'other-admin', password: 'otherpassword' });
    expect(otherLogin.status).toBe(200);
  });

  test('does not touch sessions belonging to other users', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });

    const { hashPassword } = require('../auth');
    const { hash, salt } = hashPassword('otherpassword');
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
      VALUES ('other-admin', ?, ?, 'admin', 1, 0, ?)
    `).run(hash, salt, Date.now());

    const otherAgent = request.agent(app);
    await otherAgent.post('/api/auth/login').send({ username: 'other-admin', password: 'otherpassword' });

    await agent.post('/api/auth/delete-account').send({ password: 'supersecret1' });

    expect((await otherAgent.get('/api/protected')).status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  test('clears the session so the same cookie no longer authenticates', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'operator', password: 'supersecret1' });
    expect((await agent.get('/api/protected')).status).toBe(200);

    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);

    expect((await agent.get('/api/protected')).status).toBe(401);
    const status = await agent.get('/api/auth/status');
    expect(status.body.authenticated).toBe(false);
    // The account itself is untouched by logout.
    expect(status.body.hasAccount).toBe(true);
  });
});
