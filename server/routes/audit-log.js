const express = require('express');
const router = express.Router();

const { requireAuth, requireMinRole } = require('../auth');

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

module.exports = (db) => {
  // GET /api/audit-log: read-only, manager and admin. Filters are all optional and
  // combine with AND: user_id, action (exact match), entity_type, from/to (created_at
  // range, inclusive, epoch ms). limit/offset paginate, newest first.
  router.get('/', requireAuth(db), requireMinRole('manager'), (req, res) => {
    const { user_id, action, entity_type, from, to } = req.query;

    const clauses = [];
    const params = [];
    if (user_id !== undefined) {
      clauses.push('user_id = ?');
      params.push(parseInt(user_id, 10));
    }
    if (action) {
      clauses.push('action = ?');
      params.push(String(action));
    }
    if (entity_type) {
      clauses.push('entity_type = ?');
      params.push(String(entity_type));
    }
    if (from !== undefined) {
      clauses.push('created_at >= ?');
      params.push(parseInt(from, 10));
    }
    if (to !== undefined) {
      clauses.push('created_at <= ?');
      params.push(parseInt(to, 10));
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);
    let offset = parseInt(req.query.offset, 10);
    if (isNaN(offset) || offset < 0) offset = 0;

    // id DESC as a tiebreaker: two rows in the same millisecond (common for two writes
    // in one request handler) must still sort newest-first deterministically.
    const rows = db.prepare(`
      SELECT * FROM audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_log ${where}`).get(...params).count;

    res.json({ rows, total, limit, offset });
  });

  return router;
};
