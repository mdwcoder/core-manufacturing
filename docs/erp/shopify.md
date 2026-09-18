# Shopify Admin API (CoMa ERP / Orders Hub)

Integrates Shopify Admin REST into the embedded ERP via Orders Hub: import orders into `sales_order`, push finished-goods price and quantity to existing variants, and surface connection status.

**Store status:** implemented from Shopify Admin REST docs (Order, Variant, InventoryLevel, Shop, Locations) and custom-app auth. **Not yet validated against a real Shopify store.**

UI lives under Orders Hub: `/erp/orders-hub/shopify` (overview at `/erp/orders-hub`).

## What it does

| Direction | Behavior |
|---|---|
| Shopify to CoMa | Pull orders via `GET /admin/api/{version}/orders.json` with `status=any` and `updated_at_min` watermark; cursor pagination via `Link` `rel=next` |
| CoMa to Shopify | Update price on an existing variant (`PUT /variants/{id}.json`) and available qty (`POST /inventory_levels/set.json`). Does not create products or variants |

## Hybrid order posting

1. Each Shopify line item upserts into `shopify_order` / `shopify_order_line` keyed by `line_item_id` (unique).
2. SKU resolution: `shopify_listing.shopify_sku` first, else exact match on `item.sku`.
3. If `auto_post` is enabled, the SKU is mapped, and `fin_good` stock covers the qty: create `sales_order` + negative `stock_move` with `idem_key = shopify-line-{line_item_id}-sale`, status `auto_posted`.
4. Otherwise the line stays `pending` for the operator (confirm, confirm with shortage, or dismiss).
5. Re-importing the same order never double-fires stock or sales: status check inside the transaction + unique `idem_key`.

This path never touches `parts.completed_qty`.

## Credentials

Stored in `shopify_credential` (single row, id=1). **Excluded from Settings JSON backup** so secrets do not land in export files. After a restore, paste credentials again (or use env vars).

| Source | Keys |
|---|---|
| Env (wins over DB) | `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, optional `SHOPIFY_API_VERSION` |
| DB / UI | Same fields via `PUT /api/erp/shopify/credentials` (API returns masked token only) |

Auth is a custom-app Admin API access token (`X-Shopify-Access-Token` header). There is no OAuth callback flow in this release.

### How to get your keys (operator guide)

Also available in the UI as **How to get your API keys** on the Shopify page. Official help: [Shopify Help: custom apps](https://help.shopify.com/en/manual/apps/app-types/custom-apps).

1. In Shopify Admin go to Settings > Apps and sales channels > Develop apps. Allow custom app development if prompted.
2. Create an app (for example CoMa Orders Hub).
3. Configure Admin API scopes: at least `read_orders`, `read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_locations`. Save.
4. Install the app. On API credentials, reveal the Admin API access token once and copy it. Note the shop domain as `your-store.myshopify.com`.
5. Paste domain + token into CoMa, save, then Test connection.

Default API version pinned in schema: `2025-01` (override via UI or `SHOPIFY_API_VERSION`).

## Inventory push

- Quantity: `SUM(stock_move.qty)` for the mapped item in `fin_good`.
- Price: `bomCostForItem` + `pricingNumbers` (same selling price path as eBay).
- Requires `variant_id` on the mapping. Prefer also setting `inventory_item_id` and `location_id`; if location is blank, CoMa uses the first active location from `GET /locations.json` and caches it.

## Background runner

`server/shopify/runner.js` starts with Express (`shopifyRunner.start(db)`). Interval is 5 minutes. Skips when `DEMO_MODE=true` or credentials are missing. Repeated failures raise an in-memory notification.

## UI

Route `/erp/orders-hub/shopify` (sidebar: Sales / Orders Hub). Connection status, key guide, masked credentials form, SKU mappings, pending queue, recent orders.

## Module layout

| File | Role |
|---|---|
| `server/shopify/schema.js` | CREATE TABLE IF NOT EXISTS |
| `server/shopify/credentials.js` | Env/DB resolution + masking |
| `server/shopify/client.js` | axios, Retry-After, Link pagination |
| `server/shopify/orders.js` | Import + hybrid apply |
| `server/shopify/inventory.js` | Listings CRUD + push |
| `server/shopify/runner.js` | Periodic sync |
| `server/shopify/index.js` | Express factory mounted at `/api/erp/shopify` |

## Troubleshooting

| Symptom | Check |
|---|---|
| Test connection fails | Shop domain (must resolve to `*.myshopify.com`), token from the same store, scopes installed |
| Orders never appear | Custom app has `read_orders`; for older than 60 days also `read_all_orders` |
| Auto-post never runs | Mapping exists, `auto_post` enabled, stock in `fin_good` |
| Push fails with variant_id error | Paste the Shopify variant ID into the mapping |
| Stock push fails on location | Set `location_id`, or ensure the store has at least one active location |
| Credentials vanish after restore | Expected: re-enter them or set env vars |

## Limits (Shopify)

- REST Admin API is legacy but still usable for admin-created custom apps; new public apps must use GraphQL.
- Rate limits: client retries 429/5xx, preferring `Retry-After` when present, else exponential backoff (1s, 2s, 4s).
- Default lookback when no watermark is seven days.
