/**
 * Sales channel registry for Orders Hub.
 * Available channels have a live connector; planned ones appear as coming soon.
 * Adding a real connector later: new server/{id}/ folder + one entry here.
 */
const CHANNELS = [
  { id: 'ebay', label: 'eBay', status: 'available', api: '/api/erp/ebay', path: '/erp/orders-hub/ebay' },
  { id: 'shopify', label: 'Shopify', status: 'available', api: '/api/erp/shopify', path: '/erp/orders-hub/shopify' },
  { id: 'amazon', label: 'Amazon', status: 'planned' },
  { id: 'mercadolibre', label: 'Mercado Libre', status: 'planned' },
];

function listChannels() {
  return CHANNELS.map(c => ({ ...c }));
}

function getChannel(id) {
  return CHANNELS.find(c => c.id === id) || null;
}

module.exports = { CHANNELS, listChannels, getChannel };
