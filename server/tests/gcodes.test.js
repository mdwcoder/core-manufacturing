const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// ── Minimal in-memory DB so tests don't touch the real database ──────────────
const Database = require('better-sqlite3');
let db;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      target_qty INTEGER NOT NULL,
      completed_qty INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE gcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      printer_model TEXT NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      parts_per_plate INTEGER NOT NULL,
      est_print_secs INTEGER,
      created_at INTEGER NOT NULL
    );
  `);

  const now = Date.now();
  db.prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)').run('Test Project', now, now);
  db.prepare('INSERT INTO parts (project_id, name, target_qty, created_at, updated_at) VALUES (1, ?, 10, ?, ?)').run('Test Part', now, now);
});

// ── Build a minimal express app wired to the in-memory DB ────────────────────
const express     = require('express');
const gcodesRouter = require('../routes/gcodes');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/gcodes', gcodesRouter(db));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// Creates a real temp file to upload
function makeTempGcode(name = 'test.bgcode') {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, Buffer.from('fake gcode content'));
  return p;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/gcodes/parse-filename', () => {
  test('parses a valid filename', async () => {
    const res = await request(app)
      .post('/api/gcodes/parse-filename')
      .send({ filename: '4x Left Bracket_0.20n_0.40mm_PLA_MK4S_5h11m.bgcode' });
    expect(res.status).toBe(200);
    expect(res.body.parse_failed).toBe(false);
    expect(res.body.parts_per_plate).toBe(4);
    expect(res.body.printer_model).toBe('mk4s');
  });

  test('returns parse_failed for unrecognised filename', async () => {
    const res = await request(app)
      .post('/api/gcodes/parse-filename')
      .send({ filename: 'random_file.bgcode' });
    expect(res.status).toBe(200);
    expect(res.body.parse_failed).toBe(true);
  });
});

describe('POST /api/gcodes/upload', () => {
  let uploadedPath;

  afterEach(() => {
    // Clean up any uploaded files
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      fs.unlinkSync(uploadedPath);
      uploadedPath = null;
    }
  });

  test('uploads a file and creates a DB record', async () => {
    const tmpFile = makeTempGcode('upload_test.bgcode');

    const res = await request(app)
      .post('/api/gcodes/upload')
      .attach('file', tmpFile)
      .field('part_id', '1')
      .field('parts_per_plate', '4')
      .field('printer_model', 'mk4s');

    fs.unlinkSync(tmpFile);

    expect(res.status).toBe(201);
    expect(res.body.printer_model).toBe('mk4s');
    expect(res.body.parts_per_plate).toBe(4);
    uploadedPath = res.body.filepath;
  });

  test('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .post('/api/gcodes/upload')
      .field('part_id', '1')
      .field('parts_per_plate', '4')
      .field('printer_model', 'mk4s');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  test('returns 400 for invalid model', async () => {
    const tmpFile = makeTempGcode('bad_model.bgcode');

    const res = await request(app)
      .post('/api/gcodes/upload')
      .attach('file', tmpFile)
      .field('part_id', '1')
      .field('parts_per_plate', '4')
      .field('printer_model', 'invalidmodel');

    fs.unlinkSync(tmpFile);

    expect(res.status).toBe(400);
  });

  test('returns 409 on duplicate (part_id, printer_model)', async () => {
    const tmpFile1 = makeTempGcode('dup1.bgcode');
    const tmpFile2 = makeTempGcode('dup2.bgcode');

    const first = await request(app)
      .post('/api/gcodes/upload')
      .attach('file', tmpFile1)
      .field('part_id', '1')
      .field('parts_per_plate', '2')
      .field('printer_model', 'c1');

    fs.unlinkSync(tmpFile1);
    if (first.body.filepath) uploadedPath = first.body.filepath;

    const second = await request(app)
      .post('/api/gcodes/upload')
      .attach('file', tmpFile2)
      .field('part_id', '1')
      .field('parts_per_plate', '2')
      .field('printer_model', 'c1');

    fs.unlinkSync(tmpFile2);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already has a G-code/i);
  });
});
