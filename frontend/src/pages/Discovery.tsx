import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Search, CheckCircle2, XCircle, Globe, GitBranch,
  Clock, FileCode2, RefreshCw, Code2, Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatRelative, formatDate } from '../utils/date';
import type { Project, DiscoveryRun } from '../types';

/* ── Status badge ─────────────────────────────────────────── */
function RunStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    COMPLETED: { label: 'Completed', color: 'var(--success)', icon: <CheckCircle2 size={13} /> },
    RUNNING:   { label: 'Running',   color: 'var(--primary-light)', icon: <RefreshCw size={13} className="animate-spin" /> },
    PENDING:   { label: 'Pending',   color: 'var(--warning)', icon: <Clock size={13} /> },
    FAILED:    { label: 'Failed',    color: 'var(--error)', icon: <XCircle size={13} /> },
  };
  const c = cfg[status] ?? cfg.PENDING;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: c.color }}>
      {c.icon} {c.label}
    </span>
  );
}

/* ── Discovery run card ───────────────────────────────────── */
function DiscoveryRunCard({ run, project }: { run: DiscoveryRun; project: Project }) {
  const navigate = useNavigate();
  const providers = [
    { name: 'OpenAPI', checked: run.openapi_checked, icon: <FileCode2 size={12} /> },
    { name: 'Crawler', checked: run.crawl_checked,   icon: <Search size={12} /> },
    { name: 'JS Anal.', checked: run.js_checked,     icon: <Code2 size={12} /> },
    { name: 'GitHub',   checked: (run as any).github_checked, icon: <GitBranch size={12} /> },
  ].filter(p => p.checked);

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-xl border border-[var(--border-color)] bg-[rgba(255,255,255,0.02)] hover:border-[var(--primary-glow)] cursor-pointer transition-all"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {project.url.includes('github.com') ? (
              <GitBranch size={14} style={{ color: 'var(--muted)' }} />
            ) : (
              <Globe size={14} style={{ color: 'var(--muted)' }} />
            )}
            <span className="font-medium text-sm text-[var(--text-primary)]">{project.name}</span>
          </div>
          <span className="text-xs text-[var(--muted)]">{project.url}</span>
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-[var(--muted)] mb-0.5">Candidates</div>
          <div className="font-semibold text-[var(--text-primary)]">{run.candidates_total}</div>
        </div>
        <div>
          <div className="text-[var(--muted)] mb-0.5">Verified</div>
          <div className="font-semibold" style={{ color: 'var(--success)' }}>{run.candidates_verified}</div>
        </div>
        <div>
          <div className="text-[var(--muted)] mb-0.5">Unavailable</div>
          <div className="font-semibold" style={{ color: 'var(--warning)' }}>{run.candidates_unavailable}</div>
        </div>
      </div>

      {providers.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {providers.map(p => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md"
              style={{
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.25)',
                color: 'var(--primary-light)',
              }}
            >
              {p.icon} {p.name}
            </span>
          ))}
        </div>
      )}

      <div className="text-[10px] text-[var(--muted)]">
        {run.started_at ? (
          <span title={formatDate(run.started_at)}>Started {formatRelative(run.started_at)}</span>
        ) : (
          <span>Not started yet</span>
        )}
        {run.completed_at && (
          <span className="ml-2" title={formatDate(run.completed_at)}>
            · Finished {formatRelative(run.completed_at)}
          </span>
        )}
      </div>

      {run.error_message && (
        <div className="text-[11px] text-[var(--error)] bg-[rgba(239,68,68,0.08)] rounded-lg px-3 py-2 border border-[rgba(239,68,68,0.2)]">
          {run.error_message}
        </div>
      )}
    </div>
  );
}

/* ── Main Discovery Page ─────────────────────────────────── */
export const Discovery = () => {
  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects-list'],
    queryFn: () => apiFetch<Project[]>('/projects'),
    refetchInterval: 10_000,
  });

  // Fetch latest discovery run per project
  const { data: runsMap = {}, isLoading: runsLoading } = useQuery<Record<string, DiscoveryRun[]>>({
    queryKey: ['all-discovery-runs'],
    queryFn: async () => {
      const map: Record<string, DiscoveryRun[]> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            const runs = await apiFetch<DiscoveryRun[]>(`/projects/${p.id}/discovery?limit=5`);
            map[p.id] = runs;
          } catch {
            map[p.id] = [];
          }
        })
      );
      return map;
    },
    enabled: projects.length > 0,
    refetchInterval: 8_000,
  });

  const isLoading = projectsLoading || runsLoading;

  // Flatten to (project, run) pairs sorted by run date
  type RunEntry = { project: Project; run: DiscoveryRun };
  const allRuns: RunEntry[] = [];
  for (const project of projects) {
    const runs = runsMap[project.id] ?? [];
    for (const run of runs) {
      allRuns.push({ project, run });
    }
  }
  allRuns.sort((a, b) => {
    const ta = a.run.started_at ? new Date(a.run.started_at).getTime() : 0;
    const tb = b.run.started_at ? new Date(b.run.started_at).getTime() : 0;
    return tb - ta;
  });

  const activeRuns = allRuns.filter(e => e.run.status === 'RUNNING' || e.run.status === 'PENDING');
  const completedRuns = allRuns.filter(e => e.run.status === 'COMPLETED' || e.run.status === 'FAILED');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Discovery Runs</h2>
          <p className="text-[var(--text-secondary)] text-sm">
            History of all endpoint discovery executions across projects.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Zap size={14} style={{ color: 'var(--primary-light)' }} />
          {projects.length} project{projects.length !== 1 ? 's' : ''} monitored
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 rounded-xl bg-[rgba(255,255,255,0.03)] animate-pulse" />
          ))}
        </div>
      ) : allRuns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.1)' }}>
            <Search size={28} style={{ color: 'var(--primary-light)' }} />
          </div>
          <div>
            <p className="font-medium text-[var(--text-primary)]">No discovery runs yet</p>
            <p className="text-sm text-[var(--muted)] mt-1">
              Create a project and start discovery to see runs here.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {activeRuns.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--primary-light)] mb-3 flex items-center gap-2">
                <RefreshCw size={13} className="animate-spin" /> Active ({activeRuns.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeRuns.map(({ project, run }) => (
                  <DiscoveryRunCard key={run.id} run={run} project={project} />
                ))}
              </div>
            </div>
          )}

          {completedRuns.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)] mb-3">
                History ({completedRuns.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {completedRuns.map(({ project, run }) => (
                  <DiscoveryRunCard key={run.id} run={run} project={project} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
