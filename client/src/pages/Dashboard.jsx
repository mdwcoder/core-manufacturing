import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [printers, setPrinters] = useState([]);

  useEffect(() => {
    fetch('/api/printers')
      .then((r) => r.json())
      .then(setPrinters)
      .catch(() => {});
    const id = setInterval(() => {
      fetch('/api/printers').then((r) => r.json()).then(setPrinters).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const counts = printers.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
        <StatCard label="Total" value={printers.length} color="#60a5fa" />
        <StatCard label="Printing" value={counts.PRINTING || 0} color="#4ade80" />
        <StatCard label="Idle" value={counts.IDLE || 0} color="#93c5fd" />
        <StatCard label="Error" value={counts.ERROR || 0} color="#f87171" />
        <StatCard label="Attention" value={counts.ATTENTION || 0} color="#fbbf24" />
        <StatCard label="Offline" value={counts.OFFLINE || 0} color="#6b7280" />
      </div>

      <div style={{ background: '#1e2433', borderRadius: 10, padding: 20, maxWidth: 480 }}>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
          Project management and job scheduling are coming in Phase 2.
        </p>
        <Link
          to="/fleet"
          style={{
            display: 'inline-block',
            background: '#2563eb',
            color: '#fff',
            borderRadius: 6,
            padding: '8px 18px',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          View Fleet →
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: '#1e2433',
      borderRadius: 8,
      padding: '14px 16px',
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  );
}
