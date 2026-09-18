/**
 * Shopify credential resolution.
 * Env vars SHOPIFY_SHOP_DOMAIN / SHOPIFY_ACCESS_TOKEN / SHOPIFY_API_VERSION win over DB.
 * API responses never return full secrets (maskSecret).
 */

const DEFAULT_API_VERSION = '2025-01';

function maskSecret(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (s.length <= 8) return '********';
  return s.slice(0, 4) + '********' + s.slice(-4);
}

function isMaskedPlaceholder(value) {
  if (value == null) return true;
  const s = String(value);
  return s === '' || s.includes('********');
}

function normalizeShopDomain(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\/.*$/, '');
  if (!s) return null;
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  return s;
}

function readDbRow(db) {
  return db.prepare('SELECT * FROM shopify_credential WHERE id = 1').get() || null;
}

/**
 * Resolve effective credentials: env overrides DB.
 */
function getCredentials(db) {
  const row = readDbRow(db) || {};
  const shop_domain = normalizeShopDomain(
    process.env.SHOPIFY_SHOP_DOMAIN || row.shop_domain || null
  );
  const access_token = process.env.SHOPIFY_ACCESS_TOKEN || row.access_token || null;
  const api_version = process.env.SHOPIFY_API_VERSION
    || row.api_version
    || DEFAULT_API_VERSION;
  const auto_post = row.auto_post == null ? 1 : Number(row.auto_post);

  return {
    shop_domain,
    access_token,
    api_version,
    auto_post: auto_post ? 1 : 0,
    updated_at: row.updated_at || null,
    source: {
      shop_domain: process.env.SHOPIFY_SHOP_DOMAIN ? 'env' : (row.shop_domain ? 'db' : null),
      access_token: process.env.SHOPIFY_ACCESS_TOKEN ? 'env' : (row.access_token ? 'db' : null),
    },
  };
}

function hasCredentials(db) {
  const c = getCredentials(db);
  return !!(c.shop_domain && c.access_token);
}

function getMaskedCredentials(db) {
  const c = getCredentials(db);
  return {
    shop_domain: c.shop_domain,
    api_version: c.api_version,
    auto_post: c.auto_post,
    updated_at: c.updated_at,
    configured: hasCredentials(db),
    access_token: maskSecret(c.access_token),
    source: c.source,
  };
}

/**
 * Upsert credential fields. Masked placeholders leave the stored secret unchanged.
 */
function saveCredentials(db, body) {
  const b = body || {};
  const existing = readDbRow(db) || {};
  const shop_domain = b.shop_domain != null
    ? normalizeShopDomain(b.shop_domain)
    : normalizeShopDomain(existing.shop_domain);
  const api_version = b.api_version != null
    ? (String(b.api_version).trim() || DEFAULT_API_VERSION)
    : (existing.api_version || DEFAULT_API_VERSION);
  const auto_post = b.auto_post != null
    ? (b.auto_post ? 1 : 0)
    : (existing.auto_post == null ? 1 : existing.auto_post);

  const access_token = isMaskedPlaceholder(b.access_token)
    ? (existing.access_token || null)
    : String(b.access_token).trim();

  const now = Date.now();
  if (existing.id) {
    db.prepare(`
      UPDATE shopify_credential SET
        shop_domain = ?, access_token = ?, api_version = ?, auto_post = ?, updated_at = ?
      WHERE id = 1
    `).run(shop_domain, access_token, api_version, auto_post, now);
  } else {
    db.prepare(`
      INSERT INTO shopify_credential
        (id, shop_domain, access_token, api_version, auto_post, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(shop_domain, access_token, api_version, auto_post, now);
  }
  return getMaskedCredentials(db);
}

module.exports = {
  DEFAULT_API_VERSION,
  maskSecret,
  isMaskedPlaceholder,
  normalizeShopDomain,
  getCredentials,
  hasCredentials,
  getMaskedCredentials,
  saveCredentials,
};
