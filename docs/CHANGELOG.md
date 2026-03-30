# Changelog

---

## 2026-03-30 — Phase 2: Job Scheduling & Production UI

### Job Scheduler (`server/scheduler.js`)

New `JobScheduler` class extending `EventEmitter`. Receives the `db` and `poller` instances at construction and is started alongside the poller in `server/index.js`.

- Listens to `printerIdle` events from the poller and dispatches the next eligible job automatically
- `_dispatchToPrinter(printer)`: queries open parts in active projects that have a matching G-code for the printer's model, ordered FIFO by project creation date. Inserts the job synchronously as `uploading` to act as a concurrency lock, then performs a ceiling check (uploads needed vs. active jobs already running). If over ceiling, deletes the just-inserted job and returns. Otherwise uploads the file to PrusaLink and starts the print.
- `_handleFinished(printer)`: marks the job `finished`, increments `completed_qty` on the part, closes the part if qty ≥ target (auto-cancelling any queued jobs for it), and checks whether all parts in the project are now closed (marks project `completed` if so). Then dispatches the next job.
- `_handlePrinterUnavailable(printer)`: marks any active job on that printer as `failed` when the printer goes `ERROR` or `OFFLINE`.
- `sweepIdlePrinters()`: queries all currently idle, non-held printers and dispatches to each. Called at server start and when a project is activated via the UI.

### G-code Upload API (`server/routes/gcodes.js`)

Replaced the GET-only stub with a full implementation:

- `POST /api/gcodes/parse-filename` — runs the filename regex and returns parsed fields (`parts_per_plate`, `printer_model`, `est_print_secs`, `part_name_hint`) without saving anything. Returns `{ parse_failed: true }` on no match.
- `POST /api/gcodes/upload` — multipart upload (field name `file`) using multer diskStorage to `server/gcode/`. Enforces uniqueness on `(part_id, printer_model)` at the application layer; returns `409` with a descriptive message on duplicate.
- `DELETE /api/gcodes/:id` — removes the DB record and the file from disk.

Filename regex: `^(\d+)x\s+(.+?)_(\d+\.\d+n)_(\d+\.\d+mm)_([A-Za-z]+)_([A-Za-z0-9]+)_(\d+h\d+m)\.(bgcode|gcode)$`

### Jobs API (`server/routes/jobs.js`)

Replaced the stub with a full implementation:

- `GET /api/jobs` — filtered list with JOINs returning `part_name`, `project_name`, `printer_name`, `printer_model`. Supports `?status`, `?project_id`, `?printer_id`, `?part_id` query params.
- `GET /api/jobs/:id` — single job with same JOINs.
- `DELETE /api/jobs/:id` — cancels a job; returns `409` if status is not `queued`.

### Parts API update (`server/routes/parts.js`)

`PUT /api/parts/:id` now auto-calculates `status` when `completed_qty` is provided: `closed` if `completed_qty >= target_qty`, otherwise `open`. If `completed_qty` is not in the payload, the caller can still set `status` explicitly.

### Dispatch trigger endpoint

`POST /api/scheduler/dispatch` — no body required. Calls `scheduler.sweepIdlePrinters()`. Mounted in `server/index.js`. Called by the Projects UI when a project is activated or resumed.

### Projects screen (`client/src/pages/Projects.jsx`)

Full replacement of the Phase 1 placeholder:

- **List view**: all projects with name, status badge, click to open detail.
- **New Project form**: inline, name + optional description, `POST /api/projects`.
- **Detail view**:
  - Header with project name, status badge, and context-sensitive action button: Activate (draft), Pause (active), Resume (paused). Activate/Resume triggers `POST /api/scheduler/dispatch`.
  - Parts table: name, progress bar (`completed_qty / target_qty`), status badge (`open` / `closed`), G-code chips per uploaded model (with × delete button), Edit qty button.
  - `completed_qty` editing with guardrails: inline number input, confirm dialog on submit. Special messages when the edit would reopen a closed part or close an open one.
  - Per-part expandable G-code upload panel: file picker, auto-fill from `POST /api/gcodes/parse-filename` on file select, editable `parts_per_plate` and model dropdown, 409 error shown inline without clearing the form.
  - Add Part inline form: name + target quantity, `POST /api/parts`.

### Jobs screen (`client/src/pages/Jobs.jsx`)

Full replacement of the Phase 1 placeholder:

- Table columns: ID, Part, Project, Printer, Model, Status, Started, Duration, Actions.
- Filter bar: status dropdown (all / queued / uploading / printing / finished / failed / cancelled), project dropdown, printer dropdown.
- Polls `GET /api/jobs` every 15 seconds with active filters as query params.
- Cancel button on `queued` rows → `DELETE /api/jobs/:id` with confirm dialog.
- Status color coding consistent with Fleet page.

### Dependencies added

- `form-data` ^4.0.0 (server) — multipart form construction for PrusaLink file uploads

---

## 2026-03-30 — Explicit model column in CSV; canonical model value set

**What:** Redesigned model resolution for CSV import. The `model` column in the CSV is now the authoritative source. Valid values: `MK4`, `MK4S`, `C1`, `C1L`, `XL` (case-insensitive, normalized to lowercase internally). Name-based inference is retained as a fallback for CSVs without the column.

Internal model IDs updated from `core1` / `core1l` to `c1` / `c1l` to match the canonical value set. `mk4` added as a distinct model alongside `mk4s`.

**Why:** Name inference is brittle — it requires naming conventions to be followed and breaks for any free-form printer names (e.g. MLP character names for Core One machines). An explicit column makes any printer name valid and removes the inference logic as a maintenance burden.

**Files changed:** `server/routes/printers.js`, `client/src/pages/Settings.jsx`, `docs/database.md`, `docs/api.md`

---

## 2026-03-30 — Phase 1: Foundation

### Project scaffold

Created the full project directory structure as specified in `ARCHITECTURE.md` Section 11.1:

- `server/` with `index.js`, `db.js`, `poller.js`, and `routes/` subfolder
- `client/` with Vite + React setup, `src/pages/` for all five screens
- Root `package.json` wiring both processes together via `concurrently`
- `.gitignore` excluding `node_modules/`, `server/data/`, `server/gcode/`, `dist/`

### Database (`server/db.js`)

Created SQLite database with all five tables using `better-sqlite3`:

- `printers` — printer registry with model, IP, API key, status, hold flag
- `projects` — production run tracking (draft/active/paused/completed)
- `parts` — per-project components with target/completed quantity
- `gcodes` — G-code files per part+model combination with plate metadata
- `jobs` — individual print instances with lifecycle status

WAL journal mode and foreign key enforcement enabled at startup. Database file and gcode directory auto-created on first run.

### Printer polling loop (`server/poller.js`)

Implemented `PrinterPoller` class extending `EventEmitter`:

- Single 15-second `setInterval` drives polls for the entire fleet (not one timer per printer)
- `Promise.allSettled()` fires all printer polls concurrently — one unreachable printer never blocks others
- Reads `data.printer.state` from PrusaLink `GET /api/v1/status` endpoint
- Network failures (timeout, refused) → status set to `OFFLINE`
- Status changes written to DB and emitted as `statusChange` events
- `printerIdle` event emitted when a printer transitions into IDLE (hook point for Phase 2 scheduler)
- Individual printer poll timeout: 8 seconds

### Printer registry API (`server/routes/printers.js`)

Full CRUD plus CSV bulk import:

- `GET /api/printers` — list all, ordered by name
- `GET /api/printers/:id` — single printer
- `POST /api/printers` — create single printer with model validation
- `PUT /api/printers/:id` — partial update (all fields including `is_held`)
- `DELETE /api/printers/:id`
- `POST /api/printers/import` — multipart CSV upload via multer + papaparse
  - Model inferred from name prefix (`MK4S_`, `CoreOne_/Core1_`, `Core1L_`, `XL_`)
  - Duplicate names skipped with count; unrecognized model names flagged for manual resolution
  - Returns `{ imported, skipped, flagged }` summary

### Stub API routes

Created minimal implementations for Phase 2 endpoints:

- `server/routes/projects.js` — full CRUD (no dispatch logic)
- `server/routes/parts.js` — full CRUD (no state machine)
- `server/routes/gcodes.js` — `GET` only stub
- `server/routes/jobs.js` — `GET` only stub with query filters

### Web app: Fleet screen (`client/src/pages/Fleet.jsx`)

Live printer grid:

- Polls `GET /api/printers` every 15 seconds
- Status filter chips with live counts (All / Printing / Idle / Error / Attention / Offline)
- Search filter on name, IP, group name
- Printers grouped by model in fixed order: MK4S → Core One → Core 1L → XL → Other
- Color-coded status badges per PrusaLink state

### Web app: Settings screen (`client/src/pages/Settings.jsx`)

CSV import UI:

- File picker + Import button → calls `POST /api/printers/import`
- Displays imported/skipped/flagged summary after upload
- Flagged rows with unrecognized model names show inline model dropdown + Save button
- Saving a flagged row calls `POST /api/printers` and removes the row from the flagged list

### Web app: Dashboard (`client/src/pages/Dashboard.jsx`)

Fleet summary showing six stat cards: Total, Printing, Idle, Error, Attention, Offline. Polls every 15 seconds.

### Web app: Placeholder pages

`Projects.jsx` and `Jobs.jsx` show "Coming in Phase 2" notices.

### Responsive layout (`client/src/App.jsx`)

- Desktop (>600px): fixed 180px left sidebar with nav links
- Mobile (≤600px): sidebar hidden, horizontal top nav bar displayed instead
- CSS media query in inline `<style>` block within `App.jsx`

### Dependencies added

**Root (server):**
- `express` ^4.19.2
- `better-sqlite3` ^9.6.0
- `multer` ^2.1.1 (upgraded from 1.x to patch known vulnerabilities)
- `papaparse` ^5.4.1
- `axios` ^1.7.2
- `concurrently` ^8.2.2

**Client:**
- `react` ^18.3.1
- `react-dom` ^18.3.1
- `react-router-dom` ^6.24.0
- `vite` ^5.3.1
- `@vitejs/plugin-react` ^4.3.1
