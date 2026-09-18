/**
 * Shopify Admin API tables in the same SQLite file as shopfloor + ERP.
 * CREATE IF NOT EXISTS only. shopify_credential is intentionally NOT backed up.
 */
function ensureShopifySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_credential (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      shop_domain TEXT,
      access_token TEXT,
      api_version TEXT NOT NULL DEFAULT '2025-01',
      auto_post INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS shopify_listing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES item(id),
      shopify_sku TEXT UNIQUE NOT NULL,
      variant_id TEXT,
      inventory_item_id TEXT,
      location_id TEXT,
      last_pushed_qty REAL,
      last_pushed_price REAL,
      last_push_at INTEGER,
      last_error TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS shopify_order (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at TEXT,
      updated_at TEXT,
      financial_status TEXT,
      fulfillment_status TEXT,
      buyer_email TEXT,
      total_amount REAL,
      currency TEXT,
      raw_json TEXT,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shopify_order_line (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_item_id TEXT UNIQUE NOT NULL,
      shopify_order_id TEXT NOT NULL,
      shopify_sku TEXT,
      title TEXT,
      qty REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      item_id INTEGER REFERENCES item(id),
      status TEXT NOT NULL DEFAULT 'pending',
      sales_order_id INTEGER,
      stock_move_id INTEGER,
      posted_at INTEGER,
      note TEXT,
      shortage_json TEXT,
      FOREIGN KEY (shopify_order_id) REFERENCES shopify_order(order_id)
    );

    CREATE TABLE IF NOT EXISTS shopify_sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed single credential row so UPDATEs always have a target
  const row = db.prepare('SELECT id FROM shopify_credential WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO shopify_credential (id, api_version, auto_post, updated_at)
       VALUES (1, '2025-01', 1, ?)`
    ).run(Date.now());
  }
}

module.exports = { ensureShopifySchema };
