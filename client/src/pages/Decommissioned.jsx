import { useState, useEffect, useCallback } from 'react';

function formatTimestamp(ms) {
  if (!ms) return 'Unknown';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function Decommissioned() {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [notes, setNotes]       = useState({});   // { [id]: string }
  const [dirty, setDirty]       = useState(new Set());
  const [saving, setSaving]     = useState(new Set());

  const fetchPrinters = useCallback(async () => {
    const res  = await fetch('/api/printers/decommissioned');
    const data = await res.json();
    setPrinters(data);
    // Seed note state for any printer not already being edited
    setNotes(prev => {
      const next = { ...prev };
      data.forEach(p => {
        if (!(p.id in next)) next[p.id] = p.decommission_note || '';
      });
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchPrinters(); }, [fetchPrinters]);

  function handleNoteChange(id, value) {
    setNotes(prev => ({ ...prev, [id]: value }));
    setDirty(prev => new Set(prev).add(id));
  }

  async function saveNote(id) {
    setSaving(prev => new Set(prev).add(id));
    await fetch(`/api/printers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decommission_note: notes[id] }),
    });
    setSaving(prev => { const next = new Set(prev); next.delete(id); return next; });
    setDirty(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function recommission(printer) {
    if (!window.confirm(
      `Recommission ${printer.name}?\n\nOnly proceed if the machine has been fully inspected and confirmed safe to run. It will return to the active fleet and be eligible to receive jobs immediately.`
    )) return;
    await fetch(`/api/printers/${printer.id}/recommission`, { method: 'POST' });
    fetchPrinters();
  }

  if (loading) return <p style={{ color: '#64748b' }}>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Decommissioned</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>
        Printers removed from the active fleet. Each requires inspection and manual recommission before receiving jobs.
      </p>

      {printers.length === 0 && (
        <p style={{ color: '#475569', fontSize: 14 }}>No decommissioned printers.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {printers.map(printer => (
          <div key={printer.id} style={{
            background: '#131720',
            border: '1px solid #1e2433',
            borderRadius: 8,
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{printer.name}</span>
              <span style={{ background: '#0f172a', borderRadius: 3, padding: '1px 7px', fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>
                {printer.model}
              </span>
              <span style={{ fontSize: 12, color: '#475569' }}>{printer.ip}</span>
              {printer.group_name && (
                <span style={{ fontSize: 12, color: '#475569' }}>{printer.group_name}</span>
              )}
            </div>

            {/* Decommission timestamp */}
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Decommissioned: <span style={{ color: '#94a3b8' }}>{formatTimestamp(printer.decommissioned_at)}</span>
            </div>

            {/* Note field */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Investigation note</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <textarea
                  value={notes[printer.id] ?? ''}
                  onChange={e => handleNoteChange(printer.id, e.target.value)}
                  placeholder="Describe the issue, what was inspected, and any findings…"
                  rows={2}
                  style={{
                    flex: 1,
                    background: '#1e2433',
                    border: `1px solid ${dirty.has(printer.id) ? '#3b82f6' : '#2d3748'}`,
                    borderRadius: 5,
                    color: '#e2e8f0',
                    fontSize: 13,
                    padding: '6px 10px',
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                {dirty.has(printer.id) && (
                  <button
                    onClick={() => saveNote(printer.id)}
                    disabled={saving.has(printer.id)}
                    style={{
                      background: '#1e40af',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 5,
                      padding: '6px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: saving.has(printer.id) ? 'not-allowed' : 'pointer',
                      opacity: saving.has(printer.id) ? 0.6 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {saving.has(printer.id) ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {/* Recommission */}
            <div>
              <button
                onClick={() => recommission(printer)}
                style={{
                  background: 'none',
                  color: '#60a5fa',
                  border: '1px solid #1e3a5f',
                  borderRadius: 5,
                  padding: '4px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ↩ Recommission
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
