/**
 * Orders Hub channel aggregator under /api/erp/channels.
 * Returns registry entries plus live counts for available connectors (direct DB, no HTTP hop).
 */
const express = require('express');
const { listChannels } = require('./registry');
const { hasCredentials: ebayHas } = require('../ebay/credentials');
const { getSyncState: ebaySync } = require('../ebay/client');
const { hasCredentials: shopifyHas } = require('../shopify/credentials');
const { getSyncState: shopifySync } = require('../shopify/client');

function liveForEbay(db) {
  let pending_count = 0;
  let listing_count = 0;
  try {
    pending_count = db.prepare(
      "SELECT COUNT(*) AS n FROM ebay_order_line WHERE status = 'pending'"
    ).get().n;
    listing_count = db.prepare(
      'SELECT COUNT(*) AS n FROM ebay_listing WHERE is_active = 1'
    ).get().n;
  } catch (_) { /* tables may be absent on very old DBs */ }
  return {
    configured: ebayHas(db),
    pending_count,
    listing_count,
    last_orders_sync_at: ebaySync(db, 'last_orders_sync_at'),
    last_orders_error: ebaySync(db, 'last_orders_error') || null,
  };
}

function liveForShopify(db) {
  let pending_count = 0;
  let listing_count = 0;
  try {
    pending_count = db.prepare(
      "SELECT COUNT(*) AS n FROM shopify_order_line WHERE status = 'pending'"
    ).get().n;
    listing_count = db.prepare(
      'SELECT COUNT(*) AS n FROM shopify_listing WHERE is_active = 1'
    ).get().n;
  } catch (_) { /* tables may be absent on very old DBs */ }
  return {
    configured: shopifyHas(db),
    pending_count,
    listing_count,
    last_orders_sync_at: shopifySync(db, 'last_orders_sync_at'),
    last_orders_error: shopifySync(db, 'last_orders_error') || null,
  };
}

function enrichChannel(db, channel) {
  if (channel.status !== 'available') {
    return { ...channel, live: null };
  }
  if (channel.id === 'ebay') return { ...channel, live: liveForEbay(db) };
  if (channel.id === 'shopify') return { ...channel, live: liveForShopify(db) };
  return { ...channel, live: null };
}

function mountChannels(db) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const channels = listChannels().map(c => enrichChannel(db, c));
    res.json({ channels });
  });

  return router;
}

module.exports = { mountChannels, enrichChannel };
