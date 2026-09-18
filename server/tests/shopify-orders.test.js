jest.mock('axios');
const axios = require('axios');
const Database = require('better-sqlite3');
const { ensureErpSchema } = require('../erp/schema');
const { saveCredentials } = require('../shopify/credentials');
const {
  syncOrders,
  upsertOrder,
  confirmLine,
} = require('../shopify/orders');

function seedFgItem(db, { sku = 'FG-WIDGET', qty = 10, wac = 5 } = {}) {
  const fin = db.prepare("SELECT id FROM warehouse WHERE lower(code)='fin_good'").get();
  const item = db.prepare(`
    INSERT INTO item (sku, name, warehouse_id, dimension, display_uom_code, purchase_uom_code, is_active, item_role, sourcing)
    VALUES (?, 'Widget', ?, 'COUNT', 'EA', 'EA', 1, 'product', 'manufactured')
  `).run(sku, fin.id);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stock_move (item_id, warehouse_id, qty, unit_cost, created_at, trans_date, note, idem_key)
    VALUES (?, ?, ?, ?, ?, ?, 'seed', ?)
  `).run(item.lastInsertRowid, fin.id, qty, wac, now, now, `seed-${sku}`);
  db.prepare(`
    INSERT INTO item_cost (item_id, warehouse_id, wac, qty_on_hand, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(item.lastInsertRowid, fin.id, wac, qty, now);
  return { itemId: item.lastInsertRowid, finId: fin.id };
}

function buildDb() {
  const db = new Database(':memory:');
  ensureErpSchema(db);
  saveCredentials(db, {
    shop_domain: 'test.myshopify.com',
    access_token: 'shpat_tok',
    auto_post: 1,
  });
  return db;
}

function sampleOrder({
  orderId = 1001,
  lineId = 2001,
  sku = 'SHOP-WIDGET',
  qty = 2,
  unit = 12,
} = {}) {
  return {
    id: orderId,
    name: `#${orderId}`,
    created_at: '2026-09-17T10:00:00.000Z',
    updated_at: '2026-09-17T10:05:00.000Z',
    financial_status: 'paid',
    fulfillment_status: null,
    email: 'buyer@example.com',
    currency: 'USD',
    total_price: String(unit * qty),
    line_items: [{
      id: lineId,
      sku,
      title: 'Widget',
      quantity: qty,
      price: String(unit),
    }],
  };
}

describe('Shopify order import hybrid posting', () => {
  let db;

  beforeEach(() => {
    db = buildDb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  test('auto-posts when SKU mapped and stock sufficient', async () => {
    const { itemId } = seedFgItem(db, { qty: 10 });
    db.prepare(`
      INSERT INTO shopify_listing (item_id, shopify_sku, variant_id, is_active)
      VALUES (?, 'SHOP-WIDGET', 'var-1', 1)
    `).run(itemId);

    axios.mockResolvedValueOnce({
      status: 200,
      data: { orders: [sampleOrder()] },
      headers: {},
    });

    const result = await syncOrders(db);
    expect(result.ok).toBe(true);
    expect(result.auto_posted).toBe(1);
    const line = db.prepare("SELECT * FROM shopify_order_line WHERE line_item_id = '2001'").get();
    expect(line.status).toBe('auto_posted');
    expect(line.sales_order_id).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales_order').get().n).toBe(1);
    expect(db.prepare("SELECT qty FROM stock_move WHERE idem_key = 'shopify-line-2001-sale'").get().qty).toBe(-2);
  });

  test('queues when stock is short', async () => {
    const { itemId } = seedFgItem(db, { qty: 1 });
    db.prepare(`
      INSERT INTO shopify_listing (item_id, shopify_sku, variant_id, is_active)
      VALUES (?, 'SHOP-WIDGET', 'var-1', 1)
    `).run(itemId);

    axios.mockResolvedValueOnce({
      status: 200,
      data: { orders: [sampleOrder({ qty: 5 })] },
      headers: {},
    });

    const result = await syncOrders(db);
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(1);
    const line = db.prepare("SELECT * FROM shopify_order_line WHERE line_item_id = '2001'").get();
    expect(line.status).toBe('pending');
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales_order').get().n).toBe(0);
  });

  test('queues when SKU is unmapped', async () => {
    seedFgItem(db, { qty: 10 });
    axios.mockResolvedValueOnce({
      status: 200,
      data: { orders: [sampleOrder({ sku: 'UNKNOWN-SKU' })] },
      headers: {},
    });

    const result = await syncOrders(db);
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(1);
    const line = db.prepare("SELECT * FROM shopify_order_line WHERE line_item_id = '2001'").get();
    expect(line.status).toBe('pending');
    expect(line.item_id).toBeNull();
  });

  test('reimporting the same order does not duplicate sales_order or stock_move', async () => {
    const { itemId } = seedFgItem(db, { qty: 10 });
    db.prepare(`
      INSERT INTO shopify_listing (item_id, shopify_sku, variant_id, is_active)
      VALUES (?, 'SHOP-WIDGET', 'var-1', 1)
    `).run(itemId);

    axios.mockResolvedValue({
      status: 200,
      data: { orders: [sampleOrder()] },
      headers: {},
    });

    const first = await syncOrders(db);
    expect(first.auto_posted).toBe(1);
    const second = await syncOrders(db);
    expect(second.ok).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales_order').get().n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM stock_move WHERE idem_key = 'shopify-line-2001-sale'").get().n).toBe(1);
  });

  test('confirmLine with acknowledge_shortage posts when short', () => {
    const { itemId } = seedFgItem(db, { qty: 0 });
    db.prepare(`
      INSERT INTO shopify_order
        (order_id, name, created_at, updated_at, raw_json, imported_at)
      VALUES ('1001', '#1001', '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z', '{}', ?)
    `).run(Date.now());
    const line = db.prepare(`
      INSERT INTO shopify_order_line
        (line_item_id, shopify_order_id, shopify_sku, title, qty, unit_price, total_price, item_id, status)
      VALUES ('2001', '1001', 'SHOP-WIDGET', 'Widget', 2, 12, 24, ?, 'pending')
    `).run(itemId);

    const denied = confirmLine(db, line.lastInsertRowid, {});
    expect(denied.ok).toBe(false);
    expect(denied.acknowledge_required).toBe(true);

    const ok = confirmLine(db, line.lastInsertRowid, { acknowledge_shortage: true });
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe('posted');
  });

  test('upsertOrder does not rewrite posted lines', () => {
    seedFgItem(db, { qty: 10 });
    const lines = upsertOrder(db, sampleOrder());
    db.prepare("UPDATE shopify_order_line SET status = 'posted', qty = 2 WHERE id = ?").run(lines[0].id);
    upsertOrder(db, sampleOrder({ qty: 99 }));
    const line = db.prepare("SELECT * FROM shopify_order_line WHERE line_item_id = '2001'").get();
    expect(line.status).toBe('posted');
    expect(line.qty).toBe(2);
  });
});
