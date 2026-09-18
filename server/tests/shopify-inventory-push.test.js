jest.mock('axios');
const axios = require('axios');
const Database = require('better-sqlite3');
const { ensureErpSchema } = require('../erp/schema');
const { saveCredentials } = require('../shopify/credentials');
const {
  pushInventory,
  createListing,
} = require('../shopify/inventory');
const { bomCostForItem, pricingNumbers, configMap } = require('../erp/costing');

function buildDb() {
  const db = new Database(':memory:');
  ensureErpSchema(db);
  saveCredentials(db, {
    shop_domain: 'test.myshopify.com',
    access_token: 'shpat_tok',
  });
  const fin = db.prepare("SELECT id FROM warehouse WHERE lower(code)='fin_good'").get();
  const item = db.prepare(`
    INSERT INTO item (sku, name, warehouse_id, dimension, display_uom_code, purchase_uom_code, is_active, item_role, sourcing)
    VALUES ('FG-1', 'Product', ?, 'COUNT', 'EA', 'EA', 1, 'product', 'manufactured')
  `).run(fin.id);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stock_move (item_id, warehouse_id, qty, unit_cost, created_at, trans_date, idem_key)
    VALUES (?, ?, 7, 4, ?, ?, 'seed-fg')
  `).run(item.lastInsertRowid, fin.id, now, now);
  db.prepare(`
    INSERT INTO item_cost (item_id, warehouse_id, wac, qty_on_hand, created_at)
    VALUES (?, ?, 4, 7, ?)
  `).run(item.lastInsertRowid, fin.id, now);
  db.prepare("UPDATE pricing_config SET value = 10 WHERE code = 'MARGIN_DEF'").run();
  db.prepare("UPDATE pricing_config SET value = 5 WHERE code = 'ADDS_PCT'").run();
  db.prepare("UPDATE pricing_config SET value = 12 WHERE code = 'EBAY_FEE'").run();
  return { db, itemId: item.lastInsertRowid, finId: fin.id };
}

describe('Shopify inventory push', () => {
  let db;
  let itemId;

  beforeEach(() => {
    ({ db, itemId } = buildDb());
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  test('pushes computed qty and selling price for one variant', async () => {
    createListing(db, {
      item_id: itemId,
      shopify_sku: 'SHOP-FG-1',
      variant_id: '555',
      inventory_item_id: '777',
      location_id: '888',
    });

    const item = db.prepare('SELECT * FROM item WHERE id = ?').get(itemId);
    const expectedPrice = pricingNumbers(item, configMap(db), bomCostForItem(db, itemId)).selling_price;

    let pricePayload;
    let stockPayload;
    axios.mockImplementation(async (cfg) => {
      const url = String(cfg.url || '');
      if (url.includes('/variants/555.json') && cfg.method === 'PUT') {
        pricePayload = cfg.data;
        return { status: 200, data: { variant: { id: 555, inventory_item_id: 777 } }, headers: {} };
      }
      if (url.includes('/inventory_levels/set.json')) {
        stockPayload = cfg.data;
        return { status: 200, data: { inventory_level: {} }, headers: {} };
      }
      return { status: 200, data: {}, headers: {} };
    });

    const result = await pushInventory(db);
    expect(result.ok).toBe(true);
    expect(result.ok_count).toBe(1);
    expect(Number(pricePayload.variant.price)).toBe(expectedPrice);
    expect(stockPayload.available).toBe(7);
    expect(String(stockPayload.inventory_item_id)).toBe('777');
    expect(String(stockPayload.location_id)).toBe('888');

    const listing = db.prepare('SELECT * FROM shopify_listing WHERE shopify_sku = ?').get('SHOP-FG-1');
    expect(listing.last_pushed_qty).toBe(7);
    expect(listing.last_pushed_price).toBe(expectedPrice);
    expect(listing.last_error).toBeNull();
  });

  test('persists error without throwing when variant_id missing', async () => {
    createListing(db, { item_id: itemId, shopify_sku: 'SHOP-FG-1', variant_id: null });
    const result = await pushInventory(db);
    expect(result.ok).toBe(false);
    expect(result.fail_count).toBe(1);
    const listing = db.prepare('SELECT last_error FROM shopify_listing WHERE shopify_sku = ?').get('SHOP-FG-1');
    expect(listing.last_error).toMatch(/variant_id/);
  });
});
