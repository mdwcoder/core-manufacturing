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

  // Dispatch trigger — called by the UI when a project is activated
  app.post('/api/scheduler/dispatch', (req, res) => {
    scheduler.sweepIdlePrinters();
    res.json({ ok: true });
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
