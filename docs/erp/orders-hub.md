# Orders Hub

Unified entry point for marketplace sales channels inside CoMa ERP. Operators open `/erp/orders-hub` to see every connector, configure credentials, and jump into channel-specific pages. Today **eBay** and **Shopify** are live; **Amazon** and **Mercado Libre** appear as coming soon.

## What it does

| Piece | Role |
|---|---|
| Overview UI | `/erp/orders-hub` cards with configured flag, pending lines, last sync |
| Channel pages | `/erp/orders-hub/ebay`, `/erp/orders-hub/shopify` (legacy `/erp/ebay` still works) |
| Aggregator API | `GET /api/erp/channels` |
| Registry | `server/channels/registry.js` |

Each available channel keeps its own tables, credentials, runner, and hybrid posting path. Orders Hub only aggregates status; it never posts stock itself.

## In-app key guides

Every channel page embeds a collapsible **How to get your API keys** guide (`client/src/pages/erp/ordersHub/guides.js` + `ChannelGuide.jsx`) with numbered steps and links to the official portal. Guides are English, same as the rest of the operator UI.

## Registry pattern (how to add a channel later)

1. Add `server/{id}/` mirroring `server/ebay/` or `server/shopify/` (schema, credentials, client, orders, inventory, runner, routes).
2. Call `ensure{Id}Schema` from `server/erp/schema.js`.
3. Mount routes before `/api/erp` in `server/index.js` and start the runner.
4. Add one entry to `CHANNELS` in `server/channels/registry.js` with `status: 'available'`.
5. Add live enrichment in `server/channels/index.js`.
6. Add a `CHANNEL_GUIDES` entry and a React page under `client/src/pages/erp/ordersHub/`.
7. Wire nav (already points at Orders Hub), backup optional tables, docs, and tests.

Planned channels stay `status: 'planned'` until a real connector ships. Do not invent protocol fields; read official docs first.

## Related docs

- [docs/erp/ebay.md](ebay.md)
- [docs/erp/shopify.md](shopify.md)
- [docs/erp/README.md](README.md)
