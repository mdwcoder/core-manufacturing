// Coverage for server/rate-limit.js: the in-memory sliding-window limiter mounted on
// POST /api/auth/login, POST /api/auth/register, and POST /api/users/:id/reset-password.
//
// Real-world trigger: the login gate has no CSRF token or TLS requirement documented,
// and had zero protection against an automated password-guessing loop against a known
// username. This bounds repeated attempts per IP+username without a new dependency.

const express = require('express');
const request = require('supertest');

const { rateLimit, loginKey, resetPasswordKey, _resetForTests, DEFAULT_MAX_ATTEMPTS } = require('../rate-limit');

beforeEach(() => {
  _resetForTests();
});

function appWithLimiter(opts) {
  const app = express();
  app.use(express.json());
  app.post('/attempt', rateLimit(opts), (req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimit()', () => {
  test('allows up to the configured max attempts, then 429s', async () => {
    const app = appWithLimiter({ windowMs: 60_000, max: 3, keyFn: loginKey });
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/attempt').send({ username: 'alice' });
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/attempt').send({ username: 'alice' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  test('tracks distinct usernames independently under the same IP', async () => {
    const app = appWithLimiter({ windowMs: 60_000, max: 1, keyFn: loginKey });
    expect((await request(app).post('/attempt').send({ username: 'alice' })).status).toBe(200);
    expect((await request(app).post('/attempt').send({ username: 'alice' })).status).toBe(429);
    // A different username from the same IP is not blocked by alice's attempts.
    expect((await request(app).post('/attempt').send({ username: 'bob' })).status).toBe(200);
  });

  test('username matching is case-insensitive and trims whitespace (same account, same limit)', async () => {
    const app = appWithLimiter({ windowMs: 60_000, max: 1, keyFn: loginKey });
    expect((await request(app).post('/attempt').send({ username: 'Alice' })).status).toBe(200);
    expect((await request(app).post('/attempt').send({ username: ' alice ' })).status).toBe(429);
  });

  test('an old attempt outside the window no longer counts', async () => {
    const app = appWithLimiter({ windowMs: 50, max: 1, keyFn: loginKey });
    expect((await request(app).post('/attempt').send({ username: 'alice' })).status).toBe(200);
    expect((await request(app).post('/attempt').send({ username: 'alice' })).status).toBe(429);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect((await request(app).post('/attempt').send({ username: 'alice' })).status).toBe(200);
  });

  test('keyFn returning null/undefined skips limiting entirely', async () => {
    const app = appWithLimiter({ windowMs: 60_000, max: 1, keyFn: () => null });
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/attempt').send({})).status).toBe(200);
    }
  });

  test('defaults to DEFAULT_MAX_ATTEMPTS when max is not overridden', async () => {
    const app = appWithLimiter({ keyFn: loginKey });
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
      expect((await request(app).post('/attempt').send({ username: 'carol' })).status).toBe(200);
    }
    expect((await request(app).post('/attempt').send({ username: 'carol' })).status).toBe(429);
  });
});

describe('resetPasswordKey()', () => {
  test('keys by IP and the target user id from req.params', async () => {
    const app = express();
    app.use(express.json());
    app.post('/users/:id/reset-password', rateLimit({ windowMs: 60_000, max: 1, keyFn: resetPasswordKey }), (req, res) => res.json({ ok: true }));

    expect((await request(app).post('/users/7/reset-password')).status).toBe(200);
    expect((await request(app).post('/users/7/reset-password')).status).toBe(429);
    // A different target user is a different key, not affected by user 7's limit.
    expect((await request(app).post('/users/8/reset-password')).status).toBe(200);
  });
});
