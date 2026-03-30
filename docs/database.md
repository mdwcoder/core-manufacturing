# Database

## Purpose

`server/db.js` manages the SQLite database. It opens the connection, sets pragmas, and runs `CREATE TABLE IF NOT EXISTS` for all five tables on every startup. No migration system — schema changes require manual handling.

## Driver

`better-sqlite3` — synchronous SQLite. All queries are blocking calls that return results directly (no promises, no callbacks). This simplifies the entire server-side codebase: no `async/await` is needed for database operations.

Pragmas set at startup:
- `journal_mode = WAL` — improves concurrent read performance
- `foreign_keys = ON` — enforces referential integrity on all FK relationships

## Tables

### printers

Stores the physical printer registry imported from the CSV spreadsheet.

```sql
CREATE TABLE IF NOT EXISTS printers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,      -- e.g. "MK4S_07", "Twilight"
  ip          TEXT NOT NULL,             -- e.g. "192.168.15.194"
  api_key     TEXT NOT NULL,             -- PrusaLink X-Api-Key header value
  group_name  TEXT,                      -- e.g. "MK4S Farm" (optional)
  type        TEXT DEFAULT 'prusa',      -- vendor; reserved for future use
  model       TEXT NOT NULL,             -- mk4 | mk4s | c1 | c1l | xl
  status      TEXT DEFAULT 'UNKNOWN',    -- live PrusaLink state (see status model)
  is_held     INTEGER DEFAULT 0,         -- 1 = excluded from polling and dispatch
  created_at  INTEGER NOT NULL           -- Unix epoch ms
);
```

**Model resolution:** The `model` column in the CSV is the preferred source. Accepted values (case-insensitive): `MK4`, `MK4S`, `C1`, `C1L`, `XL`. These are normalized to lowercase as the internal ID.

If the `model` column is absent or blank, the import falls back to name-based inference:
- `MK4S_*` → `mk4s`
- `MK4_*` → `mk4`
- `Core1L_*`, `C1L *` → `c1l`
- `CoreOne_*`, `Core1_*`, `C1 *` → `c1`
- `XL_*` → `xl`
- No match → row is flagged; operator must resolve manually

If a `model` column is present, name inference is skipped entirely — any printer name is valid.

### projects

Top-level organizational unit for a production run.

```sql
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'draft',   -- draft | active | paused | completed
  priority    INTEGER DEFAULT 0,      -- reserved for Phase 2 priority ordering
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### parts

A distinct physical component within a project. Tracks production quantity progress.

```sql
CREATE TABLE IF NOT EXISTS parts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  name           TEXT NOT NULL,
  target_qty     INTEGER NOT NULL,
  completed_qty  INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'open',   -- open | closed
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

A Part is **open** while `completed_qty < target_qty`. It transitions to **closed** automatically when `completed_qty >= target_qty`. `completed_qty` is allowed to exceed `target_qty` (expected due to plate-based printing — never dispatch half a plate).

### gcodes

A G-code file attached to a specific Part + printer model combination.

```sql
CREATE TABLE IF NOT EXISTS gcodes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id          INTEGER NOT NULL REFERENCES parts(id),
  printer_model    TEXT NOT NULL,      -- mk4s | core1 | core1l | xl
  filename         TEXT NOT NULL,
  filepath         TEXT NOT NULL,      -- absolute path under server/gcode/
  parts_per_plate  INTEGER NOT NULL,
  est_print_secs   INTEGER,            -- nullable; parsed from filename
  created_at       INTEGER NOT NULL
);
```

**Uniqueness on `(part_id, printer_model)`** is enforced at the application layer, not as a DB constraint, so the error message shown to the operator is clear and specific.

### jobs

A single print instance — one G-code file sent to one printer, one time.

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id          INTEGER NOT NULL REFERENCES parts(id),
  printer_id       INTEGER NOT NULL REFERENCES printers(id),
  gcode_id         INTEGER NOT NULL REFERENCES gcodes(id),
  parts_per_plate  INTEGER NOT NULL,  -- snapshot of gcode.parts_per_plate at dispatch time
  status           TEXT DEFAULT 'queued',
                   -- queued | uploading | printing | finished | failed | cancelled
  started_at       INTEGER,
  finished_at      INTEGER,
  created_at       INTEGER NOT NULL
);
```

`parts_per_plate` is snapshotted at dispatch time so changing the G-code record after dispatch doesn't retroactively affect in-flight jobs.

## Conventions

- All IDs: `INTEGER PRIMARY KEY AUTOINCREMENT`
- All timestamps: Unix epoch milliseconds (`INTEGER`) — use `Date.now()` in application code
- Booleans: `INTEGER` with values `0` (false) and `1` (true)
- All queries use `?` positional parameters — no string interpolation
- `COALESCE(?, column)` pattern used for partial updates (PUT endpoints) so omitting a field leaves the existing value intact

## File Locations

- Database: `server/data/farm.db` (gitignored)
- G-code storage: `server/gcode/` (gitignored)

Both directories are created automatically on first startup if they don't exist.
