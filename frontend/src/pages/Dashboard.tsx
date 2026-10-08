import { useState } from 'react';
import {
  Activity, ShieldAlert, Server, ArrowRight, Globe, Layers,
  AlertTriangle, Lock, CheckCircle2, ExternalLink, TrendingUp,
  Zap, Clock, AlertOctagon, RefreshCw
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, OverviewStats } from '../types';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { formatDate } from '../utils/date';

/* ── Helpers ─────────────────────────────────────────────── */
function HealthBar({ healthy, degraded, down, total }: {
  healthy: number; degraded: number; down: number; total: number;
}) {
  if (total === 0) return (
    <div className="h-1.5 w-full rounded-full" style={{ background: 'rgba(0,0,0,0.06)' }} />
  );
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden flex" style={{ background: 'rgba(0,0,0,0.06)' }}>
      {healthy > 0 && (
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${(healthy / total) * 100}%`, background: 'var(--success)', boxShadow: '0 0 6px var(--success-glow)' }}
        />
      )}
      {degraded > 0 && (
        <div
          className="h-full"
          style={{ width: `${(degraded / total) * 100}%`, background: 'var(--warning)' }}
        />
      )}
      {down > 0 && (
        <div
          className="h-full"
          style={{ width: `${(down / total) * 100}%`, background: 'var(--error)' }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Project['status'] }) {
  const cfg = {
    HEALTHY:  { label: 'Healthy',  color: 'var(--success)',  bg: 'var(--success-transparent)',  border: 'rgba(16,185,129,0.3)' },
    DEGRADED: { label: 'Degraded', color: 'var(--warning)',  bg: 'var(--warning-transparent)',  border: 'rgba(245,158,11,0.3)' },
    DOWN:     { label: 'Down',     color: 'var(--error)',    bg: 'var(--error-transparent)',    border: 'rgba(239,68,68,0.3)' },
    UNKNOWN:  { label: 'Unknown',  color: 'var(--muted)',    bg: 'rgba(100,100,130,0.12)',      border: 'rgba(100,100,130,0.3)' },
  };
  const c = cfg[status] ?? cfg.UNKNOWN;
  return (
    <span
      className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-md"
      style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}` }}
    >
      {c.label}
    </span>
  );
}

/* ── Project Card ────────────────────────────────────────── */
function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const score = project.health_score ?? 0;

  return (
    <div
      onClick={onClick}
      className="clay-card cursor-pointer group flex flex-col p-5"
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(99,102,241,0.4)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.4)';
      }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-105"
            style={{ background: 'var(--primary-transparent)', border: '1px solid rgba(99,102,241,0.2)' }}
          >
            <Globe size={18} style={{ color: 'var(--primary-light)' }} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate text-[var(--text-primary)] mb-0.5" title={project.name}>
              {project.name}
            </h3>
            <p className="text-[11px] truncate" style={{ color: 'var(--muted)' }} title={project.url}>
              {project.url.replace(/^https?:\/\//, '')}
            </p>
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {/* Health bar */}
      <div className="my-3">
        <HealthBar
          healthy={project.healthy_count}
          degraded={project.degraded_count}
          down={project.down_count}
          total={project.endpoint_count}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mt-auto">
        {[
          { label: 'Endpoints', value: project.endpoint_count, color: 'var(--text-primary)' },
          { label: 'Healthy', value: project.healthy_count, color: 'var(--success)' },
          { label: 'Down', value: project.down_count, color: project.down_count > 0 ? 'var(--error)' : 'var(--muted)' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-xl py-2 px-3 text-center"
            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)' }}
          >
            <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--muted)' }}>{label}</div>
            <div className="text-lg font-bold stat-counter" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Score bar */}
      {project.endpoint_count > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <TrendingUp size={11} style={{ color: 'var(--muted)' }} />
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${score}%`,
                background: score >= 80
                  ? 'linear-gradient(90deg, var(--success), #34d399)'
                  : score >= 50
                  ? 'linear-gradient(90deg, var(--warning), #fbbf24)'
                  : 'linear-gradient(90deg, var(--error), #f87171)',
                transition: 'width 0.8s ease',
              }}
            />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{score.toFixed(0)}%</span>
        </div>
      )}

      {/* Hover arrow */}
      <div
        className="flex items-center gap-1 mt-3 text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--primary-light)' }}
      >
        View project <ExternalLink size={11} />
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

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: projects, isLoading: projectsLoading } = useQuery({
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

      {/* ── Projects List ── */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Layers size={18} style={{ color: 'var(--primary-light)' }} />
            <h2 className="text-xl font-bold">Active Projects</h2>
          </div>
          {activeProjectsCount > 0 && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <Clock size={12} />
              Refreshes every 10s
            </div>
          )}
        </div>

        {projectsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="rounded-2xl h-48 shimmer"
                style={{ border: '1px solid var(--border-color)' }}
              />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((project, idx) => (
              <div
                key={project.id}
                className="animate-slide-up"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <ProjectCard
                  project={project}
                  onClick={() => navigate(`/projects/${project.id}`)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div
            className="text-center py-20 rounded-2xl"
            style={{
              background: 'var(--bg-card)',
              border: '1px dashed rgba(99,102,241,0.2)',
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
              style={{ background: 'var(--primary-transparent)', border: '1px solid rgba(99,102,241,0.2)' }}
            >
              <Globe size={28} style={{ color: 'var(--primary-light)' }} />
            </div>
            <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
            <p className="text-sm max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
              Enter your API URL above to start discovering and monitoring your first project.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
