const express = require('express');

const db             = require('./db');
const PrinterPoller  = require('./poller');
const JobScheduler   = require('./scheduler');

const printersRouter = require('./routes/printers')(db);
const projectsRouter = require('./routes/projects')(db);
const partsRouter    = require('./routes/parts')(db);
const gcodesRouter   = require('./routes/gcodes')(db);
const jobsRouter     = require('./routes/jobs')(db);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API routes
app.use('/api/printers', printersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/parts',    partsRouter);
app.use('/api/gcodes',   gcodesRouter);
app.use('/api/jobs',     jobsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`[server] Express running on http://localhost:${PORT}`);

  const poller    = new PrinterPoller(db);
  const scheduler = new JobScheduler(db, poller);

  scheduler.start();
  poller.start();

  // Sweep on startup — picks up any printers already IDLE with is_held = 0
  // (e.g. machines that were set ready before a server restart).
  // Safe to call immediately: the sweep queries DB state, and the cold-start hold
  // logic only fires on the first poller tick for printers that finished while the
  // server was offline — those have is_held = 1 and are excluded from the sweep.
  scheduler.sweepIdlePrinters();

  // Dispatch trigger — called by the UI when a project is activated
  app.post('/api/scheduler/dispatch', (req, res) => {
    scheduler.sweepIdlePrinters();
    res.json({ ok: true });
  });

  // Bulk set-ready — releases hold for multiple printers and dispatches through the
  // batched sweep (10 at a time, waits for each batch to reach printing before the next).
  // Used by the "Set Ready (N)" action in the Fleet UI.
  app.post('/api/printers/set-ready-batch', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE printers SET is_held = 0 WHERE id IN (${placeholders})`).run(...ids);
    const printers = db.prepare(`SELECT * FROM printers WHERE id IN (${placeholders}) AND is_active = 1`).all(...ids);
    console.log(`[server] Batch set-ready: ${printers.length} printer(s) — dispatching in batches of 10`);
    scheduler._sweepInBatches(printers).catch(err =>
      console.error('[scheduler] Batch set-ready sweep error:', err)
    );
    res.json({ ok: true, count: printers.length });
  });

  // Recommission a printer — returns it to the active fleet and immediately dispatches
  // a job if one is available. Operator has completed investigation; no hold needed.
  app.post('/api/printers/:id/recommission', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    db.prepare(`
      UPDATE printers
      SET is_active = 1, is_held = 0, decommissioned_at = NULL, decommission_note = NULL
      WHERE id = ?
    `).run(printer.id);
    const updated = db.prepare('SELECT * FROM printers WHERE id = ?').get(printer.id);
    console.log(`[server] ${printer.name} recommissioned — dispatching...`);
    scheduler._dispatchToPrinter(updated).then(jobId => {
      if (jobId) console.log(`[server] ${printer.name} recommissioned and dispatched — job ${jobId}`);
      else console.log(`[server] ${printer.name} recommissioned — nothing to dispatch right now`);
    }).catch(err => console.error(`[scheduler] recommission dispatch error for ${printer.name}:`, err));
    res.json(updated);
  });

  // Set a held printer ready — releases hold and dispatches next job to it
  app.post('/api/printers/:id/set-ready', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    db.prepare('UPDATE printers SET is_held = 0 WHERE id = ?').run(printer.id);
    const updated = db.prepare('SELECT * FROM printers WHERE id = ?').get(printer.id);
    console.log(`[server] ${printer.name} set ready by operator — dispatching...`);
    scheduler._dispatchToPrinter(updated).then((jobId) => {
      if (jobId) console.log(`[server] ${printer.name} dispatched — job ${jobId}`);
      else console.log(`[server] ${printer.name} set ready but nothing to dispatch`);
    }).catch((err) =>
      console.error(`[scheduler] set-ready dispatch error for ${printer.name}:`, err)
    );
    res.json(updated);
  });
});

module.exports = { app, server };
