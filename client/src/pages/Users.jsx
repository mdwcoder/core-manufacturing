import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import PageHeader from '../components/PageHeader';
import { theme, CARD_STYLE, INPUT_STYLE, BTN_PRIMARY, BTN_SECONDARY, tintStyle } from '../theme';

const ROLES = ['admin', 'manager', 'operator', 'viewer'];

const ROLE_COLOR = {
  admin: theme.violet,
  manager: theme.cyan,
  operator: theme.lime,
  viewer: theme.textMuted,
};

function RolePill({ role }) {
  const color = ROLE_COLOR[role] || theme.textMuted;
  return (
    <span style={{
      ...tintStyle(color),
      fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
      textTransform: 'capitalize',
    }}>
      {role}
    </span>
  );
}

// One-time reveal for a freshly generated password (creation or reset). Never fetched
// again after this render: the server only ever returns it once.
function RevealModal({ username, password, onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, maxWidth: 420, width: '100%', padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: theme.textBright, marginBottom: 8 }}>
          Temporary password for {username}
        </div>
        <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14, lineHeight: 1.5 }}>
          Copy this now. It will not be shown again, and it must be changed on first login.
        </div>
        <div style={{
          fontFamily: theme.mono, fontSize: 15, background: theme.shell,
          border: `1px solid ${theme.borderStrong}`, borderRadius: 8, padding: '10px 14px',
          color: theme.lime, wordBreak: 'break-all', marginBottom: 18,
        }}>
          {password}
        </div>
        <button style={{ ...BTN_PRIMARY, width: '100%' }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function Users({ authRole }) {
  const [showToast, toastEl] = useToast();
  const [confirm, confirmModal] = useConfirm();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState(null); // { username, password }
  const [sessionsFor, setSessionsFor] = useState(null); // user id currently expanded
  const [sessionRows, setSessionRows] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef(null);

  const canMutate = authRole === 'admin';

  const fetchUsers = useCallback(() => {
    setLoading(true);
    fetch('/api/users')
      .then(r => r.json())
      .then(setUsers)
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newUsername.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), role: newRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setReveal({ username: body.user.username, password: body.temporaryPassword });
      setNewUsername('');
      fetchUsers();
    } catch (err) {
      showToast('Create user failed: ' + err.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(user, role) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      fetchUsers();
    } catch (err) {
      showToast('Change role failed: ' + err.message, 'error');
    }
  }

  async function handleToggleActive(user) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: user.is_active ? 0 : 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      fetchUsers();
    } catch (err) {
      showToast((user.is_active ? 'Deactivate' : 'Reactivate') + ' user failed: ' + err.message, 'error');
    }
  }

  async function handleResetPassword(user) {
    const ok = await confirm({
      title: 'Reset password',
      message: `Generate a new temporary password for ${user.username}? Every open session of theirs is signed out, and they must set a new password on next login.`,
      confirmLabel: 'Reset password',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setReveal({ username: user.username, password: body.temporaryPassword });
    } catch (err) {
      showToast('Reset password failed: ' + err.message, 'error');
    }
  }

  function toggleSessions(user) {
    if (sessionsFor === user.id) {
      setSessionsFor(null);
      return;
    }
    setSessionsFor(user.id);
    setSessionsLoading(true);
    fetch(`/api/users/${user.id}/sessions`)
      .then(r => r.json())
      .then(setSessionRows)
      .catch(() => showToast('Failed to load sessions', 'error'))
      .finally(() => setSessionsLoading(false));
  }

  async function handleRevokeUserSession(user, displayId) {
    try {
      const res = await fetch(`/api/users/${user.id}/sessions/${displayId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setSessionRows(rows => rows.filter(r => r.display_id !== displayId));
    } catch (err) {
      showToast('Revoke session failed: ' + err.message, 'error');
    }
  }

  async function handleDelete(user) {
    const ok = await confirm({
      title: 'Delete user',
      message: `Delete ${user.username}? This removes their login and every open session. It does not touch anything they created.`,
      confirmLabel: 'Delete user',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      fetchUsers();
    } catch (err) {
      showToast('Delete user failed: ' + err.message, 'error');
    }
  }

  async function handleExport() {
    try {
      const res = await fetch('/api/users/export');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coma-users-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast('Export users failed: ' + err.message, 'error');
    }
  }

  async function handleImport(e) {
    e.preventDefault();
    const file = importFileRef.current?.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: parsed.users || [] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setImportResult(body);
      fetchUsers();
    } catch (err) {
      showToast('Import users failed: ' + err.message, 'error');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  }

  return (
    <div>
      <PageHeader title="Users" subtitle="Named accounts, roles, and password recovery for this CoMa install." />

      {canMutate && (
        <form onSubmit={handleCreate} style={{ ...CARD_STYLE, padding: 18, marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px', minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, fontWeight: 600, marginBottom: 6 }}>Username</label>
            <input value={newUsername} onChange={e => setNewUsername(e.target.value)} style={INPUT_STYLE} required />
          </div>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, fontWeight: 600, marginBottom: 6 }}>Role</label>
            <select value={newRole} onChange={e => setNewRole(e.target.value)} style={INPUT_STYLE}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="submit" disabled={creating} style={BTN_PRIMARY}>
            {creating ? 'Creating...' : 'Add user'}
          </button>
          <div style={{ fontSize: 11.5, color: theme.textDim, flex: '1 1 100%' }}>
            A random temporary password is generated and shown once. The new user must set their own password on first login.
          </div>
        </form>
      )}

      {canMutate && (
        <div style={{ ...CARD_STYLE, padding: 18, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.textBright, marginBottom: 4 }}>
            Migrate accounts between installations
          </div>
          <div style={{ fontSize: 11.5, color: theme.textDim, marginBottom: 12 }}>
            Exports usernames, roles, and active state only, never password hashes. Every
            imported user gets its own random temporary password and must set its own
            password on first login, exactly like adding a user above.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={handleExport} style={BTN_SECONDARY}>
              Export users
            </button>
            <form onSubmit={handleImport} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input ref={importFileRef} type="file" accept="application/json" style={{ fontSize: 12, color: theme.textMuted }} />
              <button type="submit" disabled={importing} style={BTN_SECONDARY}>
                {importing ? 'Importing...' : 'Import users'}
              </button>
            </form>
          </div>
          {importResult && (
            <div style={{ marginTop: 12, fontSize: 12, color: theme.textMuted }}>
              Created {importResult.created.length}, skipped {importResult.skipped.length}.
              {importResult.created.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {importResult.created.map(c => (
                    <div key={c.id} style={{ fontFamily: theme.mono, fontSize: 11 }}>
                      {c.username}: <span style={{ color: theme.lime }}>{c.temporaryPassword}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ ...CARD_STYLE, overflow: 'hidden' }}>
        <style>{`
          @media (max-width: 600px) {
            .users-table thead { display: none; }
            .users-table tr { display: flex; flex-direction: column; padding: 10px 14px; border-bottom: 1px solid ${theme.border}; }
            .users-table td { display: flex; justify-content: space-between; padding: 3px 0; border: none !important; }
          }
        `}</style>
        <table className="users-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: theme.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ padding: '10px 14px' }}>Username</th>
              <th style={{ padding: '10px 14px' }}>Role</th>
              <th style={{ padding: '10px 14px' }}>Status</th>
              <th style={{ padding: '10px 14px' }}>Created</th>
              {canMutate && <th style={{ padding: '10px 14px' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 20, color: theme.textMuted }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, color: theme.textMuted }}>No users.</td></tr>
            ) : users.map(u => (
              <Fragment key={u.id}>
              <tr style={{ borderTop: `1px solid ${theme.border}` }}>
                <td style={{ padding: '10px 14px', color: theme.textBright, fontWeight: 600 }}>{u.username}</td>
                <td style={{ padding: '10px 14px' }}>
                  {canMutate ? (
                    <select value={u.role} onChange={e => handleRoleChange(u, e.target.value)} style={{ ...INPUT_STYLE, width: 130, padding: '4px 8px' }}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <RolePill role={u.role} />
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {u.is_active ? (
                    <span style={{ ...tintStyle(theme.emerald), fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>Active</span>
                  ) : (
                    <span style={{ ...tintStyle(theme.red), fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>Inactive</span>
                  )}
                  {u.must_change_password ? (
                    <span style={{ marginLeft: 6, fontSize: 11, color: theme.textDim }}>(must change password)</span>
                  ) : null}
                </td>
                <td style={{ padding: '10px 14px', color: theme.textMuted }}>
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}
                </td>
                {canMutate && (
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => handleResetPassword(u)} style={{ ...BTN_SECONDARY, padding: '4px 10px', fontSize: 11.5 }}>
                        Reset password
                      </button>
                      <button onClick={() => toggleSessions(u)} style={{ ...BTN_SECONDARY, padding: '4px 10px', fontSize: 11.5 }}>
                        {sessionsFor === u.id ? 'Hide sessions' : 'Sessions'}
                      </button>
                      <button onClick={() => handleToggleActive(u)} style={{ ...BTN_SECONDARY, padding: '4px 10px', fontSize: 11.5 }}>
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        style={{ ...BTN_SECONDARY, padding: '4px 10px', fontSize: 11.5, color: theme.red, borderColor: theme.red }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
              {sessionsFor === u.id && (
                <tr>
                  <td colSpan={5} style={{ padding: '10px 14px 16px', background: theme.cardAlt }}>
                    {sessionsLoading ? (
                      <div style={{ color: theme.textMuted, fontSize: 12 }}>Loading sessions...</div>
                    ) : sessionRows.length === 0 ? (
                      <div style={{ color: theme.textMuted, fontSize: 12 }}>No open sessions.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sessionRows.map(s => (
                          <div key={s.display_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, gap: 10 }}>
                            <span style={{ color: theme.textStrong }}>
                              {s.user_agent || 'Unknown device'}{s.ip ? ` · ${s.ip}` : ''}
                              <span style={{ color: theme.textDim }}> (last seen {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : 'unknown'})</span>
                            </span>
                            <button onClick={() => handleRevokeUserSession(u, s.display_id)} style={{ ...BTN_SECONDARY, padding: '3px 9px', fontSize: 11 }}>
                              Revoke
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {reveal && (
        <RevealModal
          username={reveal.username}
          password={reveal.password}
          onClose={() => setReveal(null)}
        />
      )}
      {toastEl}
      {confirmModal}
    </div>
  );
}
