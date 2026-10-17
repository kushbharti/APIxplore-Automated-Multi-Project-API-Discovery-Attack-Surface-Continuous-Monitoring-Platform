import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import {
  APIxploreLogo, DashboardIcon, DiscoveryIcon, NetworkGraphIcon,
  EndpointsIcon, PulseIcon, AlertOctagonIcon, BellIcon, ChartIcon,
  HistoryIcon, CpuIcon, SettingsIcon, FolderIcon, PlusIcon,
  ChevronDownIcon, SearchIcon, MenuIcon, CloseIcon,
  ChevronLeftIcon, ChevronRightIcon
} from './icons';

const navSections = [
  {
    title: 'Command Center',
    items: [
      { icon: <DashboardIcon size={18} />, label: 'Dashboard', path: '/dashboard' },
      { icon: <NetworkGraphIcon size={18} />, label: 'Discovery Graph', path: '/graph' },
    ]
  },
  {
    title: 'Discovery & Surface',
    items: [
      { icon: <DiscoveryIcon size={18} />, label: 'Discovery', path: '/discovery' },
      { icon: <HistoryIcon size={18} />, label: 'Discovery History', path: '/discovery/history' },
      { icon: <FolderIcon size={18} />, label: 'Projects', path: '/projects' },
      { icon: <PlusIcon size={18} />, label: 'Add Project', path: '/projects/new' },
    ]
  },
  {
    title: 'Monitoring & Health',
    items: [
      { icon: <PulseIcon size={18} />, label: 'Monitoring', path: '/monitoring' },
      { icon: <EndpointsIcon size={18} />, label: 'Endpoints', path: '/endpoints' },
    ]
  },
  {
    title: 'Security Operations',
    items: [
      { icon: <AlertOctagonIcon size={18} />, label: 'Incidents', path: '/incidents' },
      { icon: <BellIcon size={18} />, label: 'Alerts', path: '/alerts' },
    ]
  },
  {
    title: 'Analytics & System',
    items: [
      { icon: <ChartIcon size={18} />, label: 'Analytics', path: '/analytics' },
      { icon: <CpuIcon size={18} />, label: 'System Health', path: '/system-health' },
      { icon: <SettingsIcon size={18} />, label: 'Settings', path: '/settings' },
    ]
  }
];

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const [lastUpdatedSecs, setLastUpdatedSecs] = useState<number>(0);
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  
  // Persist sidebar collapsed state
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('apixplore_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('apixplore_sidebar_collapsed', String(next));
      } catch {
        // storage disabled or unavailable
      }
      return next;
    });
  };

  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  const queryClient = useQueryClient();

  // Fetch real projects for dropdown
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch('/projects')
  });

  const [selectedProject, setSelectedProject] = useState<string>('example.com');

  useEffect(() => {
    const timer = setInterval(() => {
      const queries = queryClient.getQueryCache().getAll();
      let mostRecent = 0;
      queries.forEach(q => {
        if (q.state.dataUpdatedAt > mostRecent) {
          mostRecent = q.state.dataUpdatedAt;
        }
      });
      if (mostRecent > 0) {
        setLastUpdatedSecs(Math.floor((Date.now() - mostRecent) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [queryClient]);

  return (
    <div className="flex h-screen bg-[#f8fafc] text-slate-800 font-sans overflow-hidden selection:bg-blue-600 selection:text-white">
      {/* ── Mobile Sidebar Backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-30 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Collapsible Left Sidebar ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 bg-white border-r border-slate-200 flex flex-col flex-shrink-0 shadow-xs transition-all duration-300 ease-in-out lg:static ${
          sidebarOpen ? 'translate-x-0 w-72 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}`}
        aria-label="Sidebar navigation"
      >
        {/* Branding & Header Toggle */}
        <div className={`h-16 flex items-center border-b border-slate-200 transition-all ${
          isCollapsed ? 'justify-center px-2' : 'justify-between px-5'
        }`}>
          {/* Logo & Brand Name */}
          <div
            onClick={() => {
              navigate('/');
              setSidebarOpen(false);
            }}
            className="cursor-pointer flex items-center gap-2.5 hover:opacity-90 transition-opacity"
            title="APIxplore Home"
          >
            <APIxploreLogo size={26} />
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-base tracking-tight text-slate-900">
                  APIxplore
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  PRO
                </span>
              </div>
            )}
          </div>

          {/* Desktop Toggle Button */}
          <div className="hidden lg:flex items-center gap-1">
            <button
              onClick={toggleCollapsed}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              title={isCollapsed ? 'Expand sidebar (Ctrl+[)' : 'Collapse sidebar'}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
            </button>
          </div>

          {/* Mobile Close Button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden ml-auto p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            aria-label="Close menu"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 py-4 px-3 flex flex-col gap-3 overflow-y-auto overflow-x-hidden">
          {navSections.map((section, idx) => (
            <div key={idx} className="flex flex-col gap-0.5">
              {!isCollapsed ? (
                <div className="px-3 mb-1 text-[10px] font-bold tracking-wider uppercase text-slate-400">
                  {section.title}
                </div>
              ) : (
                idx > 0 && <div className="my-1.5 border-t border-slate-100" />
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  title={isCollapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center rounded-xl text-xs font-semibold transition-all duration-150 ${
                      isCollapsed
                        ? 'justify-center p-2.5'
                        : 'gap-3 px-3 py-2'
                    } ${
                      isActive
                        ? 'bg-blue-50 text-blue-600 border border-blue-100 shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`
                  }
                >
                  <span className="flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity text-slate-500 group-hover:text-blue-600">
                    {item.icon}
                  </span>
                  {!isCollapsed && <span className="truncate">{item.label}</span>}

                  {/* Floating tooltip on hover in icon-only mode */}
                  {isCollapsed && (
                    <span className="hidden lg:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-lg shadow-xl pointer-events-none whitespace-nowrap z-50">
                      {item.label}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}

          {/* Quick link to 3D Landing Page */}
          <div className="mt-auto pt-2 border-t border-slate-100 px-1">
            <button
              onClick={() => navigate('/')}
              title={isCollapsed ? '3D Experience' : undefined}
              className={`w-full flex items-center rounded-xl bg-gradient-to-r from-slate-900 to-blue-950 text-white text-xs font-semibold hover:shadow-md transition-all group relative ${
                isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                {!isCollapsed && <span>3D Experience</span>}
              </span>
              {!isCollapsed && (
                <span className="text-blue-300 text-[10px] group-hover:translate-x-0.5 transition-transform">
                  Enter →
                </span>
              )}
              {isCollapsed && (
                <span className="hidden lg:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-lg shadow-xl pointer-events-none whitespace-nowrap z-50">
                  3D Experience
                </span>
              )}
            </button>
          </div>
        </nav>

        {/* Discovery Status Card in Sidebar Bottom */}
        <div className={`border-t border-slate-200 bg-slate-50/60 transition-all ${
          isCollapsed ? 'p-3 flex flex-col items-center' : 'p-4'
        }`}>
          {!isCollapsed ? (
            <>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Discovery Status
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-emerald-800">Operational</span>
              </div>
              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-2">
                <div className="bg-emerald-500 h-full rounded-full w-full" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 font-medium">
                <span>Active Discovery Engine</span>
                <span>Ready</span>
              </div>
            </>
          ) : (
            <div
              className="relative group cursor-pointer flex flex-col items-center justify-center p-1"
              title="Discovery Engine: Operational (Ready)"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="hidden lg:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-lg shadow-xl pointer-events-none whitespace-nowrap z-50">
                Discovery Engine: Operational
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Workspace ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar (from screenshot) */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 gap-3 z-10 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Mobile Sidebar Hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              aria-label="Open navigation menu"
            >
              <MenuIcon size={20} />
            </button>

            {/* Project Selector (from screenshot: "Project [ example.com v ]") */}
            <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
              <span className="hidden sm:inline">Project</span>
              <div className="relative">
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 font-bold text-xs rounded-xl pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 max-w-[140px] sm:max-w-[200px] truncate"
                >
                  <option value="example.com">example.com</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.url}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon
                  size={13}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
              </div>
            </div>
          </div>

          {/* Center Search Input (from screenshot: "Search endpoints...") */}
          <div className="hidden sm:block flex-1 max-w-xs md:max-w-md relative">
            <SearchIcon size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search endpoints..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          {/* Right Controls: Freshness, Notifications & User Avatar */}
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden xl:inline-flex text-[11px] text-slate-400 font-medium">
              Updated {lastUpdatedSecs}s ago
            </span>
            <button
              onClick={() => navigate('/alerts')}
              className="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              title="Alert Notifications"
            >
              <BellIcon size={17} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500" />
            </button>

            {/* User Pill from screenshot */}
            <div className="flex items-center gap-2 sm:gap-2.5 pl-2 sm:pl-3 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shadow-xs flex-shrink-0">
                KU
              </div>
              <div className="hidden md:block text-xs">
                <div className="font-bold text-slate-900 leading-tight">Kush</div>
                <div className="text-[10px] text-slate-500">Security Admin</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
