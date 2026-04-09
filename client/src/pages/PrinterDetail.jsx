import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

function formatTimestamp(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const EVENT_META = {
  decommission: { label: 'Decommissioned', bg: '#7f1d1d', color: '#fca5a5' },
  recommission:  { label: 'Recommissioned', bg: '#14532d', color: '#86efac' },
  job_finished:  { label: 'Job Finished',   bg: '#1e3a5f', color: '#93c5fd' },
  job_failed:    { label: 'Job Failed',      bg: '#78350f', color: '#fcd34d' },
  note:          { label: 'Note',            bg: '#1e2433', color: '#94a3b8' },
};

function EventBadge({ type }) {
  const m = EVENT_META[type] || { label: type, bg: '#1e2433', color: '#64748b' };
  return (
    <span style={{
      background: m.bg, color: m.color,
      borderRadius: 4, padding: '2px 9px',
      fontSize: 11, fontWeight: 700,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {m.label}
    </span>
  );
}

const STATUS_COLORS = {
  IDLE:     { bg: '#1e3a5f', text: '#93c5fd' },
  PRINTING: { bg: '#14532d', text: '#86efac' },
  FINISHED: { bg: '#14532d', text: '#86efac' },
  PAUSED:   { bg: '#78350f', text: '#fcd34d' },
  ERROR:    { bg: '#7f1d1d', text: '#fca5a5' },
  OFFLINE:  { bg: '#1e2433', text: '#475569' },
  UNKNOWN:  { bg: '#1e2433', text: '#475569' },
};

export default function PrinterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [printer, setPrinter] = useState(null);
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);

  const fetchData = useCallback(async () => {
    // Try active printers first, then decommissioned
    const [printerRes, eventsRes] = await Promise.all([
      fetch(`/api/printers/${id}`),
      fetch(`/api/printers/${id}/events`),
    ]);
    if (printerRes.ok) setPrinter(await printerRes.json());
    if (eventsRes.ok) setEvents(await eventsRes.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function submitNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    await fetch(`/api/printers/${id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note.trim() }),
    });
    setNote('');
    setSaving(false);
    fetchData();
  }

  if (loading) return <p style={{ color: '#64748b' }}>Loading…</p>;
  if (!printer) return <p style={{ color: '#fca5a5' }}>Printer not found.</p>;

  const sc = STATUS_COLORS[printer.status] || STATUS_COLORS.UNKNOWN;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Back link */}
      <button
        onClick={() => navigate('/printers')}
        style={{
          background: 'none', border: 'none', color: '#3b82f6',
          fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 18,
        }}
      >
        ← All Printers
      </button>

      {/* Printer header card */}
      <div style={{
        background: '#131720', border: '1px solid #1e2433',
        borderRadius: 8, padding: '16px 20px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0' }}>{printer.name}</span>
          {printer.is_active ? (
            <span style={{
              background: sc.bg, color: sc.text,
              borderRadius: 4, padding: '2px 9px', fontSize: 12, fontWeight: 700,
            }}>
              {printer.status}
            </span>
          ) : (
            <span style={{
              background: '#1e2433', color: '#ef4444',
              borderRadius: 4, padding: '2px 9px', fontSize: 12, fontWeight: 700,
            }}>
              DECOMMISSIONED
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: '#64748b' }}>
          <span>Model: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{printer.model}</span></span>
          <span>IP: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{printer.ip}</span></span>
          {printer.group_name && (
            <span>Group: <span style={{ color: '#94a3b8' }}>{printer.group_name}</span></span>
          )}
          {printer.type && printer.type !== 'prusa' && (
            <span>Connector: <span style={{ color: '#94a3b8' }}>{printer.type}</span></span>
          )}
        </div>

        {printer.decommissioned_at && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>
            Decommissioned: {formatTimestamp(printer.decommissioned_at)}
          </div>
        )}
      </div>

      {/* Add note form */}
      <div style={{
        background: '#131720', border: '1px solid #1e2433',
        borderRadius: 8, padding: '14px 18px', marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>Add operator note</div>
        <form onSubmit={submitNote} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Describe an observation, inspection result, or any relevant note…"
            rows={2}
            style={{
              flex: 1,
              background: '#1e2433', border: '1px solid #2d3748',
              borderRadius: 5, color: '#e2e8f0', fontSize: 13,
              padding: '7px 10px', resize: 'vertical', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={saving || !note.trim()}
            style={{
              background: saving || !note.trim() ? '#1e2433' : '#1e40af',
              color: saving || !note.trim() ? '#475569' : '#fff',
              border: 'none', borderRadius: 5,
              padding: '7px 16px', fontSize: 13, fontWeight: 600,
              cursor: saving || !note.trim() ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </form>
      </div>

      {/* Event timeline */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Event History ({events.length})
      </div>

      {events.length === 0 && (
        <p style={{ color: '#475569', fontSize: 14 }}>No events recorded yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map(ev => (
          <div key={ev.id} style={{
            background: '#131720', border: '1px solid #1e2433',
            borderRadius: 7, padding: '10px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <div style={{ paddingTop: 1 }}>
              <EventBadge type={ev.event_type} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {ev.note && (
                <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 4, wordBreak: 'break-word' }}>
                  {ev.note}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#475569' }}>{formatTimestamp(ev.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
