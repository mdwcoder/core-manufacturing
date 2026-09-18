// Coverage for server/routes/users.js: admin user management, the self password-change
// route, and the last-active-admin guard.
//
// Real-world trigger: with roles in place, someone has to be able to add operators, and
// there has to be a way to recover a locked-out account without SMTP.

const request  = require('supertest');
const express  = require('express');
const Database = require('better-sqlite3');

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

function seedUser(role, opts = {}) {
  const { hash, salt } = hashPassword(opts.password || 'supersecret1');
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(opts.username || `user-${role}-${Math.random()}`, hash, salt, role, opts.is_active ?? 1, opts.mustChange ? 1 : 0, Date.now());
  return info.lastInsertRowid;
}

function agentFor(userId) {
  const token = createSession(db, userId);
  const cookie = `coma_session=${token}`;
  return {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    post: (url) => request(app).post(url).set('Cookie', cookie),
    put: (url) => request(app).put(url).set('Cookie', cookie),
    delete: (url) => request(app).delete(url).set('Cookie', cookie),
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  schema();
  jest.resetModules();
  app = express();
  app.use(express.json());
  app.use('/api/users', require('../routes/users')(db));
});

describe('GET /api/users', () => {
  test('requires manager or above', async () => {
    const operatorId = seedUser('operator');
    const agent = agentFor(operatorId);
    expect((await agent.get('/api/users')).status).toBe(403);
  });

  test('manager can list users without password fields', async () => {
    seedUser('admin');
    const managerId = seedUser('manager');
    const agent = agentFor(managerId);
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    for (const u of res.body) {
      expect(u.password_hash).toBeUndefined();
      expect(u.password_salt).toBeUndefined();
    }
  });
});

describe('POST /api/users', () => {
  test('requires admin', async () => {
    const managerId = seedUser('manager');
    const agent = agentFor(managerId);
    const res = await agent.post('/api/users').send({ username: 'newbie', role: 'operator' });
    expect(res.status).toBe(403);
  });

  test('admin creates a user with a random temporary password and must_change_password set', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);
    const res = await agent.post('/api/users').send({ username: 'newbie', role: 'operator' });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('newbie');
    expect(res.body.user.role).toBe('operator');
    expect(res.body.user.must_change_password).toBe(1);
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.user.password_hash).toBeUndefined();

    const row = db.prepare('SELECT * FROM users WHERE username = ?').get('newbie');
    expect(row.created_by).toBe(adminId);
  });

  test('rejects a duplicate username and an invalid role', async () => {
    const adminId = seedUser('admin', { username: 'admin1' });
    const agent = agentFor(adminId);
    expect((await agent.post('/api/users').send({ username: 'admin1', role: 'operator' })).status).toBe(409);
    expect((await agent.post('/api/users').send({ username: 'x', role: 'superuser' })).status).toBe(400);
    expect((await agent.post('/api/users').send({ role: 'operator' })).status).toBe(400);
  });
});

describe('PUT /api/users/:id', () => {
  test('changes role and active state with COALESCE semantics', async () => {
    const adminId = seedUser('admin');
    const targetId = seedUser('operator');
    const agent = agentFor(adminId);

    const roleRes = await agent.put(`/api/users/${targetId}`).send({ role: 'manager' });
    expect(roleRes.status).toBe(200);
    expect(roleRes.body.role).toBe('manager');
    expect(roleRes.body.is_active).toBe(1); // untouched

    const activeRes = await agent.put(`/api/users/${targetId}`).send({ is_active: 0 });
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.is_active).toBe(0);
    expect(activeRes.body.role).toBe('manager'); // untouched
  });

  test('deactivating a user revokes their open sessions', async () => {
    const adminId = seedUser('admin');
    const targetId = seedUser('operator');
    createSession(db, targetId);
    const agent = agentFor(adminId);

    await agent.put(`/api/users/${targetId}`).send({ is_active: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ?').get(targetId).c).toBe(0);
  });

  test('404s an unknown user', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);
    expect((await agent.put('/api/users/999999').send({ role: 'operator' })).status).toBe(404);
  });

  test('blocks demoting or deactivating the last active admin', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);
    expect((await agent.put(`/api/users/${adminId}`).send({ role: 'operator' })).status).toBe(409);
    expect((await agent.put(`/api/users/${adminId}`).send({ is_active: 0 })).status).toBe(409);
  });

  test('allows demoting an admin when another active admin remains', async () => {
    const adminId = seedUser('admin');
    seedUser('admin');
    const agent = agentFor(adminId);
    const res = await agent.put(`/api/users/${adminId}`).send({ role: 'manager' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/users/:id', () => {
  test('blocks deleting the last active admin', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);
    expect((await agent.delete(`/api/users/${adminId}`)).status).toBe(409);
  });

  test('deletes a user and revokes their sessions', async () => {
    const adminId = seedUser('admin');
    const targetId = seedUser('operator');
    createSession(db, targetId);
    const agent = agentFor(adminId);

    const res = await agent.delete(`/api/users/${targetId}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ?').get(targetId).c).toBe(0);
  });
});

describe('POST /api/users/:id/reset-password', () => {
  test('requires admin', async () => {
    const managerId = seedUser('manager');
    const targetId = seedUser('operator');
    const agent = agentFor(managerId);
    expect((await agent.post(`/api/users/${targetId}/reset-password`)).status).toBe(403);
  });

  test('generates a new temporary password, forces a change, and revokes sessions', async () => {
    const adminId = seedUser('admin');
    const targetId = seedUser('operator');
    createSession(db, targetId);
    const agent = agentFor(adminId);

    const res = await agent.post(`/api/users/${targetId}/reset-password`);
    expect(res.status).toBe(200);
    expect(typeof res.body.temporaryPassword).toBe('string');

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    expect(row.must_change_password).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ?').get(targetId).c).toBe(0);
  });
});

describe('POST /api/users/me/password', () => {
  test('requires the correct current password', async () => {
    const userId = seedUser('operator', { password: 'supersecret1' });
    const agent = agentFor(userId);
    const res = await agent.post('/api/users/me/password').send({ currentPassword: 'wrong', newPassword: 'brandnewpass1' });
    expect(res.status).toBe(401);
  });

  test('rejects a new password shorter than 8 characters', async () => {
    const userId = seedUser('operator', { password: 'supersecret1' });
    const agent = agentFor(userId);
    const res = await agent.post('/api/users/me/password').send({ currentPassword: 'supersecret1', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  test('changes the password and clears must_change_password', async () => {
    const userId = seedUser('operator', { password: 'supersecret1', mustChange: true });
    const agent = agentFor(userId);
    const res = await agent.post('/api/users/me/password').send({ currentPassword: 'supersecret1', newPassword: 'brandnewpass1' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    expect(row.must_change_password).toBe(0);

    // The old password no longer works for anything that would re-check it directly.
    const { verifyPassword } = require('../auth');
    expect(verifyPassword('brandnewpass1', row.password_hash, row.password_salt)).toBe(true);
    expect(verifyPassword('supersecret1', row.password_hash, row.password_salt)).toBe(false);
  });
});

describe('GET /api/users/export', () => {
  test('requires admin', async () => {
    const managerId = seedUser('manager');
    const agent = agentFor(managerId);
    expect((await agent.get('/api/users/export')).status).toBe(403);
  });

  test('exports username/role/is_active, never a password hash or salt', async () => {
    const adminId = seedUser('admin', { username: 'admin1' });
    seedUser('operator', { username: 'shift-lead' });
    const agent = agentFor(adminId);

    const res = await agent.get('/api/users/export');
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(2);
    for (const u of res.body.users) {
      expect(Object.keys(u).sort()).toEqual(['is_active', 'role', 'username']);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
  });
});

describe('POST /api/users/import', () => {
  test('requires admin', async () => {
    const managerId = seedUser('manager');
    const agent = agentFor(managerId);
    const res = await agent.post('/api/users/import').send({ users: [{ username: 'x', role: 'operator' }] });
    expect(res.status).toBe(403);
  });

  test('creates each user with a fresh random temporary password and must_change_password set', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);

    const res = await agent.post('/api/users/import').send({
      users: [
        { username: 'imported-op', role: 'operator', is_active: 1 },
        { username: 'imported-viewer', role: 'viewer', is_active: 0 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.created.length).toBe(2);
    expect(res.body.skipped.length).toBe(0);

    for (const c of res.body.created) {
      expect(typeof c.temporaryPassword).toBe('string');
      expect(c.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    }
    // Every created user's password is unique, not a shared/default one.
    const passwords = res.body.created.map(c => c.temporaryPassword);
    expect(new Set(passwords).size).toBe(passwords.length);

    const op = db.prepare('SELECT * FROM users WHERE username = ?').get('imported-op');
    expect(op.role).toBe('operator');
    expect(op.is_active).toBe(1);
    expect(op.must_change_password).toBe(1);

    const viewer = db.prepare('SELECT * FROM users WHERE username = ?').get('imported-viewer');
    expect(viewer.is_active).toBe(0);
  });

  test('skips an existing username without overwriting it, and reports why', async () => {
    const adminId = seedUser('admin');
    seedUser('operator', { username: 'already-here' });
    const agent = agentFor(adminId);

    const before = db.prepare('SELECT * FROM users WHERE username = ?').get('already-here');

    const res = await agent.post('/api/users/import').send({
      users: [{ username: 'already-here', role: 'admin' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.created.length).toBe(0);
    expect(res.body.skipped).toEqual([{ username: 'already-here', reason: 'username already exists' }]);

    const after = db.prepare('SELECT * FROM users WHERE username = ?').get('already-here');
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.role).toBe('operator'); // unchanged, not promoted to admin
  });

  test('rejects a non-array body', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);
    const res = await agent.post('/api/users/import').send({ users: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('skips an invalid role instead of throwing', async () => {
    const adminId = seedUser('admin');
    const agent = agentFor(adminId);
    const res = await agent.post('/api/users/import').send({
      users: [{ username: 'bad-role', role: 'superuser' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.created.length).toBe(0);
    expect(res.body.skipped[0].username).toBe('bad-role');
  });
});
