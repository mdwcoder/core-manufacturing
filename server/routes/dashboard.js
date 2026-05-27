const express = require('express');
const router  = express.Router();

module.exports = (db) => {
  // GET /api/dashboard — single endpoint for the TV dashboard
  // Returns stats, full printer list, active projects with parts, and recent activity.
  router.get('/', (req, res) => {
    const now    = Date.now();
    const since  = now - 24 * 60 * 60 * 1000; // rolling 24-hour window

    // ── Printers (same query as GET /api/printers, with last_parts_per_plate
    //    and last_event_at — most recent printer_events timestamp, used by the
    //    "Needs Attention" panel to show how long a printer has been waiting) ──
    const printers = db.prepare(`
      SELECT p.*,
        (SELECT j.parts_per_plate FROM jobs j
         WHERE j.printer_id = p.id AND j.status = 'finished'
         ORDER BY j.finished_at DESC LIMIT 1) AS last_parts_per_plate,
        (SELECT MAX(e.created_at) FROM printer_events e
         WHERE e.printer_id = p.id) AS last_event_at
      FROM printers p
      WHERE p.is_active = 1
      ORDER BY p.name
    `).all();

    // Derive fleet stats from the live printer list
    const printing = printers.filter(p => p.status === 'PRINTING').length;
    const idle     = printers.filter(p => p.status === 'IDLE' && !p.is_held).length;
    const awaiting = printers.filter(
      p => p.is_held === 1 && (p.status === 'FINISHED' || p.status === 'IDLE')
    ).length;

    // Parts completed in the last 24 hours (sum of parts_per_plate on finished jobs)
    const partsToday = db.prepare(`
      SELECT COALESCE(SUM(parts_per_plate), 0) AS total
      FROM jobs
      WHERE status = 'finished' AND finished_at >= ?
    `).get(since).total;

    // ── Active projects with their parts ──────────────────────────────────────
    const activeProjects = db.prepare(`
      SELECT * FROM projects WHERE status = 'active' ORDER BY created_at ASC
    `).all();

    const projectsWithParts = activeProjects.map(proj => {
      const parts = db.prepare(`
        SELECT parts.*,
          COALESCE((
            SELECT SUM(j.parts_per_plate) FROM jobs j
            WHERE j.part_id = parts.id AND j.status IN ('uploading', 'printing')
          ), 0) AS active_qty
        FROM parts WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC
      `).all(proj.id);
      return { ...proj, parts };
    });

    // ── Recent activity: last 12 finished/failed jobs ─────────────────────────
    const recentActivity = db.prepare(`
      SELECT j.id, j.status, j.parts_per_plate, j.finished_at,
             p.name  AS part_name,
             pr.name AS printer_name
      FROM jobs j
      JOIN parts    p  ON p.id  = j.part_id
      JOIN printers pr ON pr.id = j.printer_id
      WHERE j.status IN ('finished', 'failed')
      ORDER BY j.finished_at DESC
      LIMIT 12
    `).all();

    res.json({
      stats: {
        printing,
        idle,
        awaiting,
        parts_today: partsToday,
      },
      printers,
      active_projects: projectsWithParts,
      recent_activity: recentActivity,
    });
  });

  return router;
};
