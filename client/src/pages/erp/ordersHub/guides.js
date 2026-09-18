/**
 * In-app "how to get your API keys" guides per sales channel.
 * Steps are written from official developer docs; verify links if portals change.
 */

export const CHANNEL_GUIDES = {
  ebay: {
    title: 'How to get your eBay API keys',
    officialUrl: 'https://developer.ebay.com/my/keys',
    officialLabel: 'eBay Developer Program (My Keys)',
    scopes: [
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
    ],
    steps: [
      {
        title: 'Create a developer account',
        body: 'Go to developer.ebay.com and sign in (or register) with the same eBay account that owns the seller store you want to connect.',
      },
      {
        title: 'Create an application keyset',
        body: 'Open My Account > Application Keys (or My Keys). Create a keyset for Sandbox first, then Production when you are ready. You will receive App ID (Client ID), Cert ID (Client Secret), and Dev ID.',
      },
      {
        title: 'Note Client ID and Client Secret',
        body: 'Copy the App ID into CoMa as Client ID and the Cert ID as Client Secret. Keep Dev ID for the portal only; CoMa does not store it.',
      },
      {
        title: 'Generate a user refresh token',
        body: 'In the same keyset, open User Tokens (OAuth). Select the Sell scopes listed below, complete the consent flow for your seller account, and copy the long-lived refresh token. CoMa uses grant_type=refresh_token (no RuName callback in this release).',
      },
      {
        title: 'Paste into CoMa and test',
        body: 'Choose sandbox or production to match the keyset, paste Client ID, Client Secret, and Refresh token, save, then click Test connection. Env vars EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN override DB values if set.',
      },
    ],
  },
  shopify: {
    title: 'How to get your Shopify Admin API token',
    officialUrl: 'https://help.shopify.com/en/manual/apps/app-types/custom-apps',
    officialLabel: 'Shopify Help: custom apps',
    scopes: [
      'read_orders',
      'read_products',
      'write_products',
      'read_inventory',
      'write_inventory',
      'read_locations',
    ],
    steps: [
      {
        title: 'Open Develop apps in your store admin',
        body: 'In Shopify Admin go to Settings > Apps and sales channels > Develop apps. If prompted, allow custom app development for this store.',
      },
      {
        title: 'Create a custom app',
        body: 'Click Create an app, give it a clear name (for example CoMa Orders Hub), and create it. This is an admin-created custom app: no public App Store listing and no OAuth callback URL are required.',
      },
      {
        title: 'Configure Admin API scopes',
        body: 'Open Configure Admin API scopes and enable at least: read_orders, read_products, write_products (for variant price updates), read_inventory, write_inventory, and read_locations. Save.',
      },
      {
        title: 'Install the app and reveal the token',
        body: 'Click Install app, confirm. On the API credentials tab, reveal the Admin API access token once and copy it immediately (Shopify shows it only once). Also note your shop domain as your-store.myshopify.com (Settings > Domains, or the URL bar while logged into Admin).',
      },
      {
        title: 'Paste into CoMa and test',
        body: 'On the Shopify page enter the shop domain and the access token, save, then click Test connection. Env vars SHOPIFY_SHOP_DOMAIN / SHOPIFY_ACCESS_TOKEN override DB values if set. Optional: SHOPIFY_API_VERSION (default 2025-01).',
      },
    ],
  },
};
