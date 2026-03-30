import { useState, useEffect, useCallback } from 'react';

const MODEL_OPTIONS = ['mk4', 'mk4s', 'c1', 'c1l', 'xl'];

const PROJECT_STATUS = {
  draft:     { bg: '#1f2937', text: '#9ca3af', label: 'Draft' },
  active:    { bg: '#166534', text: '#4ade80', label: 'Active' },
  paused:    { bg: '#713f12', text: '#fcd34d', label: 'Paused' },
  completed: { bg: '#14532d', text: '#86efac', label: 'Completed' },
};

const PART_STATUS = {
  open:   { bg: '#1e3a5f', text: '#60a5fa', label: 'Open' },
  closed: { bg: '#14532d', text: '#86efac', label: 'Closed' },
};

const inputSx = {
  background: '#0f172a',
  border: '1px solid #2d3748',
  borderRadius: 4,
  padding: '5px 10px',
  color: '#e2e8f0',
  fontSize: 13,
  outline: 'none',
};

function GcodeUploadPanel({ part, onUploaded }) {
  const [file, setFile]             = useState(null);
  const [partsPerPlate, setPPP]     = useState('');
  const [model, setModel]           = useState('');
  const [error, setError]           = useState(null);
  const [uploading, setUploading]   = useState(false);

  async function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError(null);
    try {
      const res = await fetch('/api/gcodes/parse-filename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: f.name }),
      });
      const data = await res.json();
      if (!data.parse_failed) {
        setPPP(String(data.parts_per_plate));
        if (data.printer_model) setModel(data.printer_model);
      }
    } catch (_) {}
  }

  async function handleUpload() {
    if (!file)           { setError('Choose a file first.'); return; }
    if (!partsPerPlate)  { setError('Enter parts per plate.'); return; }
    if (!model)          { setError('Select a printer model.'); return; }

    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('part_id', String(part.id));
    fd.append('parts_per_plate', partsPerPlate);
    fd.append('printer_model', model);

    try {
      const res  = await fetch('/api/gcodes/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed.');
      } else {
        setFile(null); setPPP(''); setModel('');
        onUploaded();
      }
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  }

  return (
    <div style={{ background: '#0a0f1a', borderRadius: 6, padding: '10px 12px', marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ cursor: 'pointer' }}>
          <input type="file" accept=".bgcode,.gcode" onChange={handleFileChange} style={{ display: 'none' }} />
          <span style={{
            ...inputSx,
            display: 'inline-block',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            color: file ? '#e2e8f0' : '#475569',
          }}>
            {file ? file.name : 'Choose .bgcode / .gcode…'}
          </span>
        </label>
        <input
          type="number"
          min={1}
          placeholder="Parts/plate"
          value={partsPerPlate}
          onChange={(e) => setPPP(e.target.value)}
          style={{ ...inputSx, width: 100 }}
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{ ...inputSx, width: 90 }}
        >
          <option value="">Model…</option>
          {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          onClick={handleUpload}
          disabled={uploading}
          style={{
            background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4,
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.7 : 1,
          }}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects]         = useState([]);
  const [loading, setLoading]           = useState(true);

  // Detail view
  const [selectedId, setSelectedId]     = useState(null);
  const [detailProject, setDetailProject] = useState(null);
  const [parts, setParts]               = useState([]);
  const [gcodesMap, setGcodesMap]       = useState({});

  // New project form
  const [showNewForm, setShowNewForm]   = useState(false);
  const [newName, setNewName]           = useState('');
  const [newDesc, setNewDesc]           = useState('');

  // Add part form
  const [newPartName, setNewPartName]   = useState('');
  const [newPartQty, setNewPartQty]     = useState('');
  const [addingPart, setAddingPart]     = useState(false);

  // completed_qty edit
  const [editPartId, setEditPartId]     = useState(null);
  const [editQtyVal, setEditQtyVal]     = useState('');

  // G-code upload panels (set of open part IDs)
  const [openPanels, setOpenPanels]     = useState(new Set());

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      setProjects(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const fetchDetail = useCallback(async (projectId) => {
    const [projRes, partsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/parts?project_id=${projectId}`),
    ]);
    const proj      = await projRes.json();
    const partsData = await partsRes.json();

    const gcodesArrays = await Promise.all(
      partsData.map(p => fetch(`/api/gcodes?part_id=${p.id}`).then(r => r.json()))
    );
    const gcMap = {};
    partsData.forEach((p, i) => { gcMap[p.id] = gcodesArrays[i]; });

    setDetailProject(proj);
    setParts(partsData);
    setGcodesMap(gcMap);
  }, []);

  useEffect(() => {
    if (selectedId != null) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  async function createProject() {
    if (!newName.trim()) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
    });
    if (res.ok) {
      setNewName(''); setNewDesc(''); setShowNewForm(false);
      await fetchProjects();
    }
  }

  async function updateProjectStatus(id, status) {
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (status === 'active') {
      fetch('/api/scheduler/dispatch', { method: 'POST' }).catch(() => {});
    }
    await Promise.all([fetchDetail(id), fetchProjects()]);
  }

  async function addPart() {
    if (!newPartName.trim() || !newPartQty) return;
    setAddingPart(true);
    await fetch('/api/parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: selectedId, name: newPartName.trim(), target_qty: parseInt(newPartQty, 10) }),
    });
    setNewPartName(''); setNewPartQty('');
    setAddingPart(false);
    await fetchDetail(selectedId);
  }

  async function submitEditQty(part) {
    const newVal = parseInt(editQtyVal, 10);
    if (isNaN(newVal) || newVal < 0) return;

    let msg = `Update completed quantity to ${newVal}?`;
    if (newVal < part.target_qty && part.status === 'closed') {
      msg = 'This will reopen the Part and resume dispatching. Confirm?';
    } else if (newVal >= part.target_qty && part.status === 'open') {
      msg = 'This will close the Part and stop all dispatching. Confirm?';
    }
    if (!window.confirm(msg)) return;

    await fetch(`/api/parts/${part.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed_qty: newVal }),
    });
    setEditPartId(null); setEditQtyVal('');
    await fetchDetail(selectedId);
  }

  async function deleteGcode(gcodeId) {
    if (!window.confirm('Delete this G-code file?')) return;
    await fetch(`/api/gcodes/${gcodeId}`, { method: 'DELETE' });
    await fetchDetail(selectedId);
  }

  function togglePanel(partId) {
    setOpenPanels(prev => {
      const next = new Set(prev);
      next.has(partId) ? next.delete(partId) : next.add(partId);
      return next;
    });
  }

  function goBack() {
    setSelectedId(null); setDetailProject(null); setParts([]); setGcodesMap({});
    setEditPartId(null); setEditQtyVal(''); setOpenPanels(new Set());
  }

  // ─── List view ───────────────────────────────────────────────────────────────
  if (selectedId == null) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Projects</h1>
          <button
            onClick={() => setShowNewForm(v => !v)}
            style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + New Project
          </button>
        </div>

        {showNewForm && (
          <div style={{ background: '#1e2433', border: '1px solid #2d3748', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ color: '#94a3b8', fontSize: 12 }}>Name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                style={{ ...inputSx, width: 220 }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ color: '#94a3b8', fontSize: 12 }}>Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional"
                style={{ ...inputSx, width: 280 }}
              />
            </div>
            <button
              onClick={createProject}
              style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Create
            </button>
            <button
              onClick={() => { setShowNewForm(false); setNewName(''); setNewDesc(''); }}
              style={{ background: '#1f2937', color: '#9ca3af', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}

        {loading && <p style={{ color: '#64748b' }}>Loading…</p>}
        {!loading && projects.length === 0 && (
          <p style={{ color: '#64748b' }}>No projects yet. Create one above.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map(p => {
            const s = PROJECT_STATUS[p.status] || PROJECT_STATUS.draft;
            return (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  background: '#1e2433', border: '1px solid #2d3748', borderRadius: 8,
                  padding: '12px 16px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  {p.description && (
                    <div style={{ color: '#64748b', fontSize: 12 }}>{p.description}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ background: s.bg, color: s.text, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                    {s.label}
                  </span>
                  <span style={{ color: '#475569', fontSize: 13 }}>→</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Detail view ─────────────────────────────────────────────────────────────
  if (!detailProject) return <p style={{ color: '#64748b' }}>Loading…</p>;

  const projSt = PROJECT_STATUS[detailProject.status] || PROJECT_STATUS.draft;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={goBack}
          style={{ background: '#1f2937', color: '#94a3b8', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}
        >
          ← Projects
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{detailProject.name}</h1>
        <span style={{ background: projSt.bg, color: projSt.text, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
          {projSt.label}
        </span>
        {detailProject.status === 'draft' && (
          <button
            onClick={() => updateProjectStatus(detailProject.id, 'active')}
            style={{ background: '#166534', color: '#4ade80', border: 'none', borderRadius: 4, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Activate
          </button>
        )}
        {detailProject.status === 'active' && (
          <button
            onClick={() => updateProjectStatus(detailProject.id, 'paused')}
            style={{ background: '#713f12', color: '#fcd34d', border: 'none', borderRadius: 4, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Pause
          </button>
        )}
        {detailProject.status === 'paused' && (
          <button
            onClick={() => updateProjectStatus(detailProject.id, 'active')}
            style={{ background: '#166534', color: '#4ade80', border: 'none', borderRadius: 4, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Resume
          </button>
        )}
      </div>

      {/* Parts */}
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        Parts
      </h2>

      {parts.length === 0 && (
        <p style={{ color: '#475569', fontSize: 14, marginBottom: 16 }}>No parts yet. Add one below.</p>
      )}

      {parts.map(part => {
        const partGs    = gcodesMap[part.id] || [];
        const progress  = part.target_qty > 0 ? Math.min(1, part.completed_qty / part.target_qty) : 0;
        const pct       = Math.round(progress * 100);
        const partSt    = PART_STATUS[part.status] || PART_STATUS.open;
        const isEditing = editPartId === part.id;
        const panelOpen = openPanels.has(part.id);

        return (
          <div key={part.id} style={{ background: '#1e2433', border: '1px solid #2d3748', borderRadius: 8, padding: '12px 16px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>

              {/* Name */}
              <span style={{ fontWeight: 600, fontSize: 14, flex: '1 1 100px', minWidth: 80 }}>{part.name}</span>

              {/* Progress */}
              <div style={{ flex: '2 1 160px', minWidth: 120 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>
                  <span>{part.completed_qty} / {part.target_qty}</span>
                  <span>{pct}%</span>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 3, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    background: part.status === 'closed' ? '#22c55e' : '#3b82f6',
                    height: '100%', width: `${pct}%`, borderRadius: 3, transition: 'width 0.3s',
                  }} />
                </div>
              </div>

              {/* Status badge */}
              <span style={{ background: partSt.bg, color: partSt.text, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {partSt.label}
              </span>

              {/* G-code chips */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {partGs.map(gc => (
                  <span
                    key={gc.id}
                    style={{
                      background: '#0f172a', border: '1px solid #2d3748', borderRadius: 4,
                      padding: '1px 4px 1px 8px', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace',
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    {gc.printer_model}
                    <button
                      onClick={() => deleteGcode(gc.id)}
                      title="Delete G-code"
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                    >×</button>
                  </span>
                ))}
              </div>

              {/* Edit completed_qty */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      value={editQtyVal}
                      onChange={(e) => setEditQtyVal(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitEditQty(part)}
                      style={{ ...inputSx, width: 70 }}
                      autoFocus
                    />
                    <button
                      onClick={() => submitEditQty(part)}
                      style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditPartId(null); setEditQtyVal(''); }}
                      style={{ background: '#1f2937', color: '#9ca3af', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditPartId(part.id); setEditQtyVal(String(part.completed_qty)); }}
                    style={{ background: '#1f2937', color: '#94a3b8', border: '1px solid #2d3748', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                  >
                    Edit qty
                  </button>
                )}
              </div>

              {/* G-code upload toggle */}
              <button
                onClick={() => togglePanel(part.id)}
                style={{
                  background: panelOpen ? '#1e3a5f' : '#1f2937',
                  color: panelOpen ? '#60a5fa' : '#64748b',
                  border: `1px solid ${panelOpen ? '#1e40af' : '#2d3748'}`,
                  borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0,
                }}
              >
                {panelOpen ? '▲ G-code' : '▼ G-code'}
              </button>
            </div>

            {panelOpen && (
              <GcodeUploadPanel part={part} onUploaded={() => fetchDetail(selectedId)} />
            )}
          </div>
        );
      })}

      {/* Add Part form */}
      <div style={{ background: '#1e2433', border: '1px solid #2d3748', borderRadius: 8, padding: 16, marginTop: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Add Part
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ color: '#64748b', fontSize: 12 }}>Part name *</label>
            <input
              type="text"
              value={newPartName}
              onChange={(e) => setNewPartName(e.target.value)}
              placeholder="e.g. Left bracket"
              onKeyDown={(e) => e.key === 'Enter' && addPart()}
              style={{ ...inputSx, width: 220 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ color: '#64748b', fontSize: 12 }}>Target qty *</label>
            <input
              type="number"
              min={1}
              value={newPartQty}
              onChange={(e) => setNewPartQty(e.target.value)}
              placeholder="100"
              onKeyDown={(e) => e.key === 'Enter' && addPart()}
              style={{ ...inputSx, width: 100 }}
            />
          </div>
          <button
            onClick={addPart}
            disabled={addingPart}
            style={{
              background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4,
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              cursor: addingPart ? 'not-allowed' : 'pointer',
              opacity: addingPart ? 0.7 : 1,
            }}
          >
            Add Part
          </button>
        </div>
      </div>
    </div>
  );
}
