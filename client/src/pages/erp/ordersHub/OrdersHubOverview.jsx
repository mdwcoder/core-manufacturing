import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Card from '../../../components/Card';
import { ErpShell, theme, BTN_PRIMARY, btnSecondary } from '../shared';

const cardGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 12,
  marginBottom: 14,
};

function formatSync(ts) {
  if (!ts) return '-';
  const n = Number(ts);
  if (!Number.isFinite(n)) return '-';
  return new Date(n).toLocaleString();
}

export function OrdersHubPage() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/erp/channels')
      .then(r => r.json())
      .then(d => {
        setChannels(d.channels || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const available = channels.filter(c => c.status === 'available');
  const planned = channels.filter(c => c.status === 'planned');

  if (loading) {
    return (
      <ErpShell title="Orders Hub" subtitle="Marketplace connections: orders in, inventory out.">
        <div style={{ color: theme.textDim }}>Loading...</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell
      title="Orders Hub"
      subtitle="Connect sales channels in one place. Import paid orders into ERP and push finished-goods price and quantity to existing listings."
      actions={(
        <button type="button" style={btnSecondary} onClick={load}>Refresh</button>
      )}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: theme.textFaint, textTransform: 'uppercase', marginBottom: 8 }}>
        Connected channels
      </div>
      <div style={cardGrid}>
        {available.map(ch => {
          const live = ch.live || {};
          return (
            <Card key={ch.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: theme.textStrong }}>{ch.label}</div>
                  <div style={{
                    fontSize: 12, fontWeight: 700, marginTop: 4,
                    color: live.configured ? theme.lime : theme.orange,
                  }}>
                    {live.configured ? 'Configured' : 'Not configured'}
                  </div>
                </div>
                <Link to={ch.path} style={{ textDecoration: 'none' }}>
                  <button type="button" style={BTN_PRIMARY}>Open</button>
                </Link>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: theme.textDim, display: 'grid', gap: 4 }}>
                <div>Pending lines: <span style={{ color: theme.violetSoft, fontWeight: 700 }}>{live.pending_count ?? 0}</span></div>
                <div>Active mappings: <span style={{ color: theme.teal, fontWeight: 700 }}>{live.listing_count ?? 0}</span></div>
                <div>Last order sync: {formatSync(live.last_orders_sync_at)}</div>
                {live.last_orders_error ? (
                  <div style={{ color: theme.orange }}>{live.last_orders_error}</div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      {planned.length > 0 ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.textFaint, textTransform: 'uppercase', margin: '18px 0 8px' }}>
            Coming soon
          </div>
          <div style={cardGrid}>
            {planned.map(ch => (
              <Card key={ch.id} style={{ opacity: 0.65 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: theme.textMuted }}>{ch.label}</div>
                <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 6 }}>
                  Planned connector. Not available yet.
                </div>
                <button type="button" style={{ ...btnSecondary, marginTop: 12, cursor: 'not-allowed' }} disabled>
                  Coming soon
                </button>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </ErpShell>
  );
}
