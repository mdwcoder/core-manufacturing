jest.mock('axios');
const axios = require('axios');
const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const { ensureErpSchema } = require('../erp/schema');
const { mountShopify } = require('../shopify');
const { mountChannels } = require('../channels');

function buildApp() {
  const db = new Database(':memory:');
  ensureErpSchema(db);
  const app = express();
  app.use(express.json());
  app.use('/api/erp/shopify', mountShopify(db));
  app.use('/api/erp/channels', mountChannels(db));
  return { app, db };
}

describe('Shopify routes', () => {
  let app;
  let db;

  beforeEach(() => {
    ({ app, db } = buildApp());
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  test('GET /status and GET /credentials work without secrets configured', async () => {
    const status = await request(app).get('/api/erp/shopify/status');
    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(false);

    const creds = await request(app).get('/api/erp/shopify/credentials');
    expect(creds.status).toBe(200);
    expect(creds.body.configured).toBe(false);
  });

  test('PUT /credentials saves and masks secrets', async () => {
    const res = await request(app).put('/api/erp/shopify/credentials').send({
      shop_domain: 'demo.myshopify.com',
      access_token: 'shpat_my_secret_token_999',
      api_version: '2025-01',
      auto_post: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.access_token).toContain('********');
    expect(res.body.access_token).not.toContain('shpat_my_secret_token_999');
    expect(res.body.shop_domain).toBe('demo.myshopify.com');
  });

  test('POST /listings validates required fields', async () => {
    const res = await request(app).post('/api/erp/shopify/listings').send({ shopify_sku: 'X' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/item_id/);
  });

  test('POST /listings 404 when item missing', async () => {
    const res = await request(app).post('/api/erp/shopify/listings').send({
      item_id: 9999,
      shopify_sku: 'X',
    });
    expect(res.status).toBe(404);
  });

  test('listing create + pending confirm 409 with acknowledge_required', async () => {
    const fin = db.prepare("SELECT id FROM warehouse WHERE lower(code)='fin_good'").get();
    const item = db.prepare(`
      INSERT INTO item (sku, name, warehouse_id, dimension, display_uom_code, purchase_uom_code, is_active, item_role, sourcing)
      VALUES ('FG-A', 'A', ?, 'COUNT', 'EA', 'EA', 1, 'product', 'manufactured')
    `).run(fin.id);

    const created = await request(app).post('/api/erp/shopify/listings').send({
      item_id: item.lastInsertRowid,
      shopify_sku: 'SHOP-A',
      variant_id: 'var-1',
    });
    expect(created.status).toBe(201);

    db.prepare(`
      INSERT INTO shopify_order
        (order_id, name, created_at, updated_at, raw_json, imported_at)
      VALUES ('ORD-X', '#1001', '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z', '{}', ?)
    `).run(Date.now());
    const line = db.prepare(`
      INSERT INTO shopify_order_line
        (line_item_id, shopify_order_id, shopify_sku, title, qty, unit_price, total_price, item_id, status)
      VALUES ('LINE-X', 'ORD-X', 'SHOP-A', 'A', 2, 10, 20, ?, 'pending')
    `).run(item.lastInsertRowid);

    const confirm = await request(app)
      .post(`/api/erp/shopify/pending/${line.lastInsertRowid}/confirm`)
      .send({});
    expect(confirm.status).toBe(409);
    expect(confirm.body.acknowledge_required).toBe(true);

    const ack = await request(app)
      .post(`/api/erp/shopify/pending/${line.lastInsertRowid}/confirm`)
      .send({ acknowledge_shortage: true });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('posted');

    const again = await request(app)
      .post(`/api/erp/shopify/pending/${line.lastInsertRowid}/confirm`)
      .send({ acknowledge_shortage: true });
    expect(again.status).toBe(409);
  });

  test('POST /test-connection returns 400 when not configured', async () => {
    const res = await request(app).post('/api/erp/shopify/test-connection');
    expect(res.status).toBe(400);
  });

  test('GET /api/erp/channels lists available and planned channels', async () => {
    const res = await request(app).get('/api/erp/channels');
    expect(res.status).toBe(200);
    const ids = res.body.channels.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['ebay', 'shopify', 'amazon', 'mercadolibre']));
    const shopify = res.body.channels.find(c => c.id === 'shopify');
    expect(shopify.status).toBe('available');
    expect(shopify.live).toMatchObject({ configured: false, pending_count: 0 });
    const amazon = res.body.channels.find(c => c.id === 'amazon');
    expect(amazon.status).toBe('planned');
    expect(amazon.live).toBeNull();
  });
});
