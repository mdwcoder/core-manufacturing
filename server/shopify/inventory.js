/**
 * Push CoMa fin_good qty + computed selling price to existing Shopify variants.
 * Price: PUT /variants/{variant_id}.json
 * Stock: POST /inventory_levels/set.json (requires inventory_item_id + location_id)
 * Does not create products or variants.
 *
 * Implemented from Shopify Admin REST Variant + InventoryLevel docs, not yet
 * validated against a real Shopify store.
 */
const {
  num,
  round4,
  finWarehouseId,
  bomCostForItem,
  pricingNumbers,
  configMap,
} = require('../erp/costing');
const { shopifyRequest, setSyncState, getSyncState } = require('./client');

function stockAvailable(db, item_id, warehouse_id) {
  const r = db.prepare(
    'SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_move WHERE item_id = ? AND warehouse_id = ?'
  ).get(item_id, warehouse_id);
  return num(r?.qty);
}

function sellingPriceForItem(db, item) {
  const cfg = configMap(db);
  const cost = bomCostForItem(db, item.id);
  return pricingNumbers(item, cfg, cost).selling_price;
}

function listListings(db) {
  return db.prepare(`
    SELECT l.*, i.sku AS item_sku, i.name AS item_name
    FROM shopify_listing l
    JOIN item i ON i.id = l.item_id
    ORDER BY l.id DESC
  `).all();
}

function createListing(db, body) {
  const b = body || {};
  const itemId = Number(b.item_id);
  const shopifySku = String(b.shopify_sku || '').trim();
  if (!itemId || !shopifySku) {
    return { ok: false, status: 400, error: 'item_id and shopify_sku are required' };
  }
  const item = db.prepare('SELECT id FROM item WHERE id = ?').get(itemId);
  if (!item) return { ok: false, status: 404, error: 'Item not found' };
  const clash = db.prepare('SELECT id FROM shopify_listing WHERE shopify_sku = ?').get(shopifySku);
  if (clash) return { ok: false, status: 409, error: 'shopify_sku already mapped' };

  const r = db.prepare(`
    INSERT INTO shopify_listing
      (item_id, shopify_sku, variant_id, inventory_item_id, location_id, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    itemId,
    shopifySku,
    b.variant_id ? String(b.variant_id) : null,
    b.inventory_item_id ? String(b.inventory_item_id) : null,
    b.location_id ? String(b.location_id) : null
  );
  const row = db.prepare('SELECT * FROM shopify_listing WHERE id = ?').get(r.lastInsertRowid);
  return { ok: true, listing: row };
}

function updateListing(db, id, body) {
  const row = db.prepare('SELECT * FROM shopify_listing WHERE id = ?').get(id);
  if (!row) return { ok: false, status: 404, error: 'Listing not found' };
  const b = body || {};
  const shopifySku = b.shopify_sku != null ? String(b.shopify_sku).trim() : row.shopify_sku;
  if (!shopifySku) return { ok: false, status: 400, error: 'shopify_sku required' };
  if (shopifySku !== row.shopify_sku) {
    const clash = db.prepare(
      'SELECT id FROM shopify_listing WHERE shopify_sku = ? AND id != ?'
    ).get(shopifySku, id);
    if (clash) return { ok: false, status: 409, error: 'shopify_sku already mapped' };
  }
  const itemId = b.item_id != null ? Number(b.item_id) : row.item_id;
  if (b.item_id != null) {
    const item = db.prepare('SELECT id FROM item WHERE id = ?').get(itemId);
    if (!item) return { ok: false, status: 404, error: 'Item not found' };
  }
  db.prepare(`
    UPDATE shopify_listing SET
      item_id = ?,
      shopify_sku = ?,
      variant_id = COALESCE(?, variant_id),
      inventory_item_id = COALESCE(?, inventory_item_id),
      location_id = COALESCE(?, location_id),
      is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    itemId,
    shopifySku,
    b.variant_id !== undefined ? (b.variant_id ? String(b.variant_id) : null) : null,
    b.inventory_item_id !== undefined
      ? (b.inventory_item_id ? String(b.inventory_item_id) : null)
      : null,
    b.location_id !== undefined ? (b.location_id ? String(b.location_id) : null) : null,
    b.is_active != null ? (b.is_active ? 1 : 0) : null,
    id
  );
  return { ok: true, listing: db.prepare('SELECT * FROM shopify_listing WHERE id = ?').get(id) };
}

function deleteListing(db, id) {
  const row = db.prepare('SELECT id FROM shopify_listing WHERE id = ?').get(id);
  if (!row) return { ok: false, status: 404, error: 'Listing not found' };
  db.prepare('DELETE FROM shopify_listing WHERE id = ?').run(id);
  return { ok: true };
}

async function resolveLocationId(db, listing) {
  if (listing.location_id) return listing.location_id;
  const cached = getSyncState(db, 'default_location_id');
  if (cached) return cached;

  const res = await shopifyRequest(db, {
    method: 'GET',
    path: '/locations.json',
  });
  if (!res.ok) return null;
  const locations = res.data?.locations || [];
  const active = locations.find(l => l.active !== false) || locations[0];
  if (!active?.id) return null;
  const locId = String(active.id);
  setSyncState(db, 'default_location_id', locId);
  db.prepare('UPDATE shopify_listing SET location_id = ? WHERE id = ?').run(locId, listing.id);
  return locId;
}

/**
 * Push price + available qty for one mapped listing.
 */
async function pushOneListing(db, listing) {
  const finId = finWarehouseId(db);
  if (!finId) {
    return { ok: false, error: 'FIN_GOOD warehouse not found' };
  }
  const item = db.prepare('SELECT * FROM item WHERE id = ?').get(listing.item_id);
  if (!item) {
    return { ok: false, error: 'Item not found' };
  }

  const qty = Math.max(0, Math.floor(stockAvailable(db, item.id, finId)));
  const price = round4(sellingPriceForItem(db, item));

  if (!listing.variant_id) {
    const msg = 'variant_id required for price/quantity push (map an existing Shopify variant)';
    db.prepare(
      'UPDATE shopify_listing SET last_error = ?, last_push_at = ? WHERE id = ?'
    ).run(msg, Date.now(), listing.id);
    return { ok: false, error: msg, listing_id: listing.id };
  }

  // Official: PUT /admin/api/{version}/variants/{variant_id}.json
  const priceRes = await shopifyRequest(db, {
    method: 'PUT',
    path: `/variants/${listing.variant_id}.json`,
    data: {
      variant: {
        id: Number(listing.variant_id) || listing.variant_id,
        price: String(price),
      },
    },
  });
  if (!priceRes.ok) {
    db.prepare(
      'UPDATE shopify_listing SET last_error = ?, last_push_at = ? WHERE id = ?'
    ).run(priceRes.error, Date.now(), listing.id);
    return { ok: false, error: priceRes.error, listing_id: listing.id, status: priceRes.status };
  }

  // Prefer inventory_item_id from mapping; else from price response variant
  let inventoryItemId = listing.inventory_item_id
    || (priceRes.data?.variant?.inventory_item_id
      ? String(priceRes.data.variant.inventory_item_id)
      : null);

  if (!inventoryItemId) {
    const msg = 'inventory_item_id required for stock push';
    db.prepare(
      'UPDATE shopify_listing SET last_error = ?, last_push_at = ? WHERE id = ?'
    ).run(msg, Date.now(), listing.id);
    return { ok: false, error: msg, listing_id: listing.id };
  }

  if (!listing.inventory_item_id && inventoryItemId) {
    db.prepare('UPDATE shopify_listing SET inventory_item_id = ? WHERE id = ?')
      .run(inventoryItemId, listing.id);
  }

  const locationId = await resolveLocationId(db, listing);
  if (!locationId) {
    const msg = 'location_id required for stock push (no active Shopify location found)';
    db.prepare(
      'UPDATE shopify_listing SET last_error = ?, last_push_at = ? WHERE id = ?'
    ).run(msg, Date.now(), listing.id);
    return { ok: false, error: msg, listing_id: listing.id };
  }

  // Official: POST /admin/api/{version}/inventory_levels/set.json
  const stockRes = await shopifyRequest(db, {
    method: 'POST',
    path: '/inventory_levels/set.json',
    data: {
      location_id: Number(locationId) || locationId,
      inventory_item_id: Number(inventoryItemId) || inventoryItemId,
      available: qty,
    },
  });
  if (!stockRes.ok) {
    db.prepare(
      'UPDATE shopify_listing SET last_error = ?, last_push_at = ? WHERE id = ?'
    ).run(stockRes.error, Date.now(), listing.id);
    return { ok: false, error: stockRes.error, listing_id: listing.id, status: stockRes.status };
  }

  db.prepare(`
    UPDATE shopify_listing SET
      last_pushed_qty = ?, last_pushed_price = ?, last_push_at = ?, last_error = NULL,
      location_id = COALESCE(location_id, ?)
    WHERE id = ?
  `).run(qty, price, Date.now(), locationId, listing.id);

  return {
    ok: true,
    listing_id: listing.id,
    shopify_sku: listing.shopify_sku,
    qty,
    price,
  };
}

async function pushInventory(db, opts = {}) {
  let listings;
  if (opts.listingId) {
    const one = db.prepare('SELECT * FROM shopify_listing WHERE id = ?').get(opts.listingId);
    if (!one) return { ok: false, error: 'Listing not found', results: [] };
    listings = [one];
  } else {
    listings = db.prepare('SELECT * FROM shopify_listing WHERE is_active = 1').all();
  }

  const results = [];
  let okCount = 0;
  let failCount = 0;
  for (const listing of listings) {
    const r = await pushOneListing(db, listing);
    results.push(r);
    if (r.ok) okCount += 1;
    else failCount += 1;
  }

  setSyncState(db, 'last_inventory_push_at', String(Date.now()));
  setSyncState(db, 'last_inventory_push_result', JSON.stringify({ ok: okCount, fail: failCount }));
  if (failCount > 0) {
    setSyncState(db, 'last_inventory_error', results.find(r => !r.ok)?.error || 'push failed');
  } else {
    setSyncState(db, 'last_inventory_error', '');
  }

  return { ok: failCount === 0, ok_count: okCount, fail_count: failCount, results };
}

module.exports = {
  stockAvailable,
  sellingPriceForItem,
  listListings,
  createListing,
  updateListing,
  deleteListing,
  pushOneListing,
  pushInventory,
};
