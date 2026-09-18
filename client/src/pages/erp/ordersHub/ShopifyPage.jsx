import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Card from '../../../components/Card';
import {
  ErpShell, Table, theme, INPUT_STYLE, BTN_PRIMARY, labelStyle, formRow, btnSecondary, apiJson,
  useErpFeedback,
} from '../shared';
import { ChannelGuide } from './ChannelGuide';

const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 };
const sectionGap = { marginBottom: 14 };

export function ShopifyPage() {
  const { showToast, confirm, feedbackEl } = useErpFeedback();
  const [status, setStatus] = useState(null);
  const [creds, setCreds] = useState(null);
  const [draft, setDraft] = useState({});
  const [listings, setListings] = useState([]);
  const [pending, setPending] = useState([]);
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [newListing, setNewListing] = useState({
    item_id: '', shopify_sku: '', variant_id: '', inventory_item_id: '', location_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadCore = useCallback(() => {
    Promise.all([
      fetch('/api/erp/shopify/status').then(r => r.json()),
      fetch('/api/erp/shopify/credentials').then(r => r.json()),
      fetch('/api/erp/shopify/listings').then(r => r.json()),
      fetch('/api/erp/shopify/pending').then(r => r.json()),
      fetch('/api/erp/shopify/orders?limit=25').then(r => r.json()),
      fetch('/api/erp/items?limit=200').then(r => r.json()).catch(() => ({ items: [] })),
    ]).then(([st, cr, li, pe, or, it]) => {
      setStatus(st);
      setCreds(cr);
      setDraft({
        shop_domain: cr.shop_domain || '',
        api_version: cr.api_version || '2025-01',
        auto_post: cr.auto_post !== 0,
        access_token: '',
      });
      setListings(li.listings || []);
      setPending(pe.lines || []);
      setOrders(or.orders || []);
      setItems(it.items || it || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadCore(); }, [loadCore]);

  async function saveCredentials() {
    setBusy(true);
    try {
      const body = {
        shop_domain: draft.shop_domain,
        api_version: draft.api_version,
        auto_post: draft.auto_post ? 1 : 0,
      };
      if (draft.access_token) body.access_token = draft.access_token;
      const updated = await apiJson('/api/erp/shopify/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setCreds(updated);
      showToast('Shopify credentials saved');
      loadCore();
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    try {
      const result = await apiJson('/api/erp/shopify/test-connection', { method: 'POST' });
      showToast(`Connected (${result.shop_name || result.shop_domain})`);
      loadCore();
    } catch (err) {
      showToast('Connection failed: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function syncOrders() {
    setBusy(true);
    try {
      const result = await apiJson('/api/erp/shopify/orders/sync', { method: 'POST' });
      showToast(`Synced ${result.fetched} order(s), auto ${result.auto_posted}, queued ${result.queued}`);
      loadCore();
    } catch (err) {
      showToast('Order sync failed: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pushInventory() {
    setBusy(true);
    try {
      const result = await apiJson('/api/erp/shopify/inventory/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      showToast(`Push ok ${result.ok_count}, fail ${result.fail_count}`);
      loadCore();
    } catch (err) {
      showToast('Inventory push failed: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addListing() {
    setBusy(true);
    try {
      await apiJson('/api/erp/shopify/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: Number(newListing.item_id),
          shopify_sku: newListing.shopify_sku.trim(),
          variant_id: newListing.variant_id.trim() || null,
          inventory_item_id: newListing.inventory_item_id.trim() || null,
          location_id: newListing.location_id.trim() || null,
        }),
      });
      showToast('Listing mapped');
      setNewListing({
        item_id: '', shopify_sku: '', variant_id: '', inventory_item_id: '', location_id: '',
      });
      loadCore();
    } catch (err) {
      showToast('Map failed: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeListing(id) {
    const ok = await confirm({
      title: 'Remove mapping',
      message: 'Remove this Shopify SKU mapping? Products on Shopify are not deleted.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiJson(`/api/erp/shopify/listings/${id}`, { method: 'DELETE' });
      showToast('Mapping removed');
      loadCore();
    } catch (err) {
      showToast('Remove failed: ' + err.message, 'error');
    }
  }

  async function confirmPending(line, acknowledgeShortage) {
    if (acknowledgeShortage) {
      const ok = await confirm({
        title: 'Confirm with shortage',
        message: 'Stock is short. Confirm anyway? qty_on_hand may go negative.',
        confirmLabel: 'Confirm shortage',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await apiJson(`/api/erp/shopify/pending/${line.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledge_shortage: !!acknowledgeShortage }),
      });
      showToast('Line posted to ERP');
      loadCore();
    } catch (err) {
      if (err.status === 409 && err.body?.acknowledge_required) {
        showToast('Shortage: confirm again with acknowledge', 'warning');
        loadCore();
      } else {
        showToast('Confirm failed: ' + err.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function dismissPending(line) {
    const ok = await confirm({
      title: 'Dismiss line',
      message: 'Dismiss this Shopify order line without creating a sales order?',
      confirmLabel: 'Dismiss',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiJson(`/api/erp/shopify/pending/${line.id}/dismiss`, { method: 'POST' });
      showToast('Line dismissed');
      loadCore();
    } catch (err) {
      showToast('Dismiss failed: ' + err.message, 'error');
    }
  }

  if (loading) {
    return (
      <ErpShell title="Shopify" subtitle="Admin API: orders, inventory push.">
        <div style={{ color: theme.textDim }}>Loading...</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell
      title="Shopify"
      subtitle="Import paid orders, push price/qty to existing variants. Custom-app token (not yet validated on a live store)."
      actions={(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/erp/orders-hub" style={{ textDecoration: 'none' }}>
            <button type="button" style={btnSecondary}>Orders Hub</button>
          </Link>
          <button type="button" style={btnSecondary} disabled={busy} onClick={testConnection}>Test connection</button>
          <button type="button" style={btnSecondary} disabled={busy} onClick={syncOrders}>Sync orders</button>
          <button type="button" style={BTN_PRIMARY} disabled={busy} onClick={pushInventory}>Push inventory</button>
        </div>
      )}
    >
      <style>{`
        @media (max-width: 600px) {
          .shopify-form-row { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={cardGrid}>
        <Card>
          <div style={{ fontSize: 11, color: theme.textFaint, textTransform: 'uppercase', fontWeight: 700 }}>Status</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: status?.configured ? theme.lime : theme.orange, marginTop: 6 }}>
            {status?.configured ? 'Configured' : 'Not configured'}
          </div>
          <div style={{ fontSize: 12, color: theme.textDim }}>{status?.shop_domain || '-'} / {status?.api_version || '-'}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: theme.textFaint, textTransform: 'uppercase', fontWeight: 700 }}>Pending lines</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: theme.violetSoft, marginTop: 6 }}>{status?.pending_count ?? 0}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: theme.textFaint, textTransform: 'uppercase', fontWeight: 700 }}>Active listings</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: theme.teal, marginTop: 6 }}>{status?.listing_count ?? 0}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: theme.textFaint, textTransform: 'uppercase', fontWeight: 700 }}>Last order sync</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginTop: 8 }}>
            {status?.last_orders_sync_at ? new Date(Number(status.last_orders_sync_at)).toLocaleString() : '-'}
          </div>
          {status?.last_orders_error ? (
            <div style={{ fontSize: 12, color: theme.orange, marginTop: 4 }}>{status.last_orders_error}</div>
          ) : null}
        </Card>
      </div>

      <ChannelGuide channelId="shopify" />

      <Card title="Credentials" style={sectionGap}>
        <p style={{ fontSize: 12, color: theme.textDim, marginTop: 0 }}>
          Paste shop domain (your-store.myshopify.com) and Admin API access token from a custom app.
          Env vars SHOPIFY_SHOP_DOMAIN / SHOPIFY_ACCESS_TOKEN override DB. Leave the token blank to keep the stored value.
          Credentials are not included in Settings backup export.
        </p>
        <div className="shopify-form-row" style={formRow}>
          <div>
            <label style={labelStyle}>Shop domain</label>
            <input
              style={INPUT_STYLE}
              placeholder="your-store.myshopify.com"
              value={draft.shop_domain || ''}
              onChange={e => setDraft(d => ({ ...d, shop_domain: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>API version</label>
            <input
              style={INPUT_STYLE}
              value={draft.api_version || ''}
              onChange={e => setDraft(d => ({ ...d, api_version: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Auto-post when stock OK</label>
            <select
              style={INPUT_STYLE}
              value={draft.auto_post ? '1' : '0'}
              onChange={e => setDraft(d => ({ ...d, auto_post: e.target.value === '1' }))}
            >
              <option value="1">Enabled</option>
              <option value="0">Disabled (queue all)</option>
            </select>
          </div>
        </div>
        <div className="shopify-form-row" style={{ ...formRow, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>Access token {creds?.access_token ? `(${creds.access_token})` : ''}</label>
            <input
              style={INPUT_STYLE}
              type="password"
              placeholder="paste new value to replace"
              value={draft.access_token || ''}
              onChange={e => setDraft(d => ({ ...d, access_token: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" style={BTN_PRIMARY} disabled={busy} onClick={saveCredentials}>Save credentials</button>
        </div>
      </Card>

      <Card title="SKU mappings" style={sectionGap}>
        <div className="shopify-form-row" style={{ ...formRow, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>ERP item</label>
            <select
              style={INPUT_STYLE}
              value={newListing.item_id}
              onChange={e => setNewListing(n => ({ ...n, item_id: e.target.value }))}
            >
              <option value="">Select item</option>
              {(Array.isArray(items) ? items : []).map(it => (
                <option key={it.id} value={it.id}>{it.sku} - {it.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Shopify SKU</label>
            <input
              style={INPUT_STYLE}
              value={newListing.shopify_sku}
              onChange={e => setNewListing(n => ({ ...n, shopify_sku: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Variant ID (required for push)</label>
            <input
              style={INPUT_STYLE}
              value={newListing.variant_id}
              onChange={e => setNewListing(n => ({ ...n, variant_id: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Inventory item ID</label>
            <input
              style={INPUT_STYLE}
              value={newListing.inventory_item_id}
              onChange={e => setNewListing(n => ({ ...n, inventory_item_id: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Location ID (optional)</label>
            <input
              style={INPUT_STYLE}
              value={newListing.location_id}
              onChange={e => setNewListing(n => ({ ...n, location_id: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>&nbsp;</label>
            <button type="button" style={BTN_PRIMARY} disabled={busy} onClick={addListing}>Add mapping</button>
          </div>
        </div>
        <Table
          columns={[
            { key: 'shopify_sku', label: 'Shopify SKU' },
            { key: 'item_sku', label: 'ERP SKU' },
            { key: 'item_name', label: 'Name' },
            { key: 'variant_id', label: 'Variant ID' },
            { key: 'last_pushed_qty', label: 'Pushed qty' },
            { key: 'last_pushed_price', label: 'Pushed price' },
            { key: 'last_error', label: 'Error', render: r => (
              <span style={{ color: r.last_error ? theme.orange : theme.textDim }}>{r.last_error || '-'}</span>
            ) },
            { key: 'actions', label: '', render: r => (
              <button type="button" style={btnSecondary} onClick={() => removeListing(r.id)}>Remove</button>
            ) },
          ]}
          rows={listings}
          rowKey={r => r.id}
        />
      </Card>

      <Card title="Pending order lines" style={sectionGap}>
        <Table
          columns={[
            { key: 'shopify_order_id', label: 'Order' },
            { key: 'order_name', label: 'Name' },
            { key: 'shopify_sku', label: 'SKU' },
            { key: 'title', label: 'Title' },
            { key: 'qty', label: 'Qty' },
            { key: 'unit_price', label: 'Unit $' },
            { key: 'buyer_email', label: 'Buyer' },
            { key: 'item_id', label: 'Mapped', render: r => (r.item_id ? 'yes' : 'no') },
            { key: 'actions', label: '', render: r => (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={BTN_PRIMARY} disabled={busy} onClick={() => confirmPending(r, false)}>Confirm</button>
                {r.shortage ? (
                  <button type="button" style={btnSecondary} disabled={busy} onClick={() => confirmPending(r, true)}>Ack shortage</button>
                ) : null}
                <button type="button" style={btnSecondary} onClick={() => dismissPending(r)}>Dismiss</button>
              </div>
            ) },
          ]}
          rows={pending}
          rowKey={r => r.id}
        />
      </Card>

      <Card title="Recent orders" style={sectionGap}>
        <Table
          columns={[
            { key: 'order_id', label: 'Order ID' },
            { key: 'name', label: 'Name' },
            { key: 'created_at', label: 'Created' },
            { key: 'buyer_email', label: 'Buyer' },
            { key: 'total_amount', label: 'Total' },
            { key: 'financial_status', label: 'Payment' },
            { key: 'fulfillment_status', label: 'Fulfillment' },
          ]}
          rows={orders}
          rowKey={r => r.order_id}
        />
      </Card>

      {feedbackEl}
    </ErpShell>
  );
}
