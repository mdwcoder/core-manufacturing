const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const GCODE_DIR = path.join(__dirname, '..', 'gcode');

const storage = multer.diskStorage({
  destination: GCODE_DIR,
  filename: (_req, file, cb) => cb(null, Date.now() + '_' + file.originalname),
});
const upload = multer({ storage });

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Model token in filename → internal ID
const MODEL_TOKEN_MAP = {
  mk4s: 'mk4s',
  mk4:  'mk4',
  c1l:  'c1l',
  c1:   'c1',
  core1l: 'c1l',
  coreone: 'c1',
  core1:   'c1',
  xl:   'xl',
};

function parseFilename(filename) {
  const regex = /^(\d+)x\s+(.+?)_(\d+\.\d+n)_(\d+\.\d+mm)_([A-Za-z]+)_([A-Za-z0-9]+)_(\d+h\d+m)\.(bgcode|gcode)$/i;
  const match = filename.match(regex);
  if (!match) return null;

  const parts_per_plate = parseInt(match[1], 10);
  const model_token = match[6].toLowerCase();
  const printer_model = MODEL_TOKEN_MAP[model_token] || null;

  // Parse "5h11m" → seconds
  const timeMatch = match[7].match(/(\d+)h(\d+)m/);
  const est_print_secs = timeMatch
    ? parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60
    : null;

  return { parts_per_plate, printer_model, est_print_secs, part_name_hint: match[2] };
}

module.exports = (db) => {
  // GET /api/gcodes — list, optionally filtered by part_id
  router.get('/', (req, res) => {
    const { part_id } = req.query;
    const gcodes = part_id
      ? db.prepare('SELECT * FROM gcodes WHERE part_id = ?').all(part_id)
      : db.prepare('SELECT * FROM gcodes ORDER BY created_at DESC').all();
    res.json(gcodes);
  });

  // POST /api/gcodes/parse-filename — parse filename, return fields, don't save anything
  router.post('/parse-filename', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename is required' });
    const parsed = parseFilename(filename);
    if (!parsed) {
      return res.json({ parse_failed: true });
    }
    res.json({ parse_failed: false, ...parsed });
  });

  // POST /api/gcodes/upload — upload G-code file and create DB record
  router.post('/upload', async (req, res) => {
    try {
      await runUpload(req, res);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { part_id, parts_per_plate, printer_model, est_print_secs } = req.body;

    if (!part_id || !parts_per_plate || !printer_model) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'part_id, parts_per_plate, and printer_model are required' });
    }

    const VALID_MODELS = ['mk4', 'mk4s', 'c1', 'c1l', 'xl'];
    if (!VALID_MODELS.includes(printer_model)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `printer_model must be one of: ${VALID_MODELS.join(', ')}` });
    }

    // Enforce uniqueness on (part_id, printer_model) at app layer
    const existing = db.prepare(
      'SELECT id FROM gcodes WHERE part_id = ? AND printer_model = ?'
    ).get(part_id, printer_model);
    if (existing) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({
        error: `This Part already has a G-code for ${printer_model}. Delete the existing one before uploading a replacement.`,
      });
    }

    const gcode = db.prepare(`
      INSERT INTO gcodes (part_id, printer_model, filename, filepath, parts_per_plate, est_print_secs, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      part_id,
      printer_model,
      req.file.originalname,
      req.file.filename,
      parseInt(parts_per_plate, 10),
      est_print_secs ? parseInt(est_print_secs, 10) : null,
      Date.now()
    );

    res.status(201).json(db.prepare('SELECT * FROM gcodes WHERE id = ?').get(gcode.lastInsertRowid));
  });

  // DELETE /api/gcodes/:id
  router.delete('/:id', (req, res) => {
    const gcode = db.prepare('SELECT * FROM gcodes WHERE id = ?').get(req.params.id);
    if (!gcode) return res.status(404).json({ error: 'G-code not found' });

    const activeJob = db.prepare(
      "SELECT id FROM jobs WHERE gcode_id = ? AND status IN ('queued', 'uploading', 'printing') LIMIT 1"
    ).get(req.params.id);
    if (activeJob) {
      return res.status(409).json({ error: 'Cannot delete — this G-code has an active job in progress.' });
    }

    // Detach historical jobs so the FK doesn't block deletion
    db.prepare("UPDATE jobs SET gcode_id = NULL WHERE gcode_id = ?").run(req.params.id);

    const gcodeFilename = gcode.filepath.split(/[\\/]/).pop();
    const fullPath = path.join(GCODE_DIR, gcodeFilename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    db.prepare('DELETE FROM gcodes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  return router;
};
