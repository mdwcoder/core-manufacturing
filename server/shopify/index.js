/**
 * Express routes for Shopify Admin integration under /api/erp/shopify.
 * Factory pattern: (db) => router. Static paths before parameterized ones.
 */
const express = require('express');
const {
  getMaskedCredentials,
  saveCredentials,
  hasCredentials,
} = require('./credentials');
const { testConnection, getSyncState } = require('./client');
const {
  syncOrders,
  confirmLine,
  dismissLine,
  listPending,
  listOrders,
  getOrder,
} = require('./orders');
const {
  listListings,
  createListing,
  updateListing,
  deleteListing,
  pushInventory,
} = require('./inventory');

function mountShopify(db) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    const masked = getMaskedCredentials(db);
    res.json({
      configured: masked.configured,
      shop_domain: masked.shop_domain,
      api_version: masked.api_version,
      auto_post: masked.auto_post,
      last_orders_sync_at: getSyncState(db, 'last_orders_sync_at'),
      last_orders_error: getSyncState(db, 'last_orders_error') || null,
      last_orders_result: (() => {
        try { return JSON.parse(getSyncState(db, 'last_orders_result') || 'null'); } catch (_) { return null; }
      })(),
      last_inventory_push_at: getSyncState(db, 'last_inventory_push_at'),
      last_inventory_error: getSyncState(db, 'last_inventory_error') || null,
      orders_updated_at_min: getSyncState(db, 'orders_updated_at_min'),
      pending_count: db.prepare(
        "SELECT COUNT(*) AS n FROM shopify_order_line WHERE status = 'pending'"
      ).get().n,
      listing_count: db.prepare(
        'SELECT COUNT(*) AS n FROM shopify_listing WHERE is_active = 1'
      ).get().n,
    });
  });

  router.get('/credentials', (_req, res) => {
    res.json(getMaskedCredentials(db));
  });

  router.put('/credentials', (req, res) => {
    try {
      const result = saveCredentials(db, req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/test-connection', async (_req, res) => {
    if (!hasCredentials(db)) {
      return res.status(400).json({ error: 'Shopify credentials not configured' });
    }
    const result = await testConnection(db);
    if (!result.ok) return res.status(502).json({ error: result.error });
    res.json(result);
  });

  router.get('/listings', (_req, res) => {
    res.json({ listings: listListings(db) });
  });

  router.post('/listings', (req, res) => {
    const result = createListing(db, req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result.listing);
  });

  router.put('/listings/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const result = updateListing(db, id, req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json(result.listing);
  });

  router.delete('/listings/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const result = deleteListing(db, id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  router.post('/inventory/push', async (req, res) => {
    if (!hasCredentials(db)) {
      return res.status(400).json({ error: 'Shopify credentials not configured' });
    }
    const listingId = req.body?.listing_id ? parseInt(req.body.listing_id, 10) : null;
    const result = await pushInventory(db, { listingId: listingId || undefined });
    if (!result.ok && result.results?.length === 0 && result.error) {
      return res.status(404).json({ error: result.error });
    }
    res.json(result);
  });

  router.post('/orders/sync', async (_req, res) => {
    if (!hasCredentials(db)) {
      return res.status(400).json({ error: 'Shopify credentials not configured' });
    }
    const result = await syncOrders(db);
    if (!result.ok) return res.status(502).json(result);
    res.json(result);
  });

  router.get('/orders', (req, res) => {
    const data = listOrders(db, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(data);
  });

  router.get('/orders/:orderId', (req, res) => {
    const order = getOrder(db, req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  });

  router.get('/pending', (_req, res) => {
    const rows = listPending(db).map(r => {
      let shortage = null;
      if (r.shortage_json) {
        try { shortage = JSON.parse(r.shortage_json); } catch (_) { shortage = null; }
      }
      return { ...r, shortage, shortage_json: undefined };
    });
    res.json({ lines: rows });
  });

  router.post('/pending/:lineId/confirm', (req, res) => {
    const lineId = parseInt(req.params.lineId, 10);
    if (!lineId) return res.status(400).json({ error: 'invalid lineId' });
    const result = confirmLine(db, lineId, {
      acknowledge_shortage: !!(req.body && req.body.acknowledge_shortage),
    });
    if (!result.ok) {
      const body = { error: result.error };
      if (result.acknowledge_required) {
        body.acknowledge_required = true;
        body.missing = result.missing;
      }
      if (result.unmapped) body.unmapped = true;
      return res.status(result.status || 400).json(body);
    }
    res.json(result);
  });

  router.post('/pending/:lineId/dismiss', (req, res) => {
    const lineId = parseInt(req.params.lineId, 10);
    if (!lineId) return res.status(400).json({ error: 'invalid lineId' });
    const result = dismissLine(db, lineId);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  return router;
}

module.exports = { mountShopify };
