import { useState } from 'react';
import {
  Activity, ShieldAlert, Server, ArrowRight, Globe, Layers,
  AlertTriangle, Lock, CheckCircle2, ExternalLink, TrendingUp,
  Zap, AlertOctagon, RefreshCw, Search, Plus
} from '../components/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, OverviewStats } from '../types';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { formatDate } from '../utils/date';

/* ── Helpers ─────────────────────────────────────────────── */
function HealthBar({ healthy, degraded, down, unknown = 0, total }: {
  healthy: number; degraded: number; down: number; unknown?: number; total: number;
}) {
  if (total === 0) return (
    <div className="h-1.5 w-full rounded-full bg-slate-100" />
  );
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100" title={`Healthy: ${healthy}, Degraded: ${degraded}, Down: ${down}, Unknown: ${unknown}`}>
      {healthy > 0 && (
        <div
          className="h-full transition-all duration-700 bg-emerald-500"
          style={{ width: `${(healthy / total) * 100}%` }}
        />
      )}
      {degraded > 0 && (
        <div
          className="h-full bg-amber-500"
          style={{ width: `${(degraded / total) * 100}%` }}
        />
      )}
      {down > 0 && (
        <div
          className="h-full bg-rose-500"
          style={{ width: `${(down / total) * 100}%` }}
        />
      )}
      {unknown > 0 && (
        <div
          className="h-full bg-slate-300"
          style={{ width: `${(unknown / total) * 100}%` }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Project['status'] }) {
  const cfg = {
    HEALTHY:  { label: 'Healthy',  color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    DEGRADED: { label: 'Degraded', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    DOWN:     { label: 'Down',     color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    UNKNOWN:  { label: 'Unknown',  color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' },
  };
  const c = cfg[status] ?? cfg.UNKNOWN;
  return (
    <span
      className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md"
      style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}` }}
    >
      {c.label}
    </span>
  );
}

/* ── Project Card ────────────────────────────────────────── */
function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const score = project.health_score ?? 0;
  const unknownCount = project.unknown_count ?? Math.max(0, project.endpoint_count - (project.healthy_count + project.degraded_count + project.down_count));

  return (
    <div
      onClick={onClick}
      className="clay-card cursor-pointer group flex flex-col p-5 bg-white border border-slate-200 rounded-2xl shadow-xs hover:border-blue-400 hover:shadow-md transition-all"
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-105 bg-blue-50 text-blue-600 border border-blue-100"
          >
            <Globe size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm truncate text-slate-900 mb-0.5" title={project.name}>
              {project.name}
            </h3>
            {/* Exact target URL preserved and displayed */}
            <p className="text-[11px] truncate text-slate-500 font-mono" title={project.url}>
              {project.url}
            </p>
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {/* Health bar with all supported health states */}
      <div className="my-3">
        <HealthBar
          healthy={project.healthy_count}
          degraded={project.degraded_count}
          down={project.down_count}
          unknown={unknownCount}
          total={project.endpoint_count}
        />
      </div>

      {/* Stats row with project-specific counts: Endpoints, Healthy, Degraded, Down, Unknown */}
      <div className="grid grid-cols-4 gap-1.5 mt-auto">
        <div className="rounded-xl py-2 px-1 text-center bg-slate-50 border border-slate-100">
          <div className="text-[10px] font-medium text-slate-500 mb-0.5">Total</div>
          <div className="text-base font-bold text-slate-900">{project.endpoint_count}</div>
        </div>
        <div className="rounded-xl py-2 px-1 text-center bg-emerald-50/60 border border-emerald-100/60">
          <div className="text-[10px] font-medium text-emerald-700 mb-0.5">Healthy</div>
          <div className="text-base font-bold text-emerald-600">{project.healthy_count}</div>
        </div>
        <div className="rounded-xl py-2 px-1 text-center bg-amber-50/60 border border-amber-100/60">
          <div className="text-[10px] font-medium text-amber-700 mb-0.5">Degraded</div>
          <div className="text-base font-bold text-amber-600">{project.degraded_count}</div>
        </div>
        <div className="rounded-xl py-2 px-1 text-center bg-rose-50/60 border border-rose-100/60">
          <div className="text-[10px] font-medium text-rose-700 mb-0.5">Down</div>
          <div className="text-base font-bold text-rose-600">{project.down_count}</div>
        </div>
      </div>

      {/* Score bar */}
      {project.endpoint_count > 0 ? (
        <div className="mt-3 flex items-center gap-2">
          <TrendingUp size={11} className="text-slate-400" />
          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${score}%`,
                background: score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'
              }}
            />
          </div>
          <span className="text-[10px] font-semibold text-slate-500">{score.toFixed(0)}%</span>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400 font-medium">
          <span>No endpoints registered</span>
          <span className="text-blue-600 font-semibold group-hover:underline">Discover →</span>
        </div>
      )}

      {/* Hover arrow */}
      <div className="flex items-center gap-1 mt-2 text-[11px] font-medium text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
        View project details <ExternalLink size={11} />
      </div>
    </div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────── */
export const Dashboard = () => {
  const [urlInput, setUrlInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlTouched, setUrlTouched] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState('ALL');

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: projects,
    isLoading: projectsLoading,
    error: projectsError,
    refetch: refetchProjects
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/projects'),
    refetchInterval: 10000,
  });

  const { data: stats } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => apiFetch<OverviewStats>('/analytics/overview'),
    refetchInterval: 10000,
  });

  const { data: systemHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiFetch<{ components: any[] }>('/detailed', {}, true),
    refetchInterval: 10000,
  });

  const { data: recentIncidents, isLoading: incidentsLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => apiFetch<any[]>('/incidents?limit=5'),
    refetchInterval: 10000,
  });

  const filteredProjects = (projects || []).filter(p => {
    const matchesSearch = !projectSearch ||
      p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
      p.url.toLowerCase().includes(projectSearch.toLowerCase());
    const matchesStatus = projectStatusFilter === 'ALL' || p.status === projectStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeProjectsCount = stats?.total_projects ?? projects?.length ?? 0;
  const totalEndpoints = stats?.total_endpoints ?? 0;
  const downEndpoints = stats?.down_endpoints ?? 0;
  const avgHealth = stats?.success_rate_24h !== null && stats?.success_rate_24h !== undefined ? stats.success_rate_24h * 100 : null;

  /* Minimal client-side URL check */
  const isValidUrl = (() => {
    if (!urlInput) return null;
    try { new URL(urlInput); return true; } catch { return false; }
  })();

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const projectName = new URL(urlInput).hostname;
      const project = await apiFetch<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: projectName, url: urlInput }),
      });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setUrlInput('');
      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to start discovery. Ensure the URL is valid and accessible.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto pb-12 animate-fade-in">

      {/* ── Hero ── */}
      <div className="text-center pt-4">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-5"
          style={{
            background: 'var(--primary-transparent)',
            border: '1px solid rgba(99,102,241,0.25)',
            color: 'var(--primary-light)',
          }}
        >
          <Zap size={12} />
          Automated Discovery · Self-Healing · Real-time Monitoring
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3 leading-tight text-[var(--text-primary)]">
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, var(--primary), var(--purple))' }}
          >
            Intelligent API
          </span>
          <br />
          <span>Observability Platform</span>
        </h1>

        <p className="text-base max-w-xl mx-auto mb-8 text-[var(--text-secondary)]">
          Enter <strong className="text-[var(--text-primary)]">your API or Web App URL</strong>. The engine will crawl, discover
          endpoints, detect OpenAPI specs, and set up self-healing active monitoring.
        </p>

        {/* URL Input */}
        <form onSubmit={handleDiscover} className="max-w-2xl mx-auto">
          <div className="url-input-wrapper">
            <div
              className="flex items-center rounded-2xl p-1.5 gap-2 transition-all duration-300 clay-card"
              style={{
                border: `1px solid ${
                  urlTouched && isValidUrl === false
                    ? 'rgba(239,68,68,0.6)'
                    : isValidUrl === true
                    ? 'rgba(99,102,241,0.5)'
                    : 'var(--border-bright)'
                }`,
                boxShadow: isValidUrl === true
                  ? '0 0 0 4px rgba(99,102,241,0.08), 8px 8px 16px rgba(0,0,0,0.04), -8px -8px 16px rgba(255,255,255,0.8)'
                  : undefined,
              }}
            >
              <div className="flex items-center gap-2 pl-3 flex-shrink-0">
                {isSubmitting ? (
                  <div
                    className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: 'var(--primary)' }}
                  />
                ) : (
                  <Globe size={18} style={{ color: isValidUrl === true ? 'var(--primary-light)' : 'var(--muted)' }} />
                )}
                {isValidUrl === true && (
                  <Lock size={12} style={{ color: 'var(--success)' }} />
                )}
              </div>

              <input
                id="url-discovery-input"
                type="url"
                required
                placeholder="https://api.yourapp.com"
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setError(null); }}
                onBlur={() => setUrlTouched(true)}
                disabled={isSubmitting}
                className="flex-1 bg-transparent border-none outline-none py-3.5 text-sm font-medium placeholder-[var(--muted)] disabled:opacity-50"
                style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}
              />

              <button
                type="submit"
                disabled={isSubmitting || !urlInput || isValidUrl === false}
                className="btn-primary px-6 py-3 text-sm flex items-center gap-2 flex-shrink-0 rounded-xl"
              >
                {isSubmitting ? (
                  <>
                    <span
                      className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: 'white' }}
                    />
                    Discovering…
                  </>
                ) : (
                  <>
                    Start Monitoring
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Hint */}
          <div className="flex items-center justify-center gap-2 mt-3 text-xs" style={{ color: 'var(--muted)' }}>
            <Lock size={11} style={{ color: 'var(--success)' }} />
            Only your own APIs. SSRF & domain-allowlist protected.
            <CheckCircle2 size={11} style={{ color: 'var(--success)' }} />
          </div>

          {/* Error */}
          {error && (
            <div
              className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm animate-fade-in"
              style={{
                background: 'var(--error-transparent)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#fca5a5',
              }}
            >
              <AlertTriangle size={16} style={{ color: 'var(--error)' }} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </form>
      </div>

      {/* ── KPI Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            icon: <Layers size={22} />,
            label: 'Projects',
            value: activeProjectsCount,
            color: 'var(--primary)',
            bg: 'var(--primary-transparent)',
          },
          {
            icon: <Server size={22} />,
            label: 'Endpoints',
            value: totalEndpoints,
            color: 'var(--cyan)',
            bg: 'var(--cyan-transparent)',
          },
          {
            icon: <ShieldAlert size={22} />,
            label: 'Failing',
            value: downEndpoints,
            color: downEndpoints > 0 ? 'var(--error)' : 'var(--success)',
            bg: downEndpoints > 0 ? 'var(--error-transparent)' : 'var(--success-transparent)',
          },
          {
            icon: <TrendingUp size={22} />,
            label: 'Avg Health',
            value: avgHealth !== null ? `${avgHealth.toFixed(1)}%` : '—',
            color: avgHealth !== null && avgHealth >= 80
              ? 'var(--success)'
              : avgHealth !== null && avgHealth >= 50
              ? 'var(--warning)'
              : 'var(--muted)',
            bg: 'rgba(0,0,0,0.03)',
          },
        ].map(({ icon, label, value, color, bg }) => (
          <div
            key={label}
            className="clay-card p-5 flex items-center gap-4"
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: bg, color }}
            >
              {icon}
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-widest mb-0.5" style={{ color: 'var(--muted)' }}>
                {label}
              </div>
              <div className="text-2xl font-bold stat-counter" style={{ color }}>
                {value}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4">
        {/* ── System Components ── */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <Server size={18} style={{ color: 'var(--primary-light)' }} />
            <h2 className="text-xl font-bold">System Health</h2>
          </div>
          <Card className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            {systemHealth?.components ? (
              systemHealth.components.map((comp: any) => (
                <div
                  key={comp.name}
                  className="rounded-xl p-3 text-center border transition-all glass-panel"
                  style={{
                    borderColor: comp.status === 'HEALTHY' ? 'rgba(16,185,129,0.3)' 
                      : comp.status === 'NOT_CONFIGURED' ? 'rgba(100,116,139,0.3)'
                      : 'rgba(239,68,68,0.3)',
                  }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>
                    {comp.name}
                  </div>
                  <div
                    className="text-sm font-semibold"
                    style={{
                      color: comp.status === 'HEALTHY' ? 'var(--success)' 
                      : comp.status === 'NOT_CONFIGURED' ? 'var(--muted)'
                      : 'var(--error)'
                    }}
                  >
                    {comp.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : comp.status}
                  </div>
                  <div className="text-[11px] font-medium mt-1 truncate" style={{ color: 'var(--text-secondary)' }} title={comp.detail}>
                    {comp.detail}
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-8 text-center text-[var(--muted)] flex items-center justify-center gap-2">
                <RefreshCw size={16} className="animate-spin" /> Fetching system health...
              </div>
            )}
          </Card>
        </div>

        {/* ── Activity Feed ── */}
        <div className="lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity size={18} style={{ color: 'var(--primary-light)' }} />
              <h2 className="text-xl font-bold">Recent Activity</h2>
            </div>
            <button onClick={() => navigate('/incidents')} className="text-xs text-[var(--primary-light)] hover:underline">
              View all
            </button>
          </div>
          <Card className="p-0 overflow-hidden flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 max-h-[300px]">
              {incidentsLoading ? (
                <div className="text-center py-10 text-[var(--muted)]">Loading activity...</div>
              ) : recentIncidents && recentIncidents.length > 0 ? (
                recentIncidents.map((incident: any) => (
                  <div key={incident.id} className="p-3 rounded-lg border border-[var(--border-color)] bg-[rgba(255,255,255,0.02)] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => navigate(`/endpoints/${incident.endpoint_id}`)}>
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <AlertOctagon size={14} className={incident.severity === 'CRITICAL' ? 'text-[var(--error)]' : 'text-[var(--warning)]'} />
                        <span className="font-semibold text-xs truncate max-w-[150px]">{incident.title}</span>
                      </div>
                      <Badge variant={incident.status === 'RESOLVED' ? 'success' : 'error'}>{incident.status}</Badge>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {formatDate(incident.created_at)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 flex flex-col items-center">
                  <CheckCircle2 size={32} className="text-[var(--success)] opacity-50 mb-3" />
                  <p className="text-sm text-[var(--text-secondary)]">No recent incidents. Everything is running smoothly.</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Active Projects List ── */}
      <div className="mt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Layers size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">Active Projects</h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {projects?.length ?? 0}
                </span>
              </div>
              <p className="text-xs text-slate-500">Monitored targets and discovered endpoint health</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search projects..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-40 sm:w-48"
              />
            </div>

            {/* Status Filter */}
            <div className="relative">
              <select
                value={projectStatusFilter}
                onChange={e => setProjectStatusFilter(e.target.value)}
                className="text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-xl px-2.5 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="ALL">All Status</option>
                <option value="HEALTHY">Healthy</option>
                <option value="DEGRADED">Degraded</option>
                <option value="DOWN">Down</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>

            <button
              onClick={() => navigate('/projects/new')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        {/* Error state */}
        {projectsError && (
          <div className="p-5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-800 mb-4">
            <div className="flex items-center gap-3">
              <AlertOctagon size={20} className="text-rose-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-bold">Failed to load active projects</div>
                <div className="text-xs text-rose-600">{(projectsError as any)?.message || 'Database or network communication error.'}</div>
              </div>
            </div>
            <button
              onClick={() => refetchProjects()}
              className="px-3 py-1.5 bg-white border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {projectsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="rounded-2xl h-48 bg-white border border-slate-200 p-5 animate-pulse"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-100 rounded w-2/3" />
                    <div className="h-3 bg-slate-100 rounded w-1/2" />
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full my-4" />
                <div className="grid grid-cols-4 gap-2">
                  <div className="h-10 bg-slate-100 rounded-lg" />
                  <div className="h-10 bg-slate-100 rounded-lg" />
                  <div className="h-10 bg-slate-100 rounded-lg" />
                  <div className="h-10 bg-slate-100 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProjects.map((project, idx) => (
              <div
                key={project.id}
                className="animate-slide-up"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <ProjectCard
                  project={project}
                  onClick={() => navigate(`/projects/${project.id}`)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-3 text-blue-600">
              <Globe size={26} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {projectSearch || projectStatusFilter !== 'ALL' ? 'No matching projects found' : 'No monitored projects yet'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              {projectSearch || projectStatusFilter !== 'ALL'
                ? 'Try adjusting your search criteria or clearing your filters.'
                : 'Enter your API or Web App URL in the command bar above to start automated continuous discovery.'}
            </p>
            {projectSearch || projectStatusFilter !== 'ALL' ? (
              <button
                onClick={() => { setProjectSearch(''); setProjectStatusFilter('ALL'); }}
                className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors text-slate-700"
              >
                Clear Filters
              </button>
            ) : (
              <button
                onClick={() => navigate('/projects/new')}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors"
              >
                Add Your First Project
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
