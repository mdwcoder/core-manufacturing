import { useState, useEffect, useCallback, useRef } from 'react';
import PollTimer from '../components/PollTimer';

const POLL_INTERVAL_MS = 15000;

// ── Constants ────────────────────────────────────────────────────────────────

const CELL_COLORS = {
  PRINTING:  { bg: '#1e3a5f', text: '#60a5fa', border: '#1e40af' },
  IDLE:      { bg: '#1a2030', text: '#374151', border: '#232b3a' },
  FINISHED:  { bg: '#14532d', text: '#22c55e', border: '#15803d' },
  STOPPED:   { bg: '#431407', text: '#fb923c', border: '#7c2d12' },
  PAUSED:    { bg: '#451a03', text: '#f59e0b', border: '#78350f' },
  ATTENTION: { bg: '#451a03', text: '#f59e0b', border: '#78350f' },
  ERROR:     { bg: '#450a0a', text: '#ef4444', border: '#7f1d1d' },
  OFFLINE:   { bg: '#0d1117', text: '#1f2937', border: '#161b22' },
};

const STAT_CARDS = [
  { key: 'printing',    label: 'Printing',    color: '#3b82f6', accent: '#1e40af' },
  { key: 'idle',        label: 'Idle',        color: '#6b7280', accent: '#374151' },
  { key: 'awaiting',    label: 'Awaiting',    color: '#22c55e', accent: '#15803d' },
  { key: 'parts_today', label: 'Parts Today', color: '#a78bfa', accent: '#7c3aed' },
];

const LEGEND_ITEMS = [
  { label: 'Printing', color: '#3b82f6' },
  { label: 'Awaiting', color: '#22c55e' },
  { label: 'Idle',     color: '#4b5563' },
  { label: 'Stopped',  color: '#fb923c' },
  { label: 'Error',    color: '#ef4444' },
  { label: 'Offline',  color: '#374151' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function cellColors(printer) {
  // Held printer (awaiting operator sign-off) renders as green regardless of status
  if (printer.is_held === 1 && (printer.status === 'FINISHED' || printer.status === 'IDLE')) {
    return CELL_COLORS.FINISHED;
  }
  return CELL_COLORS[printer.status] || CELL_COLORS.IDLE;
}

function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(ts) {
  if (!ts) return '—';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function formatRemaining(seconds) {
  if (seconds == null || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 1)  return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatWait(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Row-level status summary badges for the fleet grid ───────────────────────

const ROW_STATUSES = ['PRINTING', 'FINISHED', 'IDLE', 'ERROR', 'STOPPED', 'OFFLINE'];

function RowSummary({ group }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
      {ROW_STATUSES.map(s => {
        const count = group.filter(p => {
          const isAwaiting = p.is_held === 1 && (p.status === 'FINISHED' || p.status === 'IDLE');
          if (s === 'FINISHED') return isAwaiting;
          return p.status === s && !isAwaiting;
        }).length;
        if (count === 0) return null;
        const c = CELL_COLORS[s] || CELL_COLORS.IDLE;
        const label = s === 'FINISHED' ? 'AWAIT' : s.slice(0, 4);
        return (
          <span key={s} style={{
            fontSize: 10, color: c.text, background: c.bg,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 6px', fontWeight: 700,
          }}>
            {count} {label}
          </span>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data,  setData]  = useState(null);
  const [clock, setClock] = useState(new Date());
  const [allModels, setAllModels] = useState([]);
  const [lastPolled, setLastPolled] = useState(null);
  const dashRef = useRef(null);

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(setAllModels).catch(() => {});
  }, []);

  // 1-second clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Data fetch — 15s poll, matches Fleet page
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        setData(await res.json());
        setLastPolled(Date.now());
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  function enterTV() {
    dashRef.current?.requestFullscreen?.();
  }

  if (!data) {
    return (
      <div style={{
        background: '#0a0f1a', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#475569', fontSize: 18,
      }}>
        Loading…
      </div>
    );
  }

  const { stats, printers, active_projects, recent_activity } = data;

  // Group printers by model for the fleet grid
  const modelOrder = allModels.map(m => m.model_id);
  const MODEL_LABELS = Object.fromEntries(allModels.map(m => [m.model_id, m.label]));
  MODEL_LABELS.other = 'Other';
  const grouped = modelOrder.reduce((acc, m) => {
    const g = printers.filter(p => p.model === m);
    if (g.length) acc[m] = g;
    return acc;
  }, {});
  const others = printers.filter(p => !modelOrder.includes(p.model));
  if (others.length) grouped['other'] = others;

  const utilPct = printers.length > 0
    ? Math.round((stats.printing / printers.length) * 100)
    : 0;

  return (
    <div
      ref={dashRef}
      style={{
        background: '#0a0f1a',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#e2e8f0',
        userSelect: 'none',
      }}
    >

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div style={{
        background: '#0d1117', borderBottom: '1px solid #1e2433',
        padding: '0 28px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>

        {/* Left: branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 4, height: 36, background: '#1d4ed8', borderRadius: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '0.05em', color: '#f1f5f9' }}>
              PRINT FARM
            </div>
            <div style={{ fontSize: 11, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 1 }}>
              Command Center
            </div>
          </div>
        </div>

        {/* Center: utilization */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Fleet Utilization
          </span>
          <span style={{ fontSize: 32, fontWeight: 800, color: '#3b82f6', fontVariantNumeric: 'tabular-nums' }}>
            {utilPct}%
          </span>
          <span style={{ fontSize: 13, color: '#374151' }}>
            ({stats.printing} / {printers.length})
          </span>
        </div>

        {/* Right: clock + TV mode button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, color: '#60a5fa', lineHeight: 1 }}>
              {formatTime(clock)}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
              {formatDate(clock)}
            </div>
          </div>
          <PollTimer lastPolled={lastPolled} intervalMs={POLL_INTERVAL_MS} size={28} />
          <button
            onClick={enterTV}
            title="Enter fullscreen TV mode"
            style={{
              background: '#1e2433', color: '#64748b',
              border: '1px solid #2d3748', borderRadius: 6,
              padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            ⛶ TV Mode
          </button>
        </div>
      </div>

      <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── STAT CARDS ──────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {STAT_CARDS.map(({ key, label, color, accent }) => (
            <div key={key} style={{
              background: '#1e2433', borderRadius: 8,
              padding: '16px 20px',
              display: 'flex', alignItems: 'center', gap: 18,
              borderLeft: `4px solid ${accent}`,
            }}>
              <div style={{
                fontSize: 52, fontWeight: 800, color, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {(stats[key] ?? 0).toLocaleString()}
              </div>
              <div style={{
                fontSize: 11, color: '#475569',
                textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700,
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* ── FLEET GRID ──────────────────────────────────────────────────── */}
        <div style={{ background: '#111827', borderRadius: 10, padding: '16px 20px' }}>
          <div style={{
            fontSize: 11, color: '#374151',
            textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700,
            marginBottom: 14,
          }}>
            Fleet Status
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(grouped).map(([model, group]) => (
              <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

                {/* Model label */}
                <div style={{ width: 76, flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                    {MODEL_LABELS[model] || model}
                  </div>
                  <div style={{ fontSize: 11, color: '#374151' }}>×{group.length}</div>
                </div>

                {/* Printer cells */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                  {group.map(printer => {
                    const c = cellColors(printer);
                    return (
                      <div
                        key={printer.id}
                        title={`${printer.name} — ${printer.status}`}
                        style={{
                          width: 54, height: 44, borderRadius: 6,
                          background: c.bg, border: `1px solid ${c.border}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <span style={{
                          fontFamily: 'monospace', fontSize: 8, color: c.text,
                          textAlign: 'center', padding: '0 3px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          width: '100%',
                        }}>
                          {printer.name}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Per-row status summary */}
                <RowSummary group={group} />
              </div>
            ))}
          </div>

          {/* Color legend */}
          <div style={{
            display: 'flex', gap: 18, marginTop: 14,
            paddingTop: 12, borderTop: '1px solid #1e2433',
          }}>
            {LEGEND_ITEMS.map(({ label, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#475569' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── BOTTOM ROW ──────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16 }}>

          {/* Active Projects */}
          <div style={{ background: '#111827', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{
              fontSize: 11, color: '#374151',
              textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700,
              marginBottom: 14,
            }}>
              Active Projects
            </div>

            {active_projects.length === 0 ? (
              <p style={{ color: '#374151', fontSize: 13, margin: 0 }}>No active projects.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {active_projects.map(proj => (
                  <div key={proj.id} style={{
                    background: '#1e2433', borderRadius: 8, padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{proj.name}</span>
                      <span style={{
                        background: '#166534', color: '#4ade80',
                        borderRadius: 3, padding: '1px 7px',
                        fontSize: 10, fontWeight: 700,
                      }}>
                        ACTIVE
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {proj.parts.map(part => {
                        const activeQty    = part.active_qty || 0;
                        const scale        = Math.max(part.target_qty, part.completed_qty + activeQty);
                        const completedPct = scale > 0 ? (part.completed_qty / scale) * 100 : 0;
                        const activePct    = scale > 0 ? (activeQty / scale) * 100 : 0;
                        const isOver       = part.completed_qty + activeQty > part.target_qty;
                        const targetTickPct = isOver && scale > 0 ? (part.target_qty / scale) * 100 : null;
                        const pct = part.target_qty > 0
                          ? Math.round((part.completed_qty / part.target_qty) * 100)
                          : 0;
                        return (
                          <div key={part.id}>
                            <div style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              marginBottom: 4,
                            }}>
                              <span style={{ fontSize: 12, color: '#94a3b8' }}>{part.name}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                                  {part.completed_qty.toLocaleString()}
                                  {activeQty > 0 && (
                                    <span style={{ color: '#60a5fa' }}> +{activeQty.toLocaleString()}</span>
                                  )}
                                  {' / '}
                                  {part.target_qty.toLocaleString()}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: part.status === 'closed' ? '#4ade80' : '#60a5fa', minWidth: 34, textAlign: 'right' }}>
                                  {pct}%
                                </span>
                                {part.status === 'closed' && (
                                  <span style={{
                                    background: '#14532d', color: '#22c55e',
                                    borderRadius: 3, padding: '1px 5px',
                                    fontSize: 9, fontWeight: 700,
                                  }}>
                                    DONE
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ position: 'relative', background: '#0f172a', borderRadius: 3, height: 7 }}>
                              {/* Completed segment */}
                              <div style={{
                                position: 'absolute', left: 0, top: 0, height: '100%',
                                width: `${completedPct}%`,
                                background: '#22c55e',
                                borderRadius: activePct > 0 ? '3px 0 0 3px' : 3,
                                transition: 'width 0.5s',
                              }} />
                              {/* Printing segment */}
                              {activePct > 0 && (
                                <div style={{
                                  position: 'absolute', left: `${completedPct}%`, top: 0, height: '100%',
                                  width: `${activePct}%`,
                                  background: '#3b82f6',
                                  borderRadius: '0 3px 3px 0',
                                  transition: 'width 0.5s',
                                }} />
                              )}
                              {/* Target tick when active jobs push past the goal */}
                              {targetTickPct !== null && (
                                <div style={{
                                  position: 'absolute', left: `${targetTickPct}%`, top: 0,
                                  width: 2, height: '100%',
                                  background: '#f59e0b',
                                  transform: 'translateX(-50%)',
                                }} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Needs Attention — anything requiring a human, sorted by urgency */}
          <NeedsAttention printers={printers} />

          {/* Finishing Soon — currently-printing jobs sorted by ETA ascending */}
          <FinishingSoon printers={printers} />
        </div>
      </div>
    </div>
  );
}

// ── Bottom-row panels ────────────────────────────────────────────────────────

const PanelShell = ({ title, count, children }) => (
  <div style={{ background: '#111827', borderRadius: 10, padding: '16px 20px' }}>
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 14,
    }}>
      <div style={{
        fontSize: 11, color: '#374151',
        textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700,
      }}>
        {title}
      </div>
      {count != null && (
        <div style={{ fontSize: 11, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </div>
      )}
    </div>
    {children}
  </div>
);

const REASON_STYLES = {
  AWAITING: { bg: '#14532d', text: '#4ade80', label: 'AWAITING' },
  ERROR:    { bg: '#450a0a', text: '#ef4444', label: 'ERROR' },
  STOPPED:  { bg: '#431407', text: '#fb923c', label: 'STOPPED' },
  PAUSED:   { bg: '#451a03', text: '#f59e0b', label: 'PAUSED' },
  OFFLINE:  { bg: '#0d1117', text: '#475569', label: 'OFFLINE' },
};

function classifyAttention(p) {
  // Highest-priority reason first
  if (p.is_held === 1 && (p.status === 'FINISHED' || p.status === 'IDLE')) return 'AWAITING';
  if (p.status === 'ERROR')   return 'ERROR';
  if (p.status === 'STOPPED') return 'STOPPED';
  if (p.status === 'PAUSED')  return 'PAUSED';
  if (p.status === 'OFFLINE') return 'OFFLINE';
  return null;
}

// Priority for sort: AWAITING > ERROR > STOPPED > PAUSED > OFFLINE,
// then longest-waiting first.
const REASON_PRIORITY = { AWAITING: 0, ERROR: 1, STOPPED: 2, PAUSED: 3, OFFLINE: 4 };

function NeedsAttention({ printers }) {
  const items = printers
    .map(p => ({ printer: p, reason: classifyAttention(p) }))
    .filter(x => x.reason)
    .sort((a, b) => {
      const pr = REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason];
      if (pr !== 0) return pr;
      return (a.printer.last_event_at || 0) - (b.printer.last_event_at || 0);
    });

  return (
    <PanelShell title="Needs Attention" count={items.length || null}>
      {items.length === 0 ? (
        <div style={{
          color: '#22c55e', fontSize: 13, fontWeight: 600,
          background: '#0f1f17', border: '1px solid #14532d',
          borderRadius: 6, padding: '14px 12px', textAlign: 'center',
          letterSpacing: '0.05em',
        }}>
          ✓ All clear
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
          {items.map(({ printer, reason }) => {
            const s = REASON_STYLES[reason];
            const wait = formatWait(printer.last_event_at);
            return (
              <div
                key={printer.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6,
                  background: '#1a2030',
                  borderLeft: `3px solid ${s.text}`,
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                  color: s.text, background: s.bg,
                  borderRadius: 3, padding: '2px 6px',
                  minWidth: 64, textAlign: 'center', flexShrink: 0,
                }}>
                  {s.label}
                </span>
                <span style={{
                  flex: 1, fontSize: 13, color: '#e2e8f0', fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {printer.name}
                </span>
                {wait && (
                  <span style={{
                    fontSize: 11, color: '#94a3b8',
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  }}>
                    {wait}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}

function FinishingSoon({ printers }) {
  // PRINTING printers, sorted by remaining time ascending. Missing remaining is treated as last.
  const items = printers
    .filter(p => p.status === 'PRINTING')
    .sort((a, b) => {
      const ar = a.job_time_remaining ?? Infinity;
      const br = b.job_time_remaining ?? Infinity;
      return ar - br;
    })
    .slice(0, 10);

  return (
    <PanelShell title="Finishing Soon" count={items.length || null}>
      {items.length === 0 ? (
        <p style={{ color: '#374151', fontSize: 13, margin: 0 }}>No active prints.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
          {items.map(printer => {
            const remaining = printer.job_time_remaining;
            const progress  = Math.max(0, Math.min(1, printer.job_progress ?? 0));
            const pct       = Math.round(progress * 100);
            return (
              <div
                key={printer.id}
                style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: '#1a2030',
                  borderLeft: '3px solid #3b82f6',
                }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5,
                }}>
                  <span style={{
                    fontSize: 13, color: '#e2e8f0', fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flexShrink: 0, maxWidth: '50%',
                  }}>
                    {printer.name}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 11, color: '#64748b',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {printer.job_name || '—'}
                  </span>
                  <span style={{
                    fontSize: 12, color: '#60a5fa', fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 50, textAlign: 'right',
                  }}>
                    {formatRemaining(remaining)}
                  </span>
                </div>
                <div style={{
                  position: 'relative', height: 4, background: '#0f172a', borderRadius: 2,
                }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${pct}%`, background: '#3b82f6',
                    borderRadius: 2, transition: 'width 0.5s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
