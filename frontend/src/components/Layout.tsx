import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, LayoutDashboard, AlertOctagon, Shield, Cpu, ChevronRight,
  FolderOpen, PlusSquare, Search, History, LineChart, Bell, Settings as SettingsIcon
} from 'lucide-react';

const navSections = [
  {
    title: 'Overview',
    items: [
      { icon: <LayoutDashboard size={16} />, label: 'Dashboard', path: '/' },
    ]
  },
  {
    title: 'Project Management',
    items: [
      { icon: <FolderOpen size={16} />, label: 'Projects', path: '/projects' },
      { icon: <PlusSquare size={16} />, label: 'Add Project', path: '/projects/new' },
    ]
  },
  {
    title: 'Discovery',
    items: [
      { icon: <Search size={16} />, label: 'Discovery', path: '/discovery' },
      { icon: <History size={16} />, label: 'Discovery History', path: '/discovery/history' },
    ]
  },
  {
    title: 'Monitoring',
    items: [
      { icon: <Activity size={16} />, label: 'Endpoints', path: '/endpoints' },
    ]
  },
  {
    title: 'Operations',
    items: [
      { icon: <AlertOctagon size={16} />, label: 'Incidents', path: '/incidents' },
      { icon: <Bell size={16} />, label: 'Alerts', path: '/alerts' },
    ]
  },
  {
    title: 'Analytics',
    items: [
      { icon: <LineChart size={16} />, label: 'Analytics', path: '/analytics' },
      { icon: <Cpu size={16} />, label: 'System Health', path: '/system-health' },
    ]
  },
  {
    title: 'Configuration',
    items: [
      { icon: <SettingsIcon size={16} />, label: 'Settings', path: '/settings' },
    ]
  }
];

const pageLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/projects': 'Projects',
  '/projects/new': 'Add Project',
  '/discovery': 'Discovery',
  '/discovery/history': 'Discovery History',
  '/endpoints': 'Endpoints',
  '/incidents': 'Incidents',
  '/alerts': 'Alerts',
  '/analytics': 'Analytics',
  '/system-health': 'System Health',
  '/settings': 'Settings',
};

export const Layout = () => {
  const location = useLocation();
  const [lastUpdatedSecs, setLastUpdatedSecs] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setInterval(() => {
      // Find the most recent update across all active queries
      const queries = queryClient.getQueryCache().getAll();
      let mostRecent = 0;
      queries.forEach(q => {
        if (q.state.dataUpdatedAt > mostRecent) {
          mostRecent = q.state.dataUpdatedAt;
        }
      });
      
      if (mostRecent > 0) {
        setLastUpdatedSecs(Math.floor((Date.now() - mostRecent) / 1000));
      } else {
        setLastUpdatedSecs(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [queryClient]);

  // Find deepest matching label (e.g. project detail pages)
  const breadcrumb = (() => {
    if (location.pathname === '/projects/new') return ['Projects', 'Add Project'];
    if (location.pathname.startsWith('/projects/')) return ['Projects', 'Project Details'];
    if (location.pathname.startsWith('/endpoints/')) return ['Endpoints', 'Endpoint Details'];
    return [pageLabels[location.pathname] || 'Dashboard'];
  })();

  return (
    <div className="flex h-screen bg-[var(--bg-dark)] text-[var(--text-primary)] font-sans">
      {/* ── Sidebar ── */}
      <aside
        className="w-[260px] flex flex-col z-20 relative flex-shrink-0"
        style={{
          background: 'var(--bg-primary)',
          borderRight: '1px solid var(--border-color)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.03)',
        }}
      >
        {/* Logo */}
        <div
          className="h-[68px] flex items-center px-5 gap-3"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--primary), var(--purple))',
              boxShadow: '0 0 20px rgba(99,102,241,0.4)',
            }}
          >
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-white leading-tight">Self-Healing</div>
            <div className="text-[10px] text-[var(--text-secondary)] font-medium tracking-widest uppercase">
              API Observability
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 flex flex-col overflow-y-auto" style={{ gap: '1.25rem' }}>
          {navSections.map((section, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <div className="px-3 mb-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--muted)]">
                  {section.title}
                </span>
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 font-medium text-[13px] relative ${
                      isActive
                        ? 'text-[var(--primary)] font-bold'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[rgba(0,0,0,0.02)]'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'var(--primary-transparent)',
                    border: '1px solid rgba(99,102,241,0.2)',
                    boxShadow: 'inset 3px 0 0 var(--primary)',
                  } : {
                    border: '1px solid transparent',
                  }}
                >
                  <span className="flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0 leading-tight truncate">{item.label}</div>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-[rgba(255,255,255,0.03)] cursor-pointer"
            style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}
          >
            <div className="live-dot flex-shrink-0">
              <div className="live-dot-inner" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--success)]">System Online</div>
              <div className="text-[10px] text-[var(--muted)]">All services running</div>
            </div>
            <Cpu size={14} className="ml-auto text-[var(--muted)]" />
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="h-[68px] flex items-center px-8 gap-4 flex-shrink-0 z-10 glass-panel"
          style={{
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-[13px] flex-1">
            {breadcrumb.map((label, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <ChevronRight size={14} className="text-[var(--muted)]" />}
                <span
                  className={
                    i === breadcrumb.length - 1
                      ? 'font-semibold text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors'
                  }
                >
                  {label}
                </span>
              </span>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
              <Activity size={14} className="text-[var(--muted)]" />
              <span>Last updated: {lastUpdatedSecs}s ago</span>
            </div>
            <div className="h-4 w-px bg-[var(--border-color)]"></div>
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-lg"
              style={{
                background: 'var(--primary-transparent)',
                color: 'var(--primary-light)',
                border: '1px solid rgba(99,102,241,0.2)',
              }}
            >
              v0.1.0
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto relative">
          <div className="p-8 min-h-full animate-fade-in mx-auto" style={{ maxWidth: '1440px' }}>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};

