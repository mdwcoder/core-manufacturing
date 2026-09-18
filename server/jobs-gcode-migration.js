const JOB_COLUMNS = Object.freeze([
  'id',
  'part_id',
  'printer_id',
  'gcode_id',
  'parts_per_plate',
  'status',
  'started_at',
  'finished_at',
  'created_at',
  'printing_seconds',
  'paused_seconds',
  'sample_count',
  'last_sample_at',
  'material_grams_actual',
  'energy_kwh',
  'telemetry_quality',
]);

const LEGACY_JOB_COLUMNS = Object.freeze(JOB_COLUMNS.slice(0, 9));

function tableExists(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name));
}

function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map(column => column.name);
}

function recoverResidualJobs(db) {
  if (!tableExists(db, 'jobs_migrated')) return;

  const residualColumns = tableColumns(db, 'jobs_migrated');
  const missingLegacyColumns = LEGACY_JOB_COLUMNS.filter(
    column => !residualColumns.includes(column)
  );
  if (missingLegacyColumns.length > 0) {
    throw new Error(
      `Cannot recover jobs_migrated: missing columns ${missingLegacyColumns.join(', ')}`
    );
  }

  const columnsToRecover = JOB_COLUMNS.filter(column => residualColumns.includes(column));
  const columnList = columnsToRecover.join(', ');
  db.exec(`
    INSERT INTO jobs (${columnList})
    SELECT ${columnsToRecover.map(column => `residual.${column}`).join(', ')}
    FROM jobs_migrated AS residual
    WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id = residual.id);
    DROP TABLE jobs_migrated;
  `);
}

function createNullableJobsTable(db) {
  db.exec(`
    CREATE TABLE jobs_migrated (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id               INTEGER NOT NULL REFERENCES parts(id),
      printer_id            INTEGER NOT NULL REFERENCES printers(id),
      gcode_id              INTEGER REFERENCES gcodes(id),
      parts_per_plate       INTEGER NOT NULL,
      status                TEXT DEFAULT 'queued',
      started_at            INTEGER,
      finished_at           INTEGER,
      created_at            INTEGER NOT NULL,
      printing_seconds      REAL NOT NULL DEFAULT 0,
      paused_seconds        REAL NOT NULL DEFAULT 0,
      sample_count          INTEGER NOT NULL DEFAULT 0,
      last_sample_at        INTEGER,
      material_grams_actual REAL,
      energy_kwh            REAL,
      telemetry_quality     TEXT NOT NULL DEFAULT 'none'
    );
  `);
}

// SQLite cannot remove a NOT NULL constraint in place. Rebuild jobs in one
// transaction, preserving current data and every user-defined index and trigger.
function makeJobsGcodeNullable(db) {
  const gcodeIdCol = db.prepare("PRAGMA table_info(jobs)").all()
    .find(column => column.name === 'gcode_id');
  if (!gcodeIdCol) return false;

  const needsRebuild = gcodeIdCol.notnull === 1;
  const hasResidualTable = tableExists(db, 'jobs_migrated');
  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;

  if (!needsRebuild && !hasResidualTable) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_printer_started
        ON jobs(printer_id, started_at DESC)
    `);
    return false;
  }

  const schemaObjects = needsRebuild
    ? db.prepare(`
        SELECT type, name, sql
        FROM sqlite_master
        WHERE tbl_name = 'jobs'
          AND type IN ('index', 'trigger')
          AND sql IS NOT NULL
        ORDER BY type, name
      `).all()
    : [];

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      recoverResidualJobs(db);

      if (needsRebuild) {
        createNullableJobsTable(db);
        const columnList = JOB_COLUMNS.join(', ');
        db.exec(`
          INSERT INTO jobs_migrated (${columnList})
          SELECT ${columnList} FROM jobs;
          DROP TABLE jobs;
          ALTER TABLE jobs_migrated RENAME TO jobs;
        `);

        for (const schemaObject of schemaObjects) {
          db.exec(schemaObject.sql);
        }
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_jobs_printer_started
          ON jobs(printer_id, started_at DESC)
      `);
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'}`);
  }

  return needsRebuild;
}

module.exports = { JOB_COLUMNS, makeJobsGcodeNullable };
