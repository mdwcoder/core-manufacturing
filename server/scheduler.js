const EventEmitter = require('events');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

class JobScheduler extends EventEmitter {
  constructor(db, poller) {
    super();
    this.db = db;
    this.poller = poller;
  }

  start() {
    console.log('[scheduler] Starting job scheduler');

    this.poller.on('printerIdle', ({ printer }) => {
      this._dispatchToPrinter(printer).catch((err) =>
        console.error(`[scheduler] Unhandled error dispatching to ${printer.name}:`, err)
      );
    });

    this.poller.on('statusChange', ({ printer, newStatus }) => {
      if (newStatus === 'FINISHED') {
        this._handleFinished(printer);
      }
      if (newStatus === 'ERROR' || newStatus === 'OFFLINE') {
        this._handlePrinterUnavailable(printer);
      }
    });
  }

  // Sweep all currently idle non-held printers and dispatch immediately.
  // Called when a project is activated or the server starts.
  sweepIdlePrinters() {
    const idlePrinters = this.db
      .prepare("SELECT * FROM printers WHERE status = 'IDLE' AND is_held = 0")
      .all();

    console.log(`[scheduler] Sweeping ${idlePrinters.length} idle printer(s)`);

    for (const printer of idlePrinters) {
      this._dispatchToPrinter(printer).catch((err) =>
        console.error(`[scheduler] Sweep dispatch error for ${printer.name}:`, err)
      );
    }
  }

  // ─── Dispatch ───────────────────────────────────────────────────────────────

  async _dispatchToPrinter(printer) {
    // Find the best open Part that has a G-code for this printer's model,
    // belonging to an active project. FIFO across projects by created_at.
    const candidate = this.db.prepare(`
      SELECT
        parts.id          AS part_id,
        parts.target_qty,
        parts.completed_qty,
        parts.project_id,
        gcodes.id         AS gcode_id,
        gcodes.filename,
        gcodes.filepath,
        gcodes.parts_per_plate
      FROM parts
      JOIN gcodes   ON gcodes.part_id    = parts.id
      JOIN projects ON projects.id       = parts.project_id
      WHERE parts.status    = 'open'
        AND projects.status = 'active'
        AND gcodes.printer_model = ?
      ORDER BY projects.created_at ASC
      LIMIT 1
    `).get(printer.model);

    if (!candidate) return; // nothing to print for this model

    // Synchronously insert a job as 'uploading' — this acts as a dispatch lock
    // so concurrent printerIdle events for printers of the same model don't
    // over-dispatch the same Part.
    const jobRow = this.db.prepare(`
      INSERT INTO jobs (part_id, printer_id, gcode_id, parts_per_plate, status, created_at)
      VALUES (?, ?, ?, ?, 'uploading', ?)
    `).run(candidate.part_id, printer.id, candidate.gcode_id, candidate.parts_per_plate, Date.now());
    const jobId = jobRow.lastInsertRowid;

    // Ceiling check: how many jobs are still needed vs how many are already active?
    const jobsRemaining = Math.max(
      0,
      Math.ceil((candidate.target_qty - candidate.completed_qty) / candidate.parts_per_plate)
    );
    const activeCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM jobs
      WHERE part_id = ? AND status IN ('uploading', 'printing')
    `).get(candidate.part_id).count;

    if (activeCount > jobsRemaining) {
      // We inserted one too many — Part is already covered
      this.db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
      return;
    }

    // Async: upload file to printer, then start the print
    try {
      await this._uploadGCode(printer, candidate);
      await this._startPrint(printer, candidate);

      this.db.prepare(`
        UPDATE jobs SET status = 'printing', started_at = ? WHERE id = ?
      `).run(Date.now(), jobId);

      console.log(`[scheduler] ${printer.name} ← ${candidate.filename}`);
    } catch (err) {
      this.db.prepare(`UPDATE jobs SET status = 'failed' WHERE id = ?`).run(jobId);
      console.error(`[scheduler] Dispatch failed for ${printer.name}: ${err.message}`);
    }
  }

  async _uploadGCode(printer, gcode) {
    const form = new FormData();
    form.append('file', fs.createReadStream(gcode.filepath), gcode.filename);

    await axios.post(`http://${printer.ip}/api/v1/files/usb`, form, {
      headers: {
        'X-Api-Key': printer.api_key,
        ...form.getHeaders(),
      },
      timeout: 120000, // file upload — allow up to 2 minutes
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  }

  async _startPrint(printer, gcode) {
    await axios.post(
      `http://${printer.ip}/api/v1/job`,
      { file: { path: `/usb/${gcode.filename}` } },
      {
        headers: { 'X-Api-Key': printer.api_key },
        timeout: 15000,
      }
    );
  }

  // ─── Finished handling ───────────────────────────────────────────────────────

  _handleFinished(printer) {
    // Find the job currently marked printing for this printer
    const job = this.db.prepare(`
      SELECT * FROM jobs
      WHERE printer_id = ? AND status = 'printing'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(printer.id);

    if (!job) {
      console.warn(`[scheduler] FINISHED on ${printer.name} but no printing job found — may be outside system`);
      // Still try to dispatch the next job
      this._dispatchToPrinter(printer).catch(() => {});
      return;
    }

    const now = Date.now();

    // Mark job finished
    this.db.prepare(`UPDATE jobs SET status = 'finished', finished_at = ? WHERE id = ?`)
      .run(now, job.id);

    // Increment completed_qty
    this.db.prepare(`
      UPDATE parts SET completed_qty = completed_qty + ?, updated_at = ? WHERE id = ?
    `).run(job.parts_per_plate, now, job.part_id);

    const part = this.db.prepare('SELECT * FROM parts WHERE id = ?').get(job.part_id);

    console.log(`[scheduler] ${printer.name} finished — Part "${part.name}" ${part.completed_qty}/${part.target_qty}`);

    if (part.completed_qty >= part.target_qty) {
      this._closePart(part, now);
    }

    // Printer is now idle — dispatch the next job
    this._dispatchToPrinter(printer).catch(() => {});
  }

  _closePart(part, now) {
    this.db.prepare(`UPDATE parts SET status = 'closed', updated_at = ? WHERE id = ?`)
      .run(now, part.id);

    // Cancel any queued (not yet dispatched) jobs for this part
    this.db.prepare(`
      UPDATE jobs SET status = 'cancelled' WHERE part_id = ? AND status = 'queued'
    `).run(part.id);

    console.log(`[scheduler] Part "${part.name}" closed (${part.completed_qty}/${part.target_qty})`);

    // Check if all parts in the project are now closed
    const openCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM parts WHERE project_id = ? AND status = 'open'
    `).get(part.project_id).count;

    if (openCount === 0) {
      this.db.prepare(`UPDATE projects SET status = 'completed', updated_at = ? WHERE id = ?`)
        .run(now, part.project_id);
      console.log(`[scheduler] Project ${part.project_id} completed!`);
    }
  }

  // ─── Error / offline handling ────────────────────────────────────────────────

  _handlePrinterUnavailable(printer) {
    // Mark any uploading/printing job on this printer as failed
    const job = this.db.prepare(`
      SELECT * FROM jobs
      WHERE printer_id = ? AND status IN ('uploading', 'printing')
      ORDER BY started_at DESC LIMIT 1
    `).get(printer.id);

    if (job) {
      this.db.prepare(`UPDATE jobs SET status = 'failed', finished_at = ? WHERE id = ?`)
        .run(Date.now(), job.id);
      console.warn(`[scheduler] Marked job ${job.id} failed — ${printer.name} went ${printer.status}`);
    }
  }
}

module.exports = JobScheduler;
