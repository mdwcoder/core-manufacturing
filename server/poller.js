const EventEmitter = require('events');
const axios = require('axios');

const POLL_INTERVAL_MS = 15000;

class PrinterPoller extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.timer = null;
  }

  start() {
    console.log(`[poller] Starting poll loop (interval: ${POLL_INTERVAL_MS}ms)`);
    this._tick();
    this.timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async _tick() {
    const printers = this.db
      .prepare('SELECT * FROM printers WHERE is_active = 1')
      .all();

    if (printers.length === 0) return;

    const results = await Promise.allSettled(
      printers.map((printer) => this._pollPrinter(printer))
    );

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`[poller] Unexpected error polling ${printers[i].name}:`, result.reason);
      }
    });
  }

  async _pollPrinter(printer) {
    const previousStatus = printer.status;
    let newStatus;

    try {
      const response = await axios.get(`http://${printer.ip}/api/v1/status`, {
        headers: { 'X-Api-Key': printer.api_key },
        timeout: 8000,
      });

      const data = response.data;
      // PrusaLink returns printer state under data.printer.state
      newStatus = (data?.printer?.state || 'UNKNOWN').toUpperCase();
    } catch (err) {
      // Any network error → OFFLINE
      newStatus = 'OFFLINE';
    }

    if (newStatus !== previousStatus) {
      // States considered "in-progress normal" — no hold on entry.
      // Everything else (ERROR, OFFLINE, ATTENTION, PAUSED, UNKNOWN, any unexpected state)
      // sets is_held = 1 so a human must confirm before the next job dispatches.
      const SAFE_STATES = new Set(['IDLE', 'PRINTING', 'FINISHED', 'READY']);
      const missedFinished = newStatus === 'IDLE' && previousStatus === 'PRINTING';
      const shouldHold = newStatus === 'FINISHED' || missedFinished || !SAFE_STATES.has(newStatus);
      const holdUpdate = shouldHold ? ', is_held = 1' : '';
      this.db
        .prepare(`UPDATE printers SET status = ?${holdUpdate} WHERE id = ?`)
        .run(newStatus, printer.id);

      console.log(`[poller] ${printer.name}: ${previousStatus} → ${newStatus}`);
      this.emit('statusChange', { printer, previousStatus, newStatus });

      if (newStatus === 'IDLE' && previousStatus !== 'IDLE') {
        this.emit('printerIdle', { printer: { ...printer, status: newStatus } });
      }
    }
  }
}

module.exports = PrinterPoller;
