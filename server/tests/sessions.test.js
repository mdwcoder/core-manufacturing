// Coverage for server/routes/sessions.js: listing and revoking sessions, for the
// caller's own account and (for admins) for other users.
//
// Real-world trigger: with named accounts and roles, an operator needs a way to see
// "am I still logged in on the shop floor tablet" and an admin needs a way to sign a
// departed or compromised account out everywhere without knowing its password.

const request  = require('supertest');
const express  = require('express');
const Database = require('better-sqlite3');

const { requireAuth, createSession, hashPassword } = require('../auth');
const { selfRouter, adminRouter, displayId } = require('../routes/sessions');

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
  `);
}

function createUser(role = 'operator') {
  const { hash, salt } = hashPassword('supersecret1');
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
    VALUES (?, ?, ?, ?, 1, 0, ?)
  `).run(`user-${role}-${Math.random()}`, hash, salt, role, Date.now());
  return info.lastInsertRowid;
}

// A minimal stand-in for request.agent(app) that carries one fixed session cookie
// across calls, without relying on superagent's cookie-jar internals.
function agentFor(userId) {
  const token = createSession(db, userId, { userAgent: 'jest', ip: '127.0.0.1' });
  const cookie = `coma_session=${token}`;
  return {
    get: (url) => request(app).get(url).set('Cookie', cookie),
    delete: (url) => request(app).delete(url).set('Cookie', cookie),
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  schema();
  jest.resetModules();

  app = express();
  app.use(express.json());
  app.use('/api/sessions', selfRouter(db));
  app.use('/api/users/:id/sessions', adminRouter(db));
});

describe('GET/DELETE /api/sessions (self)', () => {
  test('requires auth', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
  });

  test('lists only the caller\'s own sessions, marking the current one', async () => {
    const userId = createUser('operator');
    const otherUserId = createUser('operator');
    createSession(db, otherUserId); // belongs to someone else, must not appear

    const agent = agentFor(userId);
    const res = await agent.get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].current).toBe(true);
    expect(res.body[0].display_id).toHaveLength(16);
    // The raw token is never exposed.
    expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{64}/);
  });

  test('DELETE /api/sessions/:displayId revokes one of the caller\'s own sessions', async () => {
    const userId = createUser('operator');
    const secondToken = createSession(db, userId);

    const agent = agentFor(userId);
    const before = await agent.get('/api/sessions');
    expect(before.body.length).toBe(2);

    const target = before.body.find(s => !s.current);
    const del = await agent.delete(`/api/sessions/${target.display_id}`);
    expect(del.status).toBe(200);

    const after = await agent.get('/api/sessions');
    expect(after.body.length).toBe(1);
    expect(db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(secondToken)).toBeUndefined();
  });

  test('DELETE /api/sessions/:displayId 404s for a session belonging to someone else', async () => {
    const userId = createUser('operator');
    const otherUserId = createUser('operator');
    const otherToken = createSession(db, otherUserId);

    const agent = agentFor(userId);
    const res = await agent.delete(`/api/sessions/${displayId(otherToken)}`);
    expect(res.status).toBe(404);
    expect(db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(otherToken)).toBeTruthy();
  });

  test('DELETE /api/sessions revokes every other session but keeps the caller signed in', async () => {
    const userId = createUser('operator');
    createSession(db, userId);
    createSession(db, userId);

    const agent = agentFor(userId);
    const del = await agent.delete('/api/sessions');
    expect(del.status).toBe(200);
    expect(del.body.revoked).toBe(2);

    const after = await agent.get('/api/sessions');
    expect(after.status).toBe(200);
    expect(after.body.length).toBe(1);
    expect(after.body[0].current).toBe(true);
  });
});

describe('GET/DELETE /api/users/:id/sessions (admin)', () => {
  test('403s a non-admin', async () => {
    const operatorId = createUser('operator');
    const targetId = createUser('operator');
    const agent = agentFor(operatorId);
    expect((await agent.get(`/api/users/${targetId}/sessions`)).status).toBe(403);
  });

  test('404s for an unknown user id', async () => {
    const adminId = createUser('admin');
    const agent = agentFor(adminId);
    expect((await agent.get('/api/users/999999/sessions')).status).toBe(404);
  });

  test('an admin can list and revoke another user\'s sessions', async () => {
    const adminId = createUser('admin');
    const targetId = createUser('operator');
    const targetToken = createSession(db, targetId);

    const agent = agentFor(adminId);
    const list = await agent.get(`/api/users/${targetId}/sessions`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const del = await agent.delete(`/api/users/${targetId}/sessions/${displayId(targetToken)}`);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(targetToken)).toBeUndefined();
  });

  test('an admin can revoke every session for a user in one call', async () => {
    const adminId = createUser('admin');
    const targetId = createUser('operator');
    createSession(db, targetId);
    createSession(db, targetId);

    const agent = agentFor(adminId);
    const del = await agent.delete(`/api/users/${targetId}/sessions`);
    expect(del.status).toBe(200);
    expect(del.body.revoked).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ?').get(targetId).c).toBe(0);
  });
});
