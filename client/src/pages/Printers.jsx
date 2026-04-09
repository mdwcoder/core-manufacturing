import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const STATUS_COLORS = {
  IDLE:     { bg: '#1e3a5f', text: '#93c5fd' },
  PRINTING: { bg: '#14532d', text: '#86efac' },
  FINISHED: { bg: '#14532d', text: '#86efac' },
  PAUSED:   { bg: '#78350f', text: '#fcd34d' },
  ERROR:    { bg: '#7f1d1d', text: '#fca5a5' },
  OFFLINE:  { bg: '#1e2433', text: '#475569' },
  UNKNOWN:  { bg: '#1e2433', text: '#475569' },
};

function statusBadge(status) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.UNKNOWN;
  return (
    <span style={{
      background: c.bg, color: c.text,
      borderRadius: 4, padding: '1px 8px',
      fontSize: 11, fontWeight: 700,
      letterSpacing: '0.03em',
    }}>
      {status}
    </span>
  );
}

export default function Printers() {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch('/api/printers').then(r => r.json()),
      fetch('/api/printers/decommissioned').then(r => r.json()),
    ]).then(([active, decommissioned]) => {
      setPrinters([...active, ...decommissioned]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = printers.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.model || '').toLowerCase().includes(q) ||
      (p.group_name || '').toLowerCase().includes(q) ||
      (p.ip || '').includes(q)
    );
  });

  // Sort: active first, then decommissioned; alpha within each group
  const sorted = [...filtered].sort((a, b) => {
    if (a.is_active !== b.is_active) return b.is_active - a.is_active;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Printers</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>
        All printers — active and decommissioned. Click any row to view history and add notes.
      </p>

      <input
        type="text"
        placeholder="Search by name, model, group, or IP…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', maxWidth: 380, marginBottom: 16,
          background: '#1e2433', border: '1px solid #2d3748',
          borderRadius: 6, color: '#e2e8f0', fontSize: 13,
          padding: '7px 12px', outline: 'none', boxSizing: 'border-box',
        }}
      />

      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      {!loading && sorted.length === 0 && (
        <p style={{ color: '#475569', fontSize: 14 }}>No printers found.</p>
      )}

      {!loading && sorted.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
            padding: '6px 14px',
            fontSize: 11, fontWeight: 700, color: '#475569',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            <span>Name</span>
            <span>Model</span>
            <span>Group</span>
            <span>IP</span>
            <span>Status</span>
          </div>

          {sorted.map(printer => (
            <div
              key={printer.id}
              onClick={() => navigate(`/printers/${printer.id}`)}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                alignItems: 'center',
                background: '#131720',
                border: '1px solid #1e2433',
                borderRadius: 7,
                padding: '10px 14px',
                cursor: 'pointer',
                opacity: printer.is_active ? 1 : 0.55,
                transition: 'border-color 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#1e2433'}
            >
              <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>
                {printer.name}
                {!printer.is_active && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#475569', fontWeight: 400 }}>
                    decommissioned
                  </span>
                )}
              </span>
              <span style={{
                fontFamily: 'monospace', fontSize: 12, color: '#64748b',
                background: '#0f172a', borderRadius: 3, padding: '1px 6px',
                display: 'inline-block',
              }}>
                {printer.model || '—'}
              </span>
              <span style={{ fontSize: 13, color: '#64748b' }}>{printer.group_name || '—'}</span>
              <span style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace' }}>{printer.ip}</span>
              <span>{printer.is_active ? statusBadge(printer.status) : (
                <span style={{ fontSize: 11, color: '#475569' }}>offline</span>
              )}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
