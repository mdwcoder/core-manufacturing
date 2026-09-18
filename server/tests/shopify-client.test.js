jest.mock('axios');
const axios = require('axios');
const Database = require('better-sqlite3');
const { ensureErpSchema } = require('../erp/schema');
const {
  saveCredentials,
  getMaskedCredentials,
  maskSecret,
  normalizeShopDomain,
} = require('../shopify/credentials');
const {
  shopifyRequest,
  parseLinkHeader,
  BACKOFF_BASE_MS,
} = require('../shopify/client');

function buildDb() {
  const db = new Database(':memory:');
  ensureErpSchema(db);
  saveCredentials(db, {
    shop_domain: 'test-shop.myshopify.com',
    access_token: 'shpat_secret_token_abc',
    api_version: '2025-01',
  });
  return db;
}

describe('Shopify credentials masking', () => {
  test('maskSecret hides middle of long secrets', () => {
    expect(maskSecret('abcdefghijklmnop')).toMatch(/^abcd\*+mnop$/);
  });

  test('normalizeShopDomain strips protocol and path', () => {
    expect(normalizeShopDomain('https://My-Shop.myshopify.com/admin'))
      .toBe('my-shop.myshopify.com');
    expect(normalizeShopDomain('my-shop')).toBe('my-shop.myshopify.com');
  });

  test('getMaskedCredentials never returns full secrets', () => {
    const db = buildDb();
    const masked = getMaskedCredentials(db);
    expect(masked.configured).toBe(true);
    expect(masked.access_token).toContain('********');
    expect(masked.access_token).not.toBe('shpat_secret_token_abc');
    expect(masked.shop_domain).toBe('test-shop.myshopify.com');
    db.close();
  });
});

describe('Shopify REST client', () => {
  let db;

  beforeEach(() => {
    db = buildDb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  test('parseLinkHeader extracts next URL', () => {
    const link = '<https://x.myshopify.com/admin/api/2025-01/orders.json?page_info=abc>; rel="next", <https://x.myshopify.com/admin/api/2025-01/orders.json?page_info=prev>; rel="previous"';
    const parsed = parseLinkHeader(link);
    expect(parsed.next).toContain('page_info=abc');
    expect(parsed.previous).toContain('page_info=prev');
  });

  test('shopifyRequest retries on 429 with backoff', async () => {
    let calls = 0;
    axios.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          headers: { 'retry-after': '1' },
          data: { errors: 'Exceeded' },
        };
      }
      return { status: 200, data: { shop: { name: 'Test' } }, headers: {} };
    });

    const start = Date.now();
    const result = await shopifyRequest(db, {
      method: 'GET',
      path: '/shop.json',
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(BACKOFF_BASE_MS - 50);
  });

  test('shopifyRequest returns error when credentials missing', async () => {
    const empty = new Database(':memory:');
    ensureErpSchema(empty);
    const result = await shopifyRequest(empty, { method: 'GET', path: '/shop.json' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    empty.close();
  });
});
