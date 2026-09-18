/**
 * Shopify Admin REST client.
 * Auth: X-Shopify-Access-Token header (custom app token).
 * Base: https://{shop}/admin/api/{version}
 * Retries 429/5xx respecting Retry-After when present.
 * Background paths return { ok: false, error } instead of throwing.
 *
 * Implemented from Shopify Admin REST docs (shopify.dev), not yet validated
 * against a real Shopify store.
 */
const axios = require('axios');
const { getCredentials, hasCredentials } = require('./credentials');

// Must exceed one Shopify rate-limit window slice; three attempts with 1s/2s/4s
// backoff covers transient 429/5xx without blocking the poller for minutes.
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

function setSyncState(db, key, value) {
  try {
    db.prepare(
      'INSERT INTO shopify_sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, String(value));
  } catch (_) { /* ignore */ }
}

function getSyncState(db, key) {
  try {
    const row = db.prepare('SELECT value FROM shopify_sync_state WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function baseUrl(creds) {
  return `https://${creds.shop_domain}/admin/api/${creds.api_version}`;
}

/**
 * Parse Shopify Link header for cursor pagination.
 * Official format: <url>; rel="next", <url>; rel="previous"
 */
function parseLinkHeader(linkHeader) {
  if (!linkHeader) return {};
  const out = {};
  const parts = String(linkHeader).split(',');
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/**
 * Authenticated Shopify Admin REST call.
 * @param {object} db
 * @param {{ method?: string, path: string, params?: object, data?: object, headers?: object, absoluteUrl?: string }} opts
 */
async function shopifyRequest(db, opts) {
  if (!hasCredentials(db)) {
    return { ok: false, error: 'Shopify credentials not configured' };
  }

  const creds = getCredentials(db);
  const url = opts.absoluteUrl
    || (opts.path.startsWith('http') ? opts.path : `${baseUrl(creds)}${opts.path}`);
  const method = (opts.method || 'GET').toUpperCase();

  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await axios({
        method,
        url,
        params: opts.params,
        data: opts.data,
        headers: {
          'X-Shopify-Access-Token': creds.access_token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(opts.headers || {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastError = {
          ok: false,
          error: `Shopify HTTP ${res.status}`,
          status: res.status,
          data: res.data,
        };
        const retryAfter = Number(res.headers?.['retry-after']);
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : BACKOFF_BASE_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        const msg = res.data?.errors
          ? (typeof res.data.errors === 'string'
            ? res.data.errors
            : JSON.stringify(res.data.errors))
          : `Shopify HTTP ${res.status}`;
        return { ok: false, error: String(msg), status: res.status, data: res.data };
      }

      return {
        ok: true,
        status: res.status,
        data: res.data,
        link: parseLinkHeader(res.headers?.link || res.headers?.Link),
      };
    } catch (err) {
      lastError = { ok: false, error: err.message || String(err) };
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  return lastError || { ok: false, error: 'Shopify request failed' };
}

async function testConnection(db) {
  const probe = await shopifyRequest(db, {
    method: 'GET',
    path: '/shop.json',
  });
  if (!probe.ok) return probe;
  const shop = probe.data?.shop || {};
  return {
    ok: true,
    shop_domain: getCredentials(db).shop_domain,
    api_version: getCredentials(db).api_version,
    shop_name: shop.name || null,
    shop_id: shop.id || null,
  };
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
  BACKOFF_BASE_MS,
  setSyncState,
  getSyncState,
  parseLinkHeader,
  shopifyRequest,
  testConnection,
};
