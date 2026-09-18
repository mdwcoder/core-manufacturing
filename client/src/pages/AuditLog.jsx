import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';
import { theme, CARD_STYLE, INPUT_STYLE, BTN_SECONDARY } from '../theme';

const PAGE_SIZE = 50;

function formatTimestamp(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
}

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');

  const fetchRows = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (userId.trim()) params.set('user_id', userId.trim());
    if (action.trim()) params.set('action', action.trim());
    if (entityType.trim()) params.set('entity_type', entityType.trim());
    fetch(`/api/audit-log?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        setRows(data.rows || []);
        setTotal(data.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [offset, userId, action, entityType]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  function applyFilters(e) {
    e.preventDefault();
    setOffset(0);
    fetchRows();
  }

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Who did what: logins, user changes, backups, and safety-sensitive fleet actions. Never pruned." />

      <form onSubmit={applyFilters} style={{ ...CARD_STYLE, padding: 16, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 140 }}>
          <label style={{ display: 'block', fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>User ID</label>
          <input value={userId} onChange={e => setUserId(e.target.value)} style={INPUT_STYLE} placeholder="any" />
        </div>
        <div style={{ width: 200 }}>
          <label style={{ display: 'block', fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>Action</label>
          <input value={action} onChange={e => setAction(e.target.value)} style={INPUT_STYLE} placeholder="e.g. auth.login" />
        </div>
        <div style={{ width: 160 }}>
          <label style={{ display: 'block', fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>Entity type</label>
          <input value={entityType} onChange={e => setEntityType(e.target.value)} style={INPUT_STYLE} placeholder="e.g. user" />
        </div>
        <button type="submit" style={BTN_SECONDARY}>Filter</button>
      </form>

      <div style={{ ...CARD_STYLE, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: theme.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ padding: '9px 12px' }}>When</th>
              <th style={{ padding: '9px 12px' }}>User</th>
              <th style={{ padding: '9px 12px' }}>Action</th>
              <th style={{ padding: '9px 12px' }}>Entity</th>
              <th style={{ padding: '9px 12px' }}>Note</th>
              <th style={{ padding: '9px 12px' }}>IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, color: theme.textMuted }}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, color: theme.textMuted }}>No matching entries.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                <td style={{ padding: '8px 12px', color: theme.textMuted, whiteSpace: 'nowrap' }}>{formatTimestamp(r.created_at)}</td>
                <td style={{ padding: '8px 12px', color: theme.textBright }}>{r.username || (r.user_id ? `#${r.user_id}` : 'unknown')}</td>
                <td style={{ padding: '8px 12px', fontFamily: theme.mono, color: theme.violet }}>{r.action}</td>
                <td style={{ padding: '8px 12px', color: theme.textMuted }}>{r.entity_type ? `${r.entity_type}${r.entity_id ? ` #${r.entity_id}` : ''}` : ''}</td>
                <td style={{ padding: '8px 12px', color: theme.textMuted }}>{r.note || ''}</td>
                <td style={{ padding: '8px 12px', color: theme.textDim, fontFamily: theme.mono }}>{r.ip || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: theme.textMuted }}>
          {total > 0 ? `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} of ${total}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={BTN_SECONDARY}
            disabled={offset === 0}
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            style={BTN_SECONDARY}
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(o => o + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
