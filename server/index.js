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
});

module.exports = { app, server };
