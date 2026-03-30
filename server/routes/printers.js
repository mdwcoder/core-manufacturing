const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const VALID_MODELS = ['mk4', 'mk4s', 'c1', 'c1l', 'xl'];

// Normalize a CSV model column value to internal ID.
// Accepts the canonical value set (case-insensitive): MK4, MK4S, C1, C1L, XL
function normalizeModel(raw) {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  return VALID_MODELS.includes(lower) ? lower : null;
}

// Fallback: infer model from printer name when no model column is present.
function inferModel(name) {
  if (/^MK4S_/i.test(name)) return 'mk4s';
  if (/^MK4_/i.test(name))  return 'mk4';
  if (/^(CoreOne_|Core1L_|C1L )/i.test(name)) return 'c1l';
  if (/^(CoreOne_|Core1_|C1 )/i.test(name))   return 'c1';
  if (/^XL_/i.test(name))   return 'xl';
  return null;
}

// Resolve model: explicit CSV column wins; name inference is the fallback.
function resolveModel(rawModel, name) {
  return normalizeModel(rawModel) || inferModel(name);
}

module.exports = (db) => {
  // GET /api/printers — list all printers
  router.get('/', (req, res) => {
    const printers = db.prepare('SELECT * FROM printers ORDER BY name').all();
    res.json(printers);
  });

  // GET /api/printers/:id
  router.get('/:id', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    res.json(printer);
  });

  // POST /api/printers — add single printer
  router.post('/', (req, res) => {
    const { name, ip, api_key, group_name, type, model } = req.body;
    if (!name || !ip || !api_key || !model) {
      return res.status(400).json({ error: 'name, ip, api_key, and model are required' });
    }
    const normalized = normalizeModel(model);
    if (!normalized) {
      return res.status(400).json({ error: `model must be one of: ${VALID_MODELS.join(', ')}` });
    }
    try {
      const result = db.prepare(`
        INSERT INTO printers (name, ip, api_key, group_name, type, model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(name, ip, api_key, group_name || null, type || 'prusa', normalized, Date.now());
      res.status(201).json(db.prepare('SELECT * FROM printers WHERE id = ?').get(result.lastInsertRowid));
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: `Printer name "${name}" already exists` });
      }
      throw err;
    }
  });

  // PUT /api/printers/:id — update printer
  router.put('/:id', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    const { name, ip, api_key, group_name, type, model, is_held } = req.body;
    let normalized = undefined;
    if (model !== undefined) {
      normalized = normalizeModel(model);
      if (!normalized) {
        return res.status(400).json({ error: `model must be one of: ${VALID_MODELS.join(', ')}` });
      }
    }

    try {
      db.prepare(`
        UPDATE printers
        SET name = COALESCE(?, name),
            ip = COALESCE(?, ip),
            api_key = COALESCE(?, api_key),
            group_name = COALESCE(?, group_name),
            type = COALESCE(?, type),
            model = COALESCE(?, model),
            is_held = COALESCE(?, is_held)
        WHERE id = ?
      `).run(name, ip, api_key, group_name, type, normalized, is_held, req.params.id);

      res.json(db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id));
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: `Printer name "${name}" already exists` });
      }
      throw err;
    }
  });

  // DELETE /api/printers/:id
  router.delete('/:id', (req, res) => {
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    db.prepare('DELETE FROM printers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // POST /api/printers/import — CSV bulk import
  router.post('/import', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvText = req.file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });

    if (parsed.errors.length > 0) {
      return res.status(400).json({ error: 'CSV parse error', details: parsed.errors });
    }

    const rows = parsed.data;
    const summary = { imported: 0, skipped: 0, flagged: [] };

    const insertStmt = db.prepare(`
      INSERT INTO printers (name, ip, api_key, group_name, type, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const existsStmt = db.prepare('SELECT id FROM printers WHERE name = ?');

    for (const row of rows) {
      const name     = (row.name    || '').trim();
      const ip       = (row.ip      || '').trim();
      const api_key  = (row.api_key || '').trim();
      const group_name = (row.group || '').trim() || null;
      const type     = (row.type    || 'prusa').trim();

      if (!name || !ip || !api_key) {
        summary.flagged.push({ row, reason: 'Missing required field (name, ip, or api_key)' });
        continue;
      }

      if (existsStmt.get(name)) {
        summary.skipped++;
        continue;
      }

      const model = resolveModel(row.model, name);
      if (!model) {
        summary.flagged.push({
          row,
          reason: `Could not determine model for "${name}". Add a "model" column (${VALID_MODELS.join(', ')}) or use a recognized name prefix.`,
        });
        continue;
      }

      try {
        insertStmt.run(name, ip, api_key, group_name, type, model, Date.now());
        summary.imported++;
      } catch (err) {
        summary.flagged.push({ row, reason: err.message });
      }
    }

    res.json(summary);
  });

  return router;
};
