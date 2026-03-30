import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS = {
  PRINTING:   { bg: '#166534', text: '#4ade80', label: 'Printing' },
  IDLE:       { bg: '#1e3a5f', text: '#60a5fa', label: 'Idle' },
  FINISHED:   { bg: '#14532d', text: '#86efac', label: 'Finished' },
  PAUSED:     { bg: '#713f12', text: '#fcd34d', label: 'Paused' },
  ATTENTION:  { bg: '#78350f', text: '#fbbf24', label: 'Attention' },
  ERROR:      { bg: '#7f1d1d', text: '#f87171', label: 'Error' },
  OFFLINE:    { bg: '#1f2937', text: '#6b7280', label: 'Offline' },
  UNKNOWN:    { bg: '#1f2937', text: '#9ca3af', label: 'Unknown' },
};

function statusStyle(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.UNKNOWN;
}

function PrinterCard({ printer }) {
  const style = statusStyle(printer.status);
  return (
    <div style={{
      background: '#1e2433',
      border: `1px solid ${style.bg}`,
      borderRadius: 8,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {printer.name}
        </span>
        <span style={{
          background: style.bg,
          color: style.text,
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          {style.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{
          background: '#0f172a',
          borderRadius: 3,
          padding: '1px 6px',
          fontFamily: 'monospace',
          color: '#64748b',
        }}>{printer.model}</span>
        <span style={{ color: '#475569' }}>{printer.ip}</span>
        {printer.group_name && <span style={{ color: '#475569' }}>{printer.group_name}</span>}
      </div>
    </div>
  );
}

const MODEL_ORDER = ['mk4s', 'core1', 'core1l', 'xl'];

export default function Fleet() {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const fetchPrinters = useCallback(async () => {
    try {
      const res = await fetch('/api/printers');
      if (!res.ok) throw new Error('Failed to fetch printers');
      const data = await res.json();
      setPrinters(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrinters();
    const interval = setInterval(fetchPrinters, 15000);
    return () => clearInterval(interval);
  }, [fetchPrinters]);

  const counts = printers.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const filtered = printers.filter((p) => {
    if (filter !== 'ALL' && p.status !== filter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.ip.includes(search) && !(p.group_name || '').toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  // Group by model
  const grouped = MODEL_ORDER.reduce((acc, model) => {
    const group = filtered.filter((p) => p.model === model);
    if (group.length > 0) acc[model] = group;
    return acc;
  }, {});
  const otherModels = filtered.filter((p) => !MODEL_ORDER.includes(p.model));
  if (otherModels.length > 0) grouped['other'] = otherModels;

  const MODEL_LABELS = { mk4s: 'MK4S', core1: 'Core One', core1l: 'Core 1L', xl: 'XL', other: 'Other' };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Fleet</h1>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { key: 'ALL',      label: `All (${printers.length})`,                color: '#64748b' },
          { key: 'PRINTING', label: `Printing (${counts.PRINTING || 0})`,       color: '#4ade80' },
          { key: 'IDLE',     label: `Idle (${counts.IDLE || 0})`,               color: '#60a5fa' },
          { key: 'ERROR',    label: `Error (${counts.ERROR || 0})`,             color: '#f87171' },
          { key: 'ATTENTION',label: `Attention (${counts.ATTENTION || 0})`,     color: '#fbbf24' },
          { key: 'OFFLINE',  label: `Offline (${counts.OFFLINE || 0})`,         color: '#6b7280' },
        ].map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              background: filter === key ? '#1e40af' : '#1e2433',
              color: filter === key ? '#fff' : color,
              border: `1px solid ${filter === key ? '#3b82f6' : '#2d3748'}`,
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: filter === key ? 700 : 400,
            }}
          >
            {label}
          </button>
        ))}
        <input
          type="text"
          placeholder="Search name / IP / group…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: '#1e2433',
            border: '1px solid #2d3748',
            borderRadius: 20,
            padding: '4px 14px',
            color: '#e2e8f0',
            fontSize: 13,
            outline: 'none',
            flex: '1 1 180px',
            maxWidth: 280,
          }}
        />
      </div>

      {loading && <p style={{ color: '#64748b' }}>Loading printers…</p>}
      {error && <p style={{ color: '#f87171' }}>Error: {error}</p>}
      {!loading && printers.length === 0 && (
        <p style={{ color: '#64748b' }}>
          No printers registered. Import a CSV on the Settings page.
        </p>
      )}

      {Object.entries(grouped).map(([model, group]) => (
        <div key={model} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            {MODEL_LABELS[model] || model} <span style={{ fontWeight: 400, color: '#475569' }}>({group.length})</span>
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}>
            {group.map((printer) => (
              <PrinterCard key={printer.id} printer={printer} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
