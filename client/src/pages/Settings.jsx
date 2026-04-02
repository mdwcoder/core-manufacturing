import { useState, useRef, useCallback } from 'react';

const MODEL_OPTIONS = ['mk4', 'mk4s', 'c1', 'c1l', 'xl'];

export default function Settings() {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [flaggedModels, setFlaggedModels] = useState({});
  const fileRef = useRef(null);

  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [restoreError, setRestoreError] = useState(null);
  const restoreFileRef = useRef(null);

  const handleExport = useCallback(() => {
    window.location.href = '/api/backup';
  }, []);

  async function handleRestore(e) {
    e.preventDefault();
    const file = restoreFileRef.current?.files[0];
    if (!file) return;
    if (!window.confirm('This will replace ALL current farm data with the backup. Continue?')) return;

    setRestoring(true);
    setRestoreResult(null);
    setRestoreError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/backup/restore', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setRestoreResult(data);
    } catch (err) {
      setRestoreError(err.message);
    } finally {
      setRestoring(false);
      if (restoreFileRef.current) restoreFileRef.current.value = '';
    }
  }

  async function handleImport(e) {
    e.preventDefault();
    const file = fileRef.current?.files[0];
    if (!file) return;

    setImporting(true);
    setResult(null);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/printers/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setResult(data);
      // Init model selectors for flagged rows that need manual model selection
      const initial = {};
      data.flagged.forEach((f, i) => {
        if (f.reason.includes('Cannot infer model')) {
          initial[i] = 'mk4s';
        }
      });
      setFlaggedModels(initial);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSaveFlagged(flaggedItem, selectedModel) {
    const { row } = flaggedItem;
    try {
      const res = await fetch('/api/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: row.name,
          ip: row.ip,
          api_key: row.api_key,
          group_name: row.group || null,
          type: row.type || 'prusa',
          model: selectedModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      alert(`Printer "${row.name}" saved as ${selectedModel}.`);
      // Remove from flagged list
      setResult((prev) => ({
        ...prev,
        flagged: prev.flagged.filter((f) => f !== flaggedItem),
        imported: prev.imported + 1,
      }));
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      {/* CSV Import */}
      <section style={{ background: '#1e2433', borderRadius: 10, padding: 20, marginBottom: 24, maxWidth: 640 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Import Printer Registry</h2>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
          Upload a CSV with columns: <code style={{ color: '#94a3b8' }}>name, ip, api_key, group, type</code>.<br />
          Model is inferred from the printer name. Duplicate names are skipped.
        </p>

        <form onSubmit={handleImport} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            required
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '6px 10px',
              color: '#e2e8f0',
              fontSize: 13,
              flex: '1 1 200px',
            }}
          />
          <button
            type="submit"
            disabled={importing}
            style={{
              background: importing ? '#1e40af' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: importing ? 'not-allowed' : 'pointer',
              opacity: importing ? 0.7 : 1,
            }}
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
        </form>

        {error && (
          <div style={{ marginTop: 14, background: '#7f1d1d', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <Chip color="#4ade80" label={`${result.imported} imported`} />
              <Chip color="#fbbf24" label={`${result.skipped} skipped (duplicates)`} />
              <Chip color="#f87171" label={`${result.flagged.length} flagged`} />
            </div>

            {result.flagged.length > 0 && (
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#f87171', marginBottom: 8 }}>
                  Flagged rows — resolve manually:
                </p>
                {result.flagged.map((f, i) => (
                  <div key={i} style={{
                    background: '#1a1f2e',
                    border: '1px solid #7f1d1d',
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 8,
                    fontSize: 13,
                  }}>
                    <div style={{ fontWeight: 600, color: '#fca5a5', marginBottom: 4 }}>{f.row.name}</div>
                    <div style={{ color: '#94a3b8', marginBottom: 8 }}>{f.reason}</div>
                    {f.reason.includes('Cannot infer model') && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          value={flaggedModels[i] || 'mk4s'}
                          onChange={(e) => setFlaggedModels((prev) => ({ ...prev, [i]: e.target.value }))}
                          style={{
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 4,
                            padding: '4px 8px',
                            color: '#e2e8f0',
                            fontSize: 13,
                          }}
                        >
                          {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <button
                          onClick={() => handleSaveFlagged(f, flaggedModels[i] || 'mk4s')}
                          style={{
                            background: '#15803d',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '4px 12px',
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Farm Backup / Restore */}
      <section style={{ background: '#1e2433', borderRadius: 10, padding: 20, marginBottom: 24, maxWidth: 640 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Farm Backup</h2>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
          Export a full snapshot of your printers, projects, parts, G-code files, and job history.
          Use the same file to restore on another machine or recover from data loss.
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Export */}
          <button
            onClick={handleExport}
            style={{
              background: '#0f3460',
              color: '#93c5fd',
              border: '1px solid #1e40af',
              borderRadius: 6,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Export Farm
          </button>

          {/* Restore */}
          <form onSubmit={handleRestore} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={restoreFileRef}
              type="file"
              accept=".json"
              required
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#e2e8f0',
                fontSize: 13,
                flex: '1 1 200px',
              }}
            />
            <button
              type="submit"
              disabled={restoring}
              style={{
                background: restoring ? '#7f1d1d' : '#991b1b',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: restoring ? 'not-allowed' : 'pointer',
                opacity: restoring ? 0.7 : 1,
              }}
            >
              {restoring ? 'Restoring…' : 'Restore Farm'}
            </button>
          </form>
        </div>

        {restoreError && (
          <div style={{ marginTop: 14, background: '#7f1d1d', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            {restoreError}
          </div>
        )}

        {restoreResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{ color: '#4ade80', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              Farm restored successfully
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Chip color="#4ade80" label={`${restoreResult.printers} printers`} />
              <Chip color="#4ade80" label={`${restoreResult.projects} projects`} />
              <Chip color="#4ade80" label={`${restoreResult.parts} parts`} />
              <Chip color="#4ade80" label={`${restoreResult.gcodes} G-codes`} />
              <Chip color="#4ade80" label={`${restoreResult.jobs} jobs`} />
            </div>
          </div>
        )}
      </section>

      {/* Polling interval info */}
      <section style={{ background: '#1e2433', borderRadius: 10, padding: 20, maxWidth: 640 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Polling</h2>
        <p style={{ color: '#64748b', fontSize: 13 }}>
          All printers are polled every <strong style={{ color: '#e2e8f0' }}>15 seconds</strong> via the PrusaLink API.
          Polling runs concurrently — all printers are queried in parallel each tick.
          Unreachable printers show as <span style={{ color: '#6b7280' }}>OFFLINE</span> and do not affect other printers.
        </p>
      </section>
    </div>
  );
}

function Chip({ color, label }) {
  return (
    <span style={{
      background: '#0f172a',
      border: `1px solid ${color}40`,
      borderRadius: 20,
      padding: '3px 12px',
      fontSize: 13,
      color,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}
