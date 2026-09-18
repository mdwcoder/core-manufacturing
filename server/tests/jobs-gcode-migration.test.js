const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { JOB_COLUMNS, makeJobsGcodeNullable } = require('../jobs-gcode-migration');

const tempDirs = [];
const EXPECTED_JOB_SCHEMA = [
  ['id', 'INTEGER', 0, null, 1],
  ['part_id', 'INTEGER', 1, null, 0],
  ['printer_id', 'INTEGER', 1, null, 0],
  ['gcode_id', 'INTEGER', 0, null, 0],
  ['parts_per_plate', 'INTEGER', 1, null, 0],
  ['status', 'TEXT', 0, "'queued'", 0],
  ['started_at', 'INTEGER', 0, null, 0],
  ['finished_at', 'INTEGER', 0, null, 0],
  ['created_at', 'INTEGER', 1, null, 0],
  ['printing_seconds', 'REAL', 1, '0', 0],
  ['paused_seconds', 'REAL', 1, '0', 0],
  ['sample_count', 'INTEGER', 1, '0', 0],
  ['last_sample_at', 'INTEGER', 0, null, 0],
  ['material_grams_actual', 'REAL', 0, null, 0],
  ['energy_kwh', 'REAL', 0, null, 0],
  ['telemetry_quality', 'TEXT', 1, "'none'", 0],
];

function makeTempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coma-jobs-migration-'));
  tempDirs.push(dir);
  return path.join(dir, 'test.db');
}

function loadDbAt(databasePath) {
  jest.resetModules();
  jest.doMock('../database-path', () => ({
    getDatasetName: () => 'migration-test',
    getDatabasePath: () => databasePath,
  }));
  return require('../db');
}

function createFixtureParents(db) {
  db.exec(`
    CREATE TABLE printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      ip TEXT NOT NULL,
      api_key TEXT NOT NULL,
      group_name TEXT,
      type TEXT DEFAULT 'prusa',
      model TEXT NOT NULL,
      status TEXT DEFAULT 'UNKNOWN',
      is_held INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft',
      priority INTEGER DEFAULT 0,
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
    INSERT INTO printers
      (id, name, ip, api_key, model, created_at)
    VALUES (30, 'Fixture printer', '127.0.0.1', 'fixture', 'mk4', 100);
    INSERT INTO projects
      (id, name, created_at, updated_at)
    VALUES (10, 'Fixture project', 100, 100);
    INSERT INTO parts
      (id, project_id, name, target_qty, created_at, updated_at)
    VALUES (20, 10, 'Fixture part', 10, 100, 100);
    INSERT INTO gcodes
      (id, part_id, printer_model, filename, filepath, parts_per_plate, created_at)
    VALUES (40, 20, 'mk4', 'fixture.gcode', '/tmp/fixture.gcode', 8, 100);
  `);
}

function createJobsTable(db, { nullable = false, telemetry = false, name = 'jobs' } = {}) {
  db.exec(`
    CREATE TABLE ${name} (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id          INTEGER NOT NULL REFERENCES parts(id),
      printer_id       INTEGER NOT NULL REFERENCES printers(id),
      gcode_id         INTEGER ${nullable ? '' : 'NOT NULL '}REFERENCES gcodes(id),
      parts_per_plate  INTEGER NOT NULL,
      status           TEXT DEFAULT 'queued',
      started_at       INTEGER,
      finished_at      INTEGER,
      created_at       INTEGER NOT NULL
      ${telemetry ? `,
      printing_seconds      REAL NOT NULL DEFAULT 0,
      paused_seconds        REAL NOT NULL DEFAULT 0,
      sample_count          INTEGER NOT NULL DEFAULT 0,
      last_sample_at        INTEGER,
      material_grams_actual REAL,
      energy_kwh            REAL,
      telemetry_quality     TEXT NOT NULL DEFAULT 'none'` : ''}
    )
  `);
}

function insertLegacyJob(db, table = 'jobs', id = 1) {
  db.prepare(`
    INSERT INTO ${table}
      (id, part_id, printer_id, gcode_id, parts_per_plate, status,
       started_at, finished_at, created_at)
    VALUES (?, 20, 30, 40, 8, 'finished', 1000, 2000, 500)
  `).run(id);
}

function jobsSchema(db) {
  return db.prepare('PRAGMA table_info(jobs)').all();
}

function expectCurrentJobsSchema(db) {
  const schema = jobsSchema(db);
  expect(schema.map(column => column.name)).toEqual(JOB_COLUMNS);
  expect(schema.map(column => [
    column.name,
    column.type,
    column.notnull,
    column.dflt_value,
    column.pk,
  ])).toEqual(EXPECTED_JOB_SCHEMA);
  expect(db.prepare('PRAGMA foreign_key_list(jobs)').all().map(foreignKey => ({
    from: foreignKey.from,
    table: foreignKey.table,
    to: foreignKey.to,
  })).sort((left, right) => left.from.localeCompare(right.from))).toEqual([
    { from: 'gcode_id', table: 'gcodes', to: 'id' },
    { from: 'part_id', table: 'parts', to: 'id' },
    { from: 'printer_id', table: 'printers', to: 'id' },
  ]);
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs_migrated'"
  ).get()).toBeUndefined();
}

function expectRuntimeIndex(db) {
  expect(db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_jobs_printer_started'
  `).get()?.sql).toContain('ON jobs(printer_id, started_at DESC)');
}

describe('jobs gcode nullable startup migration', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('../database-path');
  });

  afterAll(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('initializes a new database with the current nullable 16-column schema', () => {
    const databasePath = makeTempDatabase();
    const db = loadDbAt(databasePath);

    expectCurrentJobsSchema(db);
    expect(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count).toBe(0);
    expectRuntimeIndex(db);
    db.close();
  });

  test('upgrades a legacy nine-column table without losing rows', () => {
    const databasePath = makeTempDatabase();
    const fixture = new Database(databasePath);
    createFixtureParents(fixture);
    createJobsTable(fixture);
    insertLegacyJob(fixture);
    fixture.close();

    const db = loadDbAt(databasePath);

    expectCurrentJobsSchema(db);
    expect(db.prepare('SELECT * FROM jobs').all()).toEqual([
      expect.objectContaining({
        id: 1,
        gcode_id: 40,
        printing_seconds: 0,
        paused_seconds: 0,
        sample_count: 0,
        telemetry_quality: 'none',
      }),
    ]);
    expectRuntimeIndex(db);
    db.close();
  });

  test('preserves all telemetry values from a 16-column table', () => {
    const databasePath = makeTempDatabase();
    const fixture = new Database(databasePath);
    createFixtureParents(fixture);
    createJobsTable(fixture, { telemetry: true });
    fixture.exec(`
      INSERT INTO jobs VALUES
        (4, 20, 30, 40, 8, 'finished', 1000, 2000, 500,
         720.5, 12.25, 49, 1900, 31.75, 0.42, 'measured')
    `);
    fixture.close();

    const db = loadDbAt(databasePath);

    expectCurrentJobsSchema(db);
    expect(db.prepare('SELECT * FROM jobs WHERE id = 4').get()).toEqual({
      id: 4,
      part_id: 20,
      printer_id: 30,
      gcode_id: 40,
      parts_per_plate: 8,
      status: 'finished',
      started_at: 1000,
      finished_at: 2000,
      created_at: 500,
      printing_seconds: 720.5,
      paused_seconds: 12.25,
      sample_count: 49,
      last_sample_at: 1900,
      material_grams_actual: 31.75,
      energy_kwh: 0.42,
      telemetry_quality: 'measured',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count).toBe(1);
    expectRuntimeIndex(db);
    db.close();
  });

  test('recovers rows from a residual nine-column jobs_migrated table', () => {
    const databasePath = makeTempDatabase();
    const fixture = new Database(databasePath);
    createFixtureParents(fixture);
    createJobsTable(fixture, { telemetry: true });
    insertLegacyJob(fixture, 'jobs', 1);
    createJobsTable(fixture, { name: 'jobs_migrated' });
    insertLegacyJob(fixture, 'jobs_migrated', 2);
    fixture.close();

    const db = loadDbAt(databasePath);

    expectCurrentJobsSchema(db);
    expect(db.prepare('SELECT id FROM jobs ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(db.prepare('SELECT telemetry_quality FROM jobs WHERE id = 2').get()).toEqual({
      telemetry_quality: 'none',
    });
    expectRuntimeIndex(db);
    db.close();
  });

  test('leaves an already migrated database unchanged on a second startup', () => {
    const databasePath = makeTempDatabase();
    let db = loadDbAt(databasePath);
    db.prepare(`
      INSERT INTO printers (id, name, ip, api_key, model, created_at)
      VALUES (30, 'Fixture printer', '127.0.0.1', 'fixture', 'mk4', 100)
    `).run();
    db.prepare(`
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (10, 'Fixture project', 100, 100)
    `).run();
    db.prepare(`
      INSERT INTO parts (id, project_id, name, target_qty, created_at, updated_at)
      VALUES (20, 10, 'Fixture part', 10, 100, 100)
    `).run();
    db.prepare(`
      INSERT INTO jobs
        (part_id, printer_id, gcode_id, parts_per_plate, status, created_at,
         printing_seconds, telemetry_quality)
      VALUES (20, 30, NULL, 3, 'finished', 500, 42.5, 'partial')
    `).run();
    const schemaBefore = jobsSchema(db);
    const rowsBefore = db.prepare('SELECT * FROM jobs ORDER BY id').all();
    const jobsSqlBefore = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'"
    ).get().sql;
    db.close();

    db = loadDbAt(databasePath);

    expect(jobsSchema(db)).toEqual(schemaBefore);
    expect(db.prepare('SELECT * FROM jobs ORDER BY id').all()).toEqual(rowsBefore);
    expect(db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'"
    ).get().sql).toBe(jobsSqlBefore);
    expectCurrentJobsSchema(db);
    expectRuntimeIndex(db);
    db.close();
  });
});

describe('jobs migration transaction safety', () => {
  test('recreates associated indexes and triggers and restores foreign key state', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    createJobsTable(db, { telemetry: true });
    db.exec(`
      CREATE TABLE job_changes (job_id INTEGER NOT NULL);
      CREATE INDEX idx_jobs_status ON jobs(status);
      CREATE INDEX idx_jobs_printer_started ON jobs(printer_id, started_at DESC);
      CREATE TRIGGER trg_jobs_status
      AFTER UPDATE OF status ON jobs
      BEGIN
        INSERT INTO job_changes (job_id) VALUES (NEW.id);
      END;
    `);
    insertLegacyJob(db);

    expect(makeJobsGcodeNullable(db)).toBe(true);

    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE tbl_name = 'jobs' AND type IN ('index', 'trigger')
      ORDER BY name
    `).all()).toEqual([
      { name: 'idx_jobs_printer_started' },
      { name: 'idx_jobs_status' },
      { name: 'trg_jobs_status' },
    ]);
    db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = 1").run();
    expect(db.prepare('SELECT * FROM job_changes').all()).toEqual([{ job_id: 1 }]);
    db.close();
  });

  test('rolls back every change when residual recovery fails', () => {
    const db = new Database(':memory:');
    createFixtureParents(db);
    createJobsTable(db, { telemetry: true });
    insertLegacyJob(db);
    db.exec(`
      CREATE TABLE jobs_migrated (id INTEGER PRIMARY KEY);
      INSERT INTO jobs_migrated (id) VALUES (2);
    `);

    expect(() => makeJobsGcodeNullable(db)).toThrow(
      'Cannot recover jobs_migrated: missing columns'
    );

    expect(db.prepare('SELECT id FROM jobs').all()).toEqual([{ id: 1 }]);
    expect(db.prepare('SELECT id FROM jobs_migrated').all()).toEqual([{ id: 2 }]);
    expect(jobsSchema(db).find(column => column.name === 'gcode_id').notnull).toBe(1);
    db.close();
  });
});
