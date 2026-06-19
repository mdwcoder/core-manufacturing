const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  // ── Filament Types ────────────────────────────────────────────────────────

  router.get('/types', (_req, res) => {
    res.json(db.prepare('SELECT * FROM filament_types ORDER BY name').all());
  });

  router.post('/types', (req, res) => {
    const name = req.body?.name?.trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
      const result = db.prepare('INSERT INTO filament_types (name) VALUES (?)').run(name);
      res.status(201).json(db.prepare('SELECT * FROM filament_types WHERE id = ?').get(result.lastInsertRowid));
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: `"${name}" already exists` });
      throw err;
    }
  });

  // Blocked if any colors belong to this type
  router.delete('/types/:id', (req, res) => {
    const colorCount = db.prepare('SELECT COUNT(*) as count FROM filament_colors WHERE type_id = ?').get(req.params.id);
    if (colorCount.count > 0) {
      return res.status(409).json({ error: `Cannot delete — ${colorCount.count} color(s) belong to this type. Delete them first.` });
    }
    const result = db.prepare('DELETE FROM filament_types WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  // ── Filament Colors ───────────────────────────────────────────────────────

  // Returns colors with their type name included
  router.get('/colors', (_req, res) => {
    res.json(db.prepare(`
      SELECT fc.*, ft.name AS type_name
      FROM filament_colors fc
      JOIN filament_types ft ON ft.id = fc.type_id
      ORDER BY ft.name, fc.name
    `).all());
  });

  router.post('/colors', (req, res) => {
    const name    = req.body?.name?.trim();
    const type_id = parseInt(req.body?.type_id, 10);
    if (!name)         return res.status(400).json({ error: 'name is required' });
    if (!type_id)      return res.status(400).json({ error: 'type_id is required' });
    const typeExists = db.prepare('SELECT 1 FROM filament_types WHERE id = ?').get(type_id);
    if (!typeExists)   return res.status(400).json({ error: 'filament type not found' });
    const hex = req.body?.hex_color?.trim() || null;
    try {
      const result = db.prepare('INSERT INTO filament_colors (type_id, name, hex_color) VALUES (?, ?, ?)').run(type_id, name, hex);
      res.status(201).json(db.prepare(`
        SELECT fc.*, ft.name AS type_name
        FROM filament_colors fc JOIN filament_types ft ON ft.id = fc.type_id
        WHERE fc.id = ?
      `).get(result.lastInsertRowid));
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: `"${name}" already exists for this type` });
      throw err;
    }
  });

  router.delete('/colors/:id', (req, res) => {
    const result = db.prepare('DELETE FROM filament_colors WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
