import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Fleet from './pages/Fleet';
import Projects from './pages/Projects';
import Jobs from './pages/Jobs';
import Settings from './pages/Settings';
import Decommissioned from './pages/Decommissioned';

const NAV_ITEMS = [
  { to: '/',               label: 'Dashboard' },
  { to: '/fleet',          label: 'Fleet' },
  { to: '/projects',       label: 'Projects' },
  { to: '/jobs',           label: 'Jobs' },
  { to: '/decommissioned', label: 'Decommissioned' },
  { to: '/settings',       label: 'Settings' },
];

const navLinkStyle = ({ isActive }) => ({
  display: 'block',
  padding: '8px 14px',
  borderRadius: 6,
  color: isActive ? '#fff' : '#94a3b8',
  background: isActive ? '#1e40af' : 'transparent',
  textDecoration: 'none',
  fontWeight: isActive ? 700 : 400,
  fontSize: 14,
  transition: 'background 0.15s',
  whiteSpace: 'nowrap',
});

export default function App() {
  return (
    <BrowserRouter>
      {/* Responsive layout: sidebar on desktop, top nav bar on mobile */}
      <style>{`
        #layout { display: flex; min-height: 100vh; }
        #sidebar { width: 180px; flex-shrink: 0; background: #131720; border-right: 1px solid #1e2433; display: flex; flex-direction: column; padding: 16px 8px; gap: 4px; }
        #topbar { display: none; background: #131720; border-bottom: 1px solid #1e2433; padding: 8px 12px; align-items: center; gap: 8px; flex-wrap: wrap; }
        #main { flex: 1; padding: 24px 28px; overflow-y: auto; min-width: 0; }
        @media (max-width: 600px) {
          #layout { flex-direction: column; }
          #sidebar { display: none; }
          #topbar { display: flex; }
          #main { padding: 16px 14px; }
        }
      `}</style>

      <div id="layout">
        {/* Sidebar (desktop) */}
        <nav id="sidebar">
          <div style={{ padding: '0 6px 16px', borderBottom: '1px solid #1e2433', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0', lineHeight: 1.3 }}>Print Farm</div>
            <div style={{ fontWeight: 400, fontSize: 11, color: '#475569' }}>Manager</div>
          </div>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} style={navLinkStyle}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Top nav bar (mobile) */}
        <nav id="topbar">
          <span style={{ fontWeight: 800, fontSize: 14, color: '#e2e8f0', marginRight: 8 }}>Print Farm</span>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                padding: '5px 10px',
                borderRadius: 6,
                color: isActive ? '#fff' : '#94a3b8',
                background: isActive ? '#1e40af' : '#1e2433',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: isActive ? 700 : 400,
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Main content */}
        <main id="main">
          <Routes>
            <Route path="/"               element={<Dashboard />} />
            <Route path="/fleet"          element={<Fleet />} />
            <Route path="/projects"       element={<Projects />} />
            <Route path="/jobs"           element={<Jobs />} />
            <Route path="/decommissioned" element={<Decommissioned />} />
            <Route path="/settings"       element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
