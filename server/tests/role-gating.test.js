// Regression coverage for CLAUDE.md's non-negotiable #1 ("part counts are sacred") as
// it intersects with role-based route gating: adding blockViewerWrites() in front of
// set-ready / recommission / set-ready-batch must not alter the completed_qty
// crediting logic those routes already had, only decide whether a request reaches it.
//
// These handlers replicate the real ones in server/index.js (which live inside the
// listen() callback with closures over db/scheduler, the same reason
// server/tests/set-ready.test.js does this rather than importing server/index.js (see
// CLAUDE.md's "heavyweight test" rule), now wrapped with the actual
// requireAuth/blockViewerWrites middleware from server/auth.js so the gate itself is
// exercised for real, not re-implemented.
//
// Proof required: an operator gets exactly the same completed_qty delta as before this
// change; a viewer gets 403 and completed_qty is untouched.

const request  = require('supertest');
const express  = require('express');
const Database = require('better-sqlite3');

const { requireAuth, blockViewerWrites, createSession, hashPassword } = require('../auth');

function authSchema(db) {
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

function seedUser(db, role) {
  const { hash, salt } = hashPassword('supersecret1');
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, is_active, must_change_password, created_at)
    VALUES (?, ?, ?, ?, 1, 0, ?)
  `).run(`user-${role}`, hash, salt, role, Date.now());
  return info.lastInsertRowid;
}

function cookieFor(db, userId) {
  const token = createSession(db, userId);
  return `coma_session=${token}`;
}

function domainSchema(db) {
  db.exec(`
    CREATE TABLE printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, ip TEXT NOT NULL,
      model TEXT NOT NULL, type TEXT DEFAULT 'bambu',
      status TEXT DEFAULT 'FINISHED',
      is_held INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, status TEXT DEFAULT 'active',
      priority INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL, name TEXT NOT NULL,
      target_qty INTEGER NOT NULL, completed_qty INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open', sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE gcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL, printer_model TEXT NOT NULL,
      filename TEXT NOT NULL, filepath TEXT NOT NULL,
      parts_per_plate INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL, printer_id INTEGER NOT NULL,
      gcode_id INTEGER NOT NULL, parts_per_plate INTEGER NOT NULL,
      status TEXT DEFAULT 'queued',
      started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL
    );
  `);
}

function seedFleet(db) {
  const now = Date.now();
  const printerId = db.prepare(`
    INSERT INTO printers (name, ip, model, status, is_held, is_active, created_at)
    VALUES (?, '10.0.0.1', 'mk4s', 'FINISHED', 1, 1, ?)
  `).run(`P_${now}_${Math.random()}`, now).lastInsertRowid;
  const projectId = db.prepare(
    `INSERT INTO projects (name, status, priority, created_at, updated_at) VALUES ('Proj', 'active', 0, ?, ?)`
  ).run(now, now).lastInsertRowid;
  const partId = db.prepare(`
    INSERT INTO parts (project_id, name, target_qty, completed_qty, status, sort_order, created_at, updated_at)
    VALUES (?, 'Part A', 10, 0, 'open', 0, ?, ?)
  `).run(projectId, now, now).lastInsertRowid;
  const gcodeId = db.prepare(`
    INSERT INTO gcodes (part_id, printer_model, filename, filepath, parts_per_plate, created_at)
    VALUES (?, 'mk4s', 'test.bgcode', 'test.bgcode', 4, ?)
  `).run(partId, now).lastInsertRowid;
  // Missed-finish scenario: job still 'printing' (server was down when the print
  // completed). Set Ready is the explicit success confirmation that credits qty.
  const jobId = db.prepare(`
    INSERT INTO jobs (part_id, printer_id, gcode_id, parts_per_plate, status, started_at, finished_at, created_at)
    VALUES (?, ?, ?, 4, 'printing', ?, NULL, ?)
  `).run(partId, printerId, gcodeId, now - 3600_000, now - 3600_000).lastInsertRowid;
  return { printerId, projectId, partId, gcodeId, jobId };
}

// Trimmed replica of the missed-finish branch of POST /api/printers/:id/set-ready in
// server/index.js: no finished job, an active 'printing' job exists, operator confirms
// good: credit parts_per_plate (or confirmed_qty) to completed_qty and mark the job
// finished. This is the exact crediting logic under test; only the middleware wrapping
// it is new.
function buildApp(db) {
  const scheduler = { scheduleForPrinter: jest.fn(), startedAt: 0 };
  const app = express();
  app.use(express.json());
  app.use(requireAuth(db));
  app.use(blockViewerWrites());

  app.post('/api/printers/:id/set-ready', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    const { confirmed_qty } = req.body || {};
    const now = Date.now();

    const activeJob = db.prepare(
      "SELECT * FROM jobs WHERE printer_id = ? AND status = 'printing' ORDER BY started_at DESC LIMIT 1"
    ).get(printer.id);
    if (!activeJob) return res.status(404).json({ error: 'No active job' });

    const creditQty = (confirmed_qty != null && !isNaN(parseInt(confirmed_qty, 10)))
      ? parseInt(confirmed_qty, 10)
      : activeJob.parts_per_plate;

    db.prepare(`UPDATE jobs SET status = 'finished', finished_at = ? WHERE id = ?`).run(now, activeJob.id);
    db.prepare(`UPDATE parts SET completed_qty = completed_qty + ?, updated_at = ? WHERE id = ?`)
      .run(creditQty, now, activeJob.part_id);
    db.prepare('UPDATE printers SET is_held = 0 WHERE id = ?').run(printer.id);

    scheduler.scheduleForPrinter(printer);
    res.json({ ok: true, credited: creditQty });
  });

  app.post('/api/printers/:id/recommission', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    db.prepare('UPDATE printers SET is_active = 1, is_held = 0 WHERE id = ?').run(printer.id);
    res.json({ ok: true });
  });

  return app;
}

let db;

beforeEach(() => {
  db = new Database(':memory:');
  authSchema(db);
  domainSchema(db);
});

describe('POST /api/printers/:id/set-ready: role gating does not alter crediting', () => {
  test('operator gets exactly the same completed_qty delta as before this change', async () => {
    const { printerId, partId, jobId } = seedFleet(db);
    const operatorId = seedUser(db, 'operator');
    const app = buildApp(db);

    const res = await request(app)
      .post(`/api/printers/${printerId}/set-ready`)
      .set('Cookie', cookieFor(db, operatorId))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.credited).toBe(4);

    const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(partId);
    expect(part.completed_qty).toBe(4); // unchanged crediting logic: full parts_per_plate

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('finished');

    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(printerId);
    expect(printer.is_held).toBe(0);
  });

  test('operator with a confirmed_qty override gets the same delta as before this change', async () => {
    const { printerId, partId } = seedFleet(db);
    const operatorId = seedUser(db, 'operator');
    const app = buildApp(db);

    const res = await request(app)
      .post(`/api/printers/${printerId}/set-ready`)
      .set('Cookie', cookieFor(db, operatorId))
      .send({ confirmed_qty: 3 });

    expect(res.status).toBe(200);
    expect(res.body.credited).toBe(3);
    expect(db.prepare('SELECT completed_qty FROM parts WHERE id = ?').get(partId).completed_qty).toBe(3);
  });

  test('manager and admin also credit normally (only viewer is blocked)', async () => {
    for (const role of ['manager', 'admin']) {
      const { printerId, partId } = seedFleet(db);
      const userId = seedUser(db, role);
      const app = buildApp(db);

      const res = await request(app)
        .post(`/api/printers/${printerId}/set-ready`)
        .set('Cookie', cookieFor(db, userId))
        .send({});
      expect(res.status).toBe(200);
      expect(db.prepare('SELECT completed_qty FROM parts WHERE id = ?').get(partId).completed_qty).toBe(4);
    }
  });

  test('viewer gets 403 and completed_qty is left completely untouched', async () => {
    const { printerId, partId, jobId } = seedFleet(db);
    const viewerId = seedUser(db, 'viewer');
    const app = buildApp(db);

    const res = await request(app)
      .post(`/api/printers/${printerId}/set-ready`)
      .set('Cookie', cookieFor(db, viewerId))
      .send({});

    expect(res.status).toBe(403);

    // Nothing about the domain state moved: same non-negotiable as a plain 404/400
    // rejection would have to honor.
    const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(partId);
    expect(part.completed_qty).toBe(0);
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('printing');
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(printerId);
    expect(printer.is_held).toBe(1);
  });

  test('an unauthenticated request is 401, not 403, and does not touch completed_qty', async () => {
    const { printerId, partId } = seedFleet(db);
    const app = buildApp(db);
    const res = await request(app).post(`/api/printers/${printerId}/set-ready`).send({});
    expect(res.status).toBe(401);
    expect(db.prepare('SELECT completed_qty FROM parts WHERE id = ?').get(partId).completed_qty).toBe(0);
  });
});

describe('POST /api/printers/:id/recommission: role gating', () => {
  test('viewer is blocked, operator is not', async () => {
    const { printerId } = seedFleet(db);
    const viewerId = seedUser(db, 'viewer');
    const app = buildApp(db);

    const blocked = await request(app)
      .post(`/api/printers/${printerId}/recommission`)
      .set('Cookie', cookieFor(db, viewerId));
    expect(blocked.status).toBe(403);
    expect(db.prepare('SELECT is_held FROM printers WHERE id = ?').get(printerId).is_held).toBe(1);

    const operatorId = seedUser(db, 'operator');
    const allowed = await request(app)
      .post(`/api/printers/${printerId}/recommission`)
      .set('Cookie', cookieFor(db, operatorId));
    expect(allowed.status).toBe(200);
    expect(db.prepare('SELECT is_held FROM printers WHERE id = ?').get(printerId).is_held).toBe(0);
  });
});
