import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS = {
  PRINTING:   { bg: '#166534', text: '#4ade80', label: 'Printing' },
  IDLE:       { bg: '#1e3a5f', text: '#60a5fa', label: 'Idle' },
  READY:      { bg: '#1a2e44', text: '#38bdf8', label: 'Prepared' },
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

async function inspectPrinter(printer) {
  console.group(`[inspect] ${printer.name} (${printer.ip})`);
  try {
    const res  = await fetch(`/api/printers/${printer.id}/raw-status`);
    const data = await res.json();
    if (data.error) {
      console.warn('PrusaLink error:', data.error);
    } else {
      console.log('Full raw response:', data.raw);
      console.log('printer.state:', data.raw?.printer?.state);
      console.log('printer.flags:', data.raw?.printer?.flags);
      console.log('job:', data.raw?.job);
    }
  } catch (err) {
    console.error('Fetch failed:', err);
  }
  console.groupEnd();
}

function PrinterCard({ printer, selected, onToggleSelect, onSetReady, onBadPrint, onDecommission, onRecommission }) {
  const style = statusStyle(printer.status);
  const needsConfirmation = printer.is_held === 1 && printer.is_active === 1;
  const decommissioned = printer.is_active === 0;

  return (
    <div
      onClick={() => inspectPrinter(printer)}
      title="Click to inspect raw PrusaLink status in console"
      style={{
        background: decommissioned ? '#111827' : needsConfirmation ? '#1c2a1c' : '#1e2433',
        border: `1px solid ${decommissioned ? '#1f2937' : needsConfirmation ? '#15803d' : style.bg}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        cursor: 'pointer',
        opacity: decommissioned ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {printer.name}
        </span>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          {decommissioned && (
            <span style={{ background: '#1f2937', color: '#6b7280', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
              Decommissioned
            </span>
          )}
          {!decommissioned && (
            <span style={{ background: style.bg, color: style.text, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
              {style.label}
            </span>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ background: '#0f172a', borderRadius: 3, padding: '1px 6px', fontFamily: 'monospace', color: '#64748b' }}>
          {printer.model}
        </span>
        <span style={{ color: '#475569' }}>{printer.ip}</span>
        {printer.group_name && <span style={{ color: '#475569' }}>{printer.group_name}</span>}
      </div>

      {needsConfirmation && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>
            <input type="checkbox" checked={selected} onChange={() => onToggleSelect(printer.id)} style={{ cursor: 'pointer', accentColor: '#22c55e' }} />
            Include
          </label>
          <button onClick={() => onSetReady(printer.id)} style={{ background: '#166534', color: '#4ade80', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ✓ Set Ready
          </button>
          <button onClick={() => onBadPrint(printer.id)} style={{ background: '#7f1d1d', color: '#f87171', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ✗ Bad Print
          </button>
        </div>
      )}

      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 2 }}>
        {decommissioned ? (
          <button onClick={() => onRecommission(printer.id)} style={{ background: '#1e3a5f', color: '#60a5fa', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ↩ Recommission
          </button>
        ) : (
          <button onClick={() => onDecommission(printer.id)} style={{ background: 'none', color: '#475569', border: '1px solid #2d3748', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>
            Decommission
          </button>
        )}
      </div>
    </div>
  );
}

const MODEL_ORDER = ['mk4', 'mk4s', 'c1', 'c1l', 'xl'];

export default function Fleet() {
  const [printers, setPrinters]               = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);
  const [filter, setFilter]                   = useState('ALL');
  const [search, setSearch]                   = useState('');
  const [selectedForReady, setSelectedForReady] = useState(new Set());

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

  // Printers awaiting operator confirmation
  const awaitingConfirmation = printers.filter(p => p.is_held === 1);

  function toggleSelect(printerId) {
    setSelectedForReady(prev => {
      const next = new Set(prev);
      next.has(printerId) ? next.delete(printerId) : next.add(printerId);
      return next;
    });
  }

  function selectAll() {
    setSelectedForReady(new Set(awaitingConfirmation.map(p => p.id)));
  }

  function deselectAll() {
    setSelectedForReady(new Set());
  }

  async function setReady(printerId) {
    await fetch(`/api/printers/${printerId}/set-ready`, { method: 'POST' });
    setSelectedForReady(prev => { const next = new Set(prev); next.delete(printerId); return next; });
    fetchPrinters();
  }

  async function setReadyForSelected() {
    await Promise.all([...selectedForReady].map(id =>
      fetch(`/api/printers/${id}/set-ready`, { method: 'POST' })
    ));
    setSelectedForReady(new Set());
    fetchPrinters();
  }

  async function decommission(printerId) {
    const printer = printers.find(p => p.id === printerId);
    if (!window.confirm(`Remove ${printer?.name} from active duty?\n\nIt will no longer receive jobs or be polled until recommissioned.`)) return;
    await fetch(`/api/printers/${printerId}/decommission`, { method: 'POST' });
    fetchPrinters();
  }

  async function recommission(printerId) {
    await fetch(`/api/printers/${printerId}/recommission`, { method: 'POST' });
    fetchPrinters();
  }

  async function badPrint(printerId) {
    const printer = printers.find(p => p.id === printerId);
    if (!window.confirm(`Mark the last finished job on ${printer?.name} as a failure?\n\nThis will undo the completed quantity and reopen the part if it was closed.`)) return;
    await fetch(`/api/printers/${printerId}/mark-job-failure`, { method: 'POST' });
    setSelectedForReady(prev => { const next = new Set(prev); next.delete(printerId); return next; });
    fetchPrinters();
  }

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

  const MODEL_LABELS = { mk4: 'MK4', mk4s: 'MK4S', c1: 'Core One', c1l: 'Core 1L', xl: 'XL', other: 'Other' };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Fleet</h1>

      {/* Confirmation banner */}
      {awaitingConfirmation.length > 0 && (
        <div style={{
          background: '#14532d',
          border: '1px solid #15803d',
          borderRadius: 8,
          padding: '10px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <span style={{ color: '#86efac', fontWeight: 600, fontSize: 14 }}>
            {awaitingConfirmation.length} printer{awaitingConfirmation.length !== 1 ? 's' : ''} awaiting confirmation
          </span>
          <button
            onClick={selectAll}
            style={{ background: '#166534', color: '#4ade80', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Select All
          </button>
          {selectedForReady.size > 0 && (
            <>
              <button
                onClick={deselectAll}
                style={{ background: '#1f2937', color: '#9ca3af', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
              >
                Deselect All
              </button>
              <button
                onClick={setReadyForSelected}
                style={{ background: '#15803d', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                ✓ Set Ready ({selectedForReady.size})
              </button>
            </>
          )}
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { key: 'ALL',      label: `All (${printers.length})`,                          color: '#64748b' },
          { key: 'PRINTING', label: `Printing (${counts.PRINTING || 0})`,                color: '#4ade80' },
          { key: 'IDLE',     label: `Idle (${counts.IDLE || 0})`,                        color: '#60a5fa' },
          { key: 'FINISHED', label: `Finished (${counts.FINISHED || 0})`,                color: '#86efac' },
          { key: 'ERROR',    label: `Error (${counts.ERROR || 0})`,                      color: '#f87171' },
          { key: 'ATTENTION',label: `Attention (${counts.ATTENTION || 0})`,              color: '#fbbf24' },
          { key: 'OFFLINE',  label: `Offline (${counts.OFFLINE || 0})`,                  color: '#6b7280' },
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
              <PrinterCard
                key={printer.id}
                printer={printer}
                selected={selectedForReady.has(printer.id)}
                onToggleSelect={toggleSelect}
                onSetReady={setReady}
                onBadPrint={badPrint}
                onDecommission={decommission}
                onRecommission={recommission}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
