import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, RefreshCw, Activity, CheckCircle2, XCircle, Search,
  FileCode2, Clock, Code2, ArrowLeft, Zap, Shield, ShieldCheck, AlertCircle, Play,
  GitBranch, Server, Info, Settings, Trash2, Lock, ExternalLink
} from '../components/icons';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun, DiscoveryCandidate, Endpoint } from '../types';
import { Pagination } from '../components/Pagination';
import { formatTime } from '../utils/date';

/* ── Method badge ────────────────────────────────────────── */
function MethodBadge({ method }: { method: string }) {
  const cls = {
    GET: 'method-get', POST: 'method-post', PUT: 'method-put',
    PATCH: 'method-patch', DELETE: 'method-delete',
  }[method.toUpperCase()] ?? 'method-other';
  return <span className={`method-badge ${cls}`}>{method}</span>;
}

/* ── Source chip ─────────────────────────────────────────── */
function SourceChip({ source }: { source: string }) {
  const cfg: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    OPENAPI:    { cls: 'source-openapi',    icon: <FileCode2 size={11} />, label: 'OpenAPI' },
    CRAWLER:    { cls: 'source-crawler',    icon: <Search size={11} />,    label: 'Crawler' },
    JAVASCRIPT: { cls: 'source-javascript', icon: <Code2 size={11} />,     label: 'JavaScript' },
    MANUAL:     { cls: 'source-manual',     icon: <Server size={11} />,    label: 'Manual' },
  };
  const c = cfg[source] ?? cfg.MANUAL;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${c.cls}`}>
      {c.icon} {c.label}
    </span>
  );
}

/* ── Confidence chip ─────────────────────────────────────── */
function ConfidenceChip({ confidence }: { confidence: string }) {
  const styles = {
    HIGH:   { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' },
    MEDIUM: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
    LOW:    { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  };
  const s = styles[confidence as keyof typeof styles] ?? styles.LOW;
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {confidence}
    </span>
  );
}

/* ── Verification status ─────────────────────────────────── */
function VerifyChip({ status, httpStatus }: { status: string; httpStatus: number | null }) {
  if (status === 'VERIFIED') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--success)' }}>
      <CheckCircle2 size={13} />
      {httpStatus ? `${httpStatus} OK` : 'Verified'}
    </span>
  );
  if (status === 'PENDING') return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--primary-light)' }}>
      <RefreshCw size={13} className="animate-spin" /> Checking…
    </span>
  );
  if (status === 'WEB_PAGE') return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#a78bfa' }}>
      <Globe size={13} /> Web Page
    </span>
  );
  if (status === 'AUTH_REQUIRED') return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#f59e0b' }}>
      <Lock size={13} />
      {httpStatus ? `${httpStatus} Auth` : 'Auth Required'}
    </span>
  );
  if (status === 'NOT_VERIFIED') return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
      <Info size={13} /> Not Verified
    </span>
  );
  if (status === 'UNAVAILABLE') return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--warning)' }}>
      <XCircle size={13} />
      {httpStatus ? `${httpStatus}` : 'Unavailable'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
      <XCircle size={13} /> {status}
    </span>
  );
}

/* ── Discovery step tracker ──────────────────────────────── */
type StepStatus = 'pending' | 'active' | 'completed' | 'error';

interface Step {
  id: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: StepStatus;
  result?: string;
}

function StepTracker({ run }: { run: DiscoveryRun }) {
  const isRunning = run.status === 'RUNNING' || run.status === 'PENDING';
  const isFailed  = run.status === 'FAILED';
  const progressStep = run.progress_state?.step;
  const progressDetails = run.progress_state?.details;

  const isActive = (targetSteps: string[]) => isRunning && targetSteps.includes(progressStep || '');

  const steps: Step[] = [
    {
      id: 'openapi',
      icon: <FileCode2 size={16} />,
      title: 'OpenAPI Spec Detection',
      desc: isActive(['URL_VALIDATION', 'OPENAPI_DETECTION', 'OPENAPI_AND_CRAWL']) 
        ? (progressDetails?.status ? `Status: ${progressDetails.status}` : 'Probing OpenAPI & Swagger specs...')
        : 'Scanning common spec paths: /openapi.json, /swagger.json, /docs',
      status: run.openapi_checked
        ? 'completed'
        : isActive(['URL_VALIDATION', 'OPENAPI_DETECTION', 'OPENAPI_AND_CRAWL'])
        ? 'active'
        : isFailed
        ? 'error'
        : 'pending',
      result: run.openapi_checked
        ? run.openapi_found
          ? `✓ Found spec at ${run.openapi_url ?? 'detected location'}`
          : '✓ Checked — No OpenAPI spec found (crawling site)'
        : undefined,
    },
    {
      id: 'crawl',
      icon: <Search size={16} />,
      title: 'Website Crawler',
      desc: isActive(['CRAWLING']) && progressDetails
        ? `Pages visited: ${progressDetails.pages_visited ?? 0} | Queue: ${progressDetails.queue_size ?? 0}`
        : 'BFS crawl (depth 3, max 80 pages) — following same-domain links, robots.txt & sitemap seeds',
      status: run.crawl_checked
        ? 'completed'
        : isActive(['CRAWLING'])
        ? 'active'
        : run.crawl_checked && isFailed
        ? 'error'
        : 'pending',
      result: run.crawl_checked
        ? `✓ Crawl complete`
        : undefined,
    },
    {
      id: 'js',
      icon: <Code2 size={16} />,
      title: 'JavaScript Analysis',
      desc: isActive(['JS_ANALYSIS', 'DEDUPLICATION']) && progressDetails
        ? (progressStep === 'JS_ANALYSIS' ? `Analyzing files...` : `Deduplicating candidates: ${progressDetails.total_candidates ?? ''}`)
        : 'Parsing JS bundles for fetch() / axios calls and API route patterns',
      status: run.js_checked
        ? 'completed'
        : isActive(['JS_ANALYSIS', 'DEDUPLICATION'])
        ? 'active'
        : run.js_checked && isFailed
        ? 'error'
        : 'pending',
      result: run.js_checked
        ? '✓ JS analysis complete'
        : undefined,
    },
    {
      id: 'verify',
      icon: <Zap size={16} />,
      title: 'Endpoint Verification',
      desc: isActive(['VERIFICATION']) && progressDetails
        ? `Verifying ${progressDetails.unique_candidates ?? 0} unique candidates`
        : 'Live HTTP probe of each candidate — checking reachability & latency',
      status: run.status === 'COMPLETED'
        ? 'completed'
        : isActive(['VERIFICATION'])
        ? 'active'
        : isFailed
        ? 'error'
        : 'pending',
      result: run.status === 'COMPLETED'
        ? `✓ ${run.candidates_verified} verified · ${run.candidates_unavailable} unavailable · ${run.candidates_blocked} blocked`
        : undefined,
    },
  ];

  return (
    <div className="step-tracker">
      {steps.map((step) => (
        <div key={step.id} className={`step-item ${step.status}`}>
          <div className={`step-icon ${step.status}`}>
            {step.status === 'completed' ? <CheckCircle2 size={16} /> :
             step.status === 'active' ? <RefreshCw size={16} className="animate-spin" /> :
             step.status === 'error' ? <XCircle size={16} /> :
             step.icon}
          </div>
          <div className="step-body">
            <div
              className="step-title"
              style={{
                color: step.status === 'completed'
                  ? 'var(--success)'
                  : step.status === 'active'
                  ? 'var(--primary-light)'
                  : step.status === 'error'
                  ? 'var(--error)'
                  : 'var(--muted)',
              }}
            >
              {step.title}
            </div>
            <div className="step-desc">{step.desc}</div>
            {step.result && (
              <div className="step-result">{step.result}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Stat box ────────────────────────────────────────────── */
function StatBox({
  label, value, color, sub, isDark
}: { label: string; value: number | string; color?: string; sub?: string; isDark?: boolean }) {
  return (
    <div
      className={`rounded-xl p-3.5 sm:p-4 transition-all duration-200 ${
        isDark 
          ? 'bg-white/[0.08] hover:bg-white/[0.12] border border-white/10 shadow-inner' 
          : 'bg-white hover:bg-slate-50 border border-slate-200 shadow-xs'
      }`}
    >
      <div className={`text-[10px] sm:text-[11px] uppercase font-bold tracking-wider mb-1 ${isDark ? 'text-slate-300' : 'text-slate-400'}`}>
        {label}
      </div>
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display" style={{ color: color ?? (isDark ? '#ffffff' : '#0f172a') }}>
        {value}
      </div>
      {sub && <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>{sub}</div>}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */
export const ProjectDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'endpoints' | 'discovery'>('endpoints');
  const [filterSource, setFilterSource] = useState<string>('ALL');
  const [filterMethod, setFilterMethod] = useState<string>('ALL');
  const [filterVerification, setFilterVerification] = useState<string>('ALL');
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [isAccepting, setIsAccepting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [checkInterval, setCheckInterval] = useState<number>(60);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  
  const [candidatePage, setCandidatePage] = useState(1);
  const candidatesPerPage = 20;

  /* ── Queries ── */
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['projects', id],
    queryFn: () => apiFetch<Project>(`/projects/${id}`),
    refetchInterval: 5000,
  });

  const { data: runs } = useQuery({
    queryKey: ['projects', id, 'discovery-runs'],
    queryFn: () => apiFetch<DiscoveryRun[]>(`/projects/${id}/discovery`),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.some((r: DiscoveryRun) => r.status === 'RUNNING' || r.status === 'PENDING')
        ? 2000 : 10000;
    },
  });

  const latestRun = runs?.[0];
  const isDiscovering = latestRun?.status === 'RUNNING' || latestRun?.status === 'PENDING';

  // ✅ FIXED: correct URL is /discovery/{run_id}/candidates
  const { data: candidatesResponse } = useQuery({
    queryKey: ['discovery-candidates', latestRun?.id, candidatePage, filterSource],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('limit', candidatesPerPage.toString());
      qs.set('offset', ((candidatePage - 1) * candidatesPerPage).toString());
      if (filterSource !== 'ALL') qs.set('source', filterSource);
      return apiFetch<{ data: DiscoveryCandidate[]; meta: any }>(
        `/discovery/${latestRun?.id}/candidates?${qs.toString()}`,
        { returnFullResponse: true }
      );
    },
    enabled: !!latestRun?.id,
    refetchInterval: isDiscovering ? 2000 : false,
  });

  const candidates = candidatesResponse?.data;
  const candidatesMeta = candidatesResponse?.meta;

  const { data: endpoints } = useQuery({
    queryKey: ['projects', id, 'endpoints'],
    queryFn: () => apiFetch<Endpoint[]>(`/endpoints?project_id=${id}`),
    refetchInterval: 5000,
  });

  /* ── Handlers ── */
  const handleStartDiscovery = async () => {
    try {
      await apiFetch(`/projects/${id}/discover`, { method: 'POST' });
      setActiveTab('discovery');
      queryClient.invalidateQueries({ queryKey: ['projects', id, 'discovery-runs'] });
    } catch (e: any) {
      console.error('Discovery failed:', e.message);
    }
  };

  const handleToggleMonitoring = async (endpointId: string, enabled: boolean) => {
    try {
      await apiFetch(`/endpoints/${endpointId}/monitoring`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      queryClient.invalidateQueries({ queryKey: ['projects', id, 'endpoints'] });
    } catch (e) { console.error(e); }
  };

  /* ── Filtered & Selectable candidates ── */
  const isCandidateSelectable = (c: DiscoveryCandidate) =>
    !c.accepted && !['WEB_PAGE', 'INVALID', 'BLOCKED'].includes(c.verification_status);

  const filteredCandidates = candidates?.filter(c => {
    const mthOk = filterMethod === 'ALL' || c.method === filterMethod;
    const verOk = filterVerification === 'ALL' || c.verification_status === filterVerification;
    return mthOk && verOk;
  });
  const selectableCandidates = filteredCandidates?.filter(isCandidateSelectable) ?? [];

  const handleAcceptSelected = async () => {
    if (!latestRun?.id || selectedCandidates.size === 0) return;
    setIsAccepting(true);
    setActionFeedback(null);
    try {
      const res = await apiFetch<{ created: number; skipped: number; total: number }>(`/discovery/${latestRun.id}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          candidate_ids: Array.from(selectedCandidates),
          check_interval_seconds: checkInterval,
          failure_threshold: 3,
          latency_threshold_ms: 2000,
          timeout_ms: 5000,
          enabled: true,
        }),
      });
      setSelectedCandidates(new Set());
      queryClient.invalidateQueries({ queryKey: ['discovery-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['projects', id, 'endpoints'] });
      queryClient.invalidateQueries({ queryKey: ['projects', id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });

      const created = res?.created ?? 0;
      const skipped = res?.skipped ?? 0;
      let msg = `Successfully added ${created} endpoint${created !== 1 ? 's' : ''} to monitoring.`;
      if (skipped > 0) {
        msg += ` (${skipped} already monitored or duplicate skipped)`;
      }
      setActionFeedback({ type: 'success', message: msg });
    } catch (e: any) {
      console.error('Failed to accept candidates:', e.message);
      setActionFeedback({ type: 'error', message: e?.message || 'Failed to add endpoints to monitoring.' });
    } finally {
      setIsAccepting(false);
    }
  };

  const toggleCandidateSelection = (candidateId: string) => {
    const newSet = new Set(selectedCandidates);
    if (newSet.has(candidateId)) {
      newSet.delete(candidateId);
    } else {
      newSet.add(candidateId);
    }
    setSelectedCandidates(newSet);
  };

  const toggleAllCandidates = () => {
    if (!selectableCandidates.length) return;
    const allSelected = selectableCandidates.length > 0 && selectableCandidates.every(c => selectedCandidates.has(c.id));
    if (allSelected) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(selectableCandidates.map(c => c.id)));
    }
  };

  const handleEditProject = async () => {
    try {
      await apiFetch(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName, url: editUrl }),
      });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['projects', id] });
    } catch (e) { console.error(e); }
  };

  const handleDeleteProject = async () => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await apiFetch(`/projects/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (e) { console.error(e); }
  };

  /* ── Loading ── */
  if (projectLoading) {
    return (
      <div className="flex flex-col gap-6 max-w-6xl mx-auto animate-pulse">
        <div className="h-40 rounded-2xl shimmer" style={{ border: '1px solid var(--border-color)' }} />
        <div className="h-64 rounded-2xl shimmer" style={{ border: '1px solid var(--border-color)' }} />
      </div>
    );
  }

  if (!project) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <XCircle size={40} style={{ color: 'var(--error)' }} />
      <p style={{ color: 'var(--text-secondary)' }}>Project not found</p>
    </div>
  );

  /* ── Render ── */
  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 w-full">

      {/* ── Back nav ── */}
      <button
        onClick={() => navigate('/projects')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors w-fit -mb-2"
      >
        <ArrowLeft size={15} /> Back to Projects
      </button>

      {/* ── Project header ── */}
      <div
        className="rounded-2xl p-6 sm:p-7 relative overflow-hidden text-white"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f1d40 100%)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          boxShadow: '0 12px 36px -10px rgba(15, 23, 42, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
        }}
      >
        {/* Glow & ambient circles */}
        <div
          className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-20 pointer-events-none blur-3xl"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
        />
        <Globe
          size={140}
          className="absolute -bottom-8 -right-8 opacity-5 text-blue-400 pointer-events-none animate-float"
        />

        <div className="relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div className="min-w-0 max-w-full sm:max-w-xl">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold font-display text-white tracking-tight break-all">
                  {project.name}
                </h1>
                <span
                  className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1.5"
                  style={{
                    color: project.status === 'HEALTHY' ? '#34d399' : project.status === 'DEGRADED' ? '#fbbf24' : project.status === 'DOWN' ? '#f87171' : '#94a3b8',
                    background: project.status === 'HEALTHY' ? 'rgba(52, 211, 153, 0.15)' : project.status === 'DEGRADED' ? 'rgba(251, 191, 36, 0.15)' : project.status === 'DOWN' ? 'rgba(248, 113, 113, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                    border: `1px solid ${project.status === 'HEALTHY' ? 'rgba(52, 211, 153, 0.3)' : project.status === 'DEGRADED' ? 'rgba(251, 191, 36, 0.3)' : project.status === 'DOWN' ? 'rgba(248, 113, 113, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: project.status === 'HEALTHY' ? '#34d399' : project.status === 'DEGRADED' ? '#fbbf24' : project.status === 'DOWN' ? '#f87171' : '#94a3b8'
                    }}
                  />
                  {project.status || 'UNKNOWN'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-slate-300 text-xs sm:text-sm">
                <Globe size={14} className="text-blue-400 flex-shrink-0" />
                <a
                  href={project.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-slate-300 hover:text-white underline underline-offset-4 decoration-slate-600 hover:decoration-blue-400 transition-colors truncate max-w-[280px] sm:max-w-md inline-flex items-center gap-1"
                  title={project.url}
                >
                  <span>{project.url}</span>
                  <ExternalLink size={12} className="opacity-70 flex-shrink-0" />
                </a>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => {
                  setEditName(project.name);
                  setEditUrl(project.url);
                  setIsEditing(true);
                }}
                className="p-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition-all"
                title="Edit Project"
              >
                <Settings size={16} />
              </button>
              <button
                onClick={handleDeleteProject}
                className="p-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/20 transition-all"
                title="Delete Project"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={handleStartDiscovery}
                disabled={isDiscovering}
                className="btn-primary px-4 py-2.5 text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-lg"
              >
                {isDiscovering ? (
                  <>
                    <RefreshCw size={14} className="animate-spin text-white" />
                    <span>Discovering…</span>
                  </>
                ) : (
                  <>
                    <Play size={14} className="text-white" />
                    <span>Run Discovery</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Monitored" value={project.endpoint_count} isDark />
            <StatBox label="Healthy"   value={project.healthy_count}  color="#34d399" isDark />
            <StatBox label="Degraded"  value={project.degraded_count} color="#fbbf24" isDark />
            <StatBox label="Down"      value={project.down_count}     color={project.down_count > 0 ? '#f87171' : '#94a3b8'} isDark />
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-slate-900 font-display">Edit Project</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Project Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Project URL</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono outline-none focus:border-blue-600 focus:bg-white transition-colors"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditProject}
                className="btn-primary px-5 py-2 text-sm rounded-xl font-semibold"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab bar (Segmented Control) ── */}
      <div className="tab-bar">
        <button
          onClick={() => setActiveTab('endpoints')}
          className={`tab-item ${activeTab === 'endpoints' ? 'active' : ''}`}
        >
          <Activity size={15} />
          <span>Monitored Endpoints</span>
          {endpoints && endpoints.length > 0 && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeTab === 'endpoints' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {endpoints.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('discovery')}
          className={`tab-item ${activeTab === 'discovery' ? 'active' : ''}`}
        >
          <Search size={15} />
          <span>Discovery Engine</span>
          {isDiscovering && (
            <span className="flex h-2 w-2 relative ml-0.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
            </span>
          )}
          {candidates && candidates.length > 0 && !isDiscovering && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeTab === 'discovery' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {candidates.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Endpoints tab ── */}
      {activeTab === 'endpoints' && (
        <div className="flex flex-col gap-4 animate-fade-in">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Shield size={16} className="text-blue-600" />
              Active Monitoring
            </h3>
            <span className="text-xs text-slate-400 font-medium">
              {endpoints?.length ?? 0} endpoint{endpoints?.length !== 1 ? 's' : ''} tracked
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {endpoints?.length === 0 ? (
              <div className="py-16 text-center">
                <Server size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="font-semibold text-slate-700 mb-1">No endpoints monitored yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
                  Run Discovery to find endpoints automatically, then accept them into your monitoring pipeline.
                </p>
                <button
                  onClick={handleStartDiscovery}
                  disabled={isDiscovering}
                  className="btn-primary px-4 py-2 text-xs font-semibold"
                >
                  <Play size={14} /> Run Discovery
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Method & Path', 'Health', 'Source', 'Last Checked', 'Monitoring'].map(h => (
                        <th key={h} className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {endpoints?.map(ep => (
                      <tr 
                        key={ep.id} 
                        className="data-row cursor-pointer"
                        onClick={(e) => {
                          if (!(e.target as HTMLElement).closest('button')) {
                            navigate(`/endpoints/${ep.id}`);
                          }
                        }}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <MethodBadge method={ep.method} />
                            <span
                              className="font-mono text-xs font-semibold text-slate-800 max-w-[240px] truncate"
                              title={ep.path || ep.url}
                            >
                              {ep.path || ep.url}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
                            style={{
                              color: ep.health_state === 'HEALTHY' ? 'var(--success)'
                                : ep.health_state === 'DEGRADED' ? 'var(--warning)'
                                : ep.health_state === 'DOWN' ? 'var(--error)'
                                : 'var(--muted)',
                              background: ep.health_state === 'HEALTHY' ? 'var(--success-transparent)'
                                : ep.health_state === 'DEGRADED' ? 'var(--warning-transparent)'
                                : ep.health_state === 'DOWN' ? 'var(--error-transparent)'
                                : 'rgba(100,100,130,0.12)',
                              border: `1px solid ${
                                ep.health_state === 'HEALTHY' ? 'rgba(16,185,129,0.3)'
                                : ep.health_state === 'DEGRADED' ? 'rgba(245,158,11,0.3)'
                                : ep.health_state === 'DOWN' ? 'rgba(239,68,68,0.3)'
                                : 'rgba(100,100,130,0.3)'
                              }`
                            }}
                          >
                            {ep.health_state}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <SourceChip source={ep.discovery_source} />
                        </td>
                        <td className="px-5 py-3.5">
                          {ep.last_checked_at ? (
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                              <Clock size={12} className="text-slate-400" />
                              {formatTime(ep.last_checked_at)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => handleToggleMonitoring(ep.id, !ep.enabled)}
                            className="relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300"
                            style={{ background: ep.enabled ? '#2563eb' : '#cbd5e1' }}
                            title={ep.enabled ? 'Disable monitoring' : 'Enable monitoring'}
                          >
                            <span
                              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-300 shadow"
                              style={{ transform: ep.enabled ? 'translateX(18px)' : 'translateX(2px)' }}
                            />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Discovery tab ── */}
      {activeTab === 'discovery' && (
        <div className="flex flex-col gap-5 animate-fade-in">
          {!latestRun ? (
            <div className="bg-white border border-slate-200 rounded-2xl text-center py-20 px-4 shadow-xs">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-blue-50 border border-blue-200/60 animate-float text-blue-600">
                <Search size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2 font-display">No Discovery Runs Yet</h3>
              <p className="text-xs text-slate-500 mb-6 max-w-sm mx-auto">
                Trigger a discovery run to automatically find, extract, and verify API endpoints from OpenAPI specs, web crawling, and JS bundles.
              </p>
              <button onClick={handleStartDiscovery} className="btn-primary px-6 py-2.5 text-sm font-semibold flex items-center gap-2 mx-auto">
                <Play size={15} /> Run Discovery Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* ── Left: Live Step Tracker ── */}
              <div className="lg:col-span-1">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs h-full flex flex-col">
                  <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                      <GitBranch size={16} className="text-blue-600" />
                      Discovery Pipeline
                    </h3>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                        latestRun.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        latestRun.status === 'FAILED'    ? 'bg-rose-50 text-rose-700 border border-rose-200'   :
                        'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                      }`}
                    >
                      {latestRun.status}
                    </span>
                  </div>

                  <div className="flex-1">
                    <StepTracker run={latestRun} />
                  </div>

                  {/* Timing */}
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="text-[10px] uppercase font-bold tracking-wider mb-2 text-slate-400">
                      Run Metrics
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs text-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Started</span>
                        <span className="font-medium text-slate-700">{formatTime(latestRun.created_at)}</span>
                      </div>
                      {latestRun.completed_at && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Completed</span>
                          <span className="font-medium text-slate-700">{formatTime(latestRun.completed_at)}</span>
                        </div>
                      )}
                      {latestRun.openapi_url && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-400">Spec URL</span>
                          <a
                            href={latestRun.openapi_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono truncate max-w-[140px] text-emerald-700 hover:underline"
                            title={latestRun.openapi_url}
                          >
                            {latestRun.openapi_url}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error */}
                  {latestRun.error_message && (
                    <div className="mt-3 p-3 rounded-xl text-xs bg-rose-50 border border-rose-200 text-rose-800 animate-fade-in">
                      <div className="flex items-center gap-1.5 mb-1 font-bold text-rose-700">
                        <Info size={12} /> Error
                      </div>
                      {latestRun.error_message}
                    </div>
                  )}

                  {/* Summary stats */}
                  {latestRun.status === 'COMPLETED' && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <StatBox label="Total" value={latestRun.candidates_total} />
                      <StatBox label="Verified" value={latestRun.candidates_verified} color="var(--success)" />
                      <StatBox label="Unavailable" value={latestRun.candidates_unavailable} color="var(--warning)" />
                      <StatBox label="Blocked" value={latestRun.candidates_blocked} color="var(--error)" />
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right: Candidates table ── */}
              <div className="lg:col-span-2 flex flex-col gap-4">
                {/* Filter and actions bar */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm text-slate-900 mr-1">
                      Discovered Candidates
                    </h3>

                    {/* Source filter */}
                    <select
                      value={filterSource}
                      onChange={e => {
                        setFilterSource(e.target.value);
                        setCandidatePage(1);
                      }}
                      className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-colors"
                    >
                      <option value="ALL">All Sources</option>
                      <option value="OPENAPI">OpenAPI</option>
                      <option value="CRAWLER">Crawler</option>
                      <option value="JAVASCRIPT">JavaScript</option>
                    </select>

                    {/* Method filter */}
                    <select
                      value={filterMethod}
                      onChange={e => setFilterMethod(e.target.value)}
                      className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-colors"
                    >
                      <option value="ALL">All Methods</option>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>

                    {/* Verification filter */}
                    <select
                      value={filterVerification}
                      onChange={e => {
                        setFilterVerification(e.target.value);
                        setCandidatePage(1);
                      }}
                      className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-colors"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="VERIFIED">Verified APIs</option>
                      <option value="AUTH_REQUIRED">Auth Required</option>
                      <option value="WEB_PAGE">Web Pages</option>
                      <option value="UNAVAILABLE">Unavailable / Errors</option>
                      <option value="PENDING">Pending</option>
                      <option value="NOT_VERIFIED">Not Verified</option>
                    </select>

                    <span className="text-[11px] font-medium text-slate-400 ml-1">
                      {filteredCandidates?.length ?? 0} result{filteredCandidates?.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {selectedCandidates.size > 0 && (
                    <div className="flex items-center gap-2 flex-wrap ml-auto">
                      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                        <Clock size={12} className="text-slate-400" />
                        <span className="text-slate-600 font-medium">Interval (s):</span>
                        <input
                          type="number"
                          min="5"
                          value={checkInterval}
                          onChange={(e) => setCheckInterval(Math.max(5, parseInt(e.target.value) || 5))}
                          className="bg-white border border-slate-200 rounded px-1.5 py-0.5 outline-none w-12 text-slate-800 font-mono text-center font-bold"
                        />
                      </div>
                      <button
                        onClick={handleAcceptSelected}
                        disabled={isAccepting}
                        className="btn-primary px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                      >
                        {isAccepting ? <RefreshCw size={12} className="animate-spin" /> : <ShieldCheck size={14} />}
                        Add to Monitoring ({selectedCandidates.size})
                      </button>
                    </div>
                  )}
                </div>

                {/* Action Feedback alert */}
                {actionFeedback && (
                  <div className={`p-3.5 rounded-xl text-xs flex items-center justify-between gap-3 border shadow-xs animate-fade-in ${
                    actionFeedback.type === 'success' 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      {actionFeedback.type === 'success' ? (
                        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle size={16} className="text-rose-600 shrink-0" />
                      )}
                      <span className="font-medium">{actionFeedback.message}</span>
                    </div>
                    {actionFeedback.type === 'success' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('endpoints');
                          setActionFeedback(null);
                        }}
                        className="font-bold text-emerald-700 hover:text-emerald-900 underline text-xs cursor-pointer ml-auto whitespace-nowrap"
                      >
                        View Monitored Endpoints &rarr;
                      </button>
                    )}
                  </div>
                )}

                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex-1">
                  {isDiscovering && (!candidates || candidates.length === 0) ? (
                    <div className="py-16 px-4 text-center flex flex-col items-center justify-center">
                      <div className="relative w-16 h-16 flex items-center justify-center mb-4">
                        <div className="radar-ring" />
                        <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-inner">
                          <RefreshCw size={22} className="animate-spin" />
                        </div>
                      </div>
                      <h4 className="text-base font-bold text-slate-900 mb-1">Discovery in Progress</h4>
                      <p className="text-xs text-slate-500 max-w-sm mb-4">
                        Crawling pages, parsing OpenAPI specs &amp; JavaScript bundles, and actively probing candidate endpoints.
                      </p>
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200/80 px-3 py-1 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                        Pipeline executing active checks
                      </div>
                    </div>
                  ) : filteredCandidates?.length === 0 ? (
                    <div className="py-16 px-4 text-center">
                      <Search size={36} className="mx-auto mb-3 text-slate-300" />
                      <p className="font-semibold text-slate-700 mb-1">
                        {candidates?.length === 0
                          ? 'No endpoints discovered yet'
                          : 'No candidates match your current filters'}
                      </p>
                      <p className="text-xs text-slate-400 max-w-xs mx-auto">
                        {candidates?.length === 0
                          ? 'Run discovery or wait for crawler to complete its cycle.'
                          : 'Try changing your source or method filter above.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-4 py-3 w-8">
                              <input 
                                type="checkbox"
                                onChange={toggleAllCandidates}
                                checked={selectableCandidates.length > 0 && selectableCandidates.every(c => selectedCandidates.has(c.id))}
                                disabled={selectableCandidates.length === 0}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                              />
                            </th>
                            {['Method & Path', 'Source', 'Confidence', 'Verification', 'Status'].map(h => (
                              <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredCandidates?.map((c) => (
                            <tr
                              key={c.id}
                              className={`data-row ${selectedCandidates.has(c.id) ? 'bg-blue-50/50' : ''}`}
                            >
                              <td className="px-4 py-3.5">
                                <input 
                                  type="checkbox"
                                  checked={selectedCandidates.has(c.id)}
                                  onChange={() => toggleCandidateSelection(c.id)}
                                  disabled={!isCandidateSelectable(c)}
                                  title={
                                    c.accepted 
                                      ? 'Already monitored' 
                                      : !isCandidateSelectable(c) 
                                        ? `${c.verification_status === 'WEB_PAGE' ? 'Web pages' : c.verification_status} cannot be added as API endpoints` 
                                        : 'Select candidate for monitoring'
                                  }
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2.5">
                                  <MethodBadge method={c.method} />
                                  <span
                                    className="font-mono text-xs font-semibold text-slate-800 max-w-[180px] lg:max-w-[280px] truncate"
                                    title={c.path}
                                  >
                                    {c.path}
                                  </span>
                                </div>
                                {c.summary && (
                                  <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[220px]">
                                    {c.summary}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                <SourceChip source={c.source} />
                              </td>
                              <td className="px-4 py-3.5">
                                <ConfidenceChip confidence={c.confidence} />
                              </td>
                              <td className="px-4 py-3.5">
                                <div title={c.verification_error || undefined}>
                                  <VerifyChip status={c.verification_status} httpStatus={c.http_status} />
                                </div>
                                {c.verification_error && (
                                  <div className="text-[10px] text-slate-500 mt-0.5 max-w-[200px] truncate" title={c.verification_error}>
                                    {c.verification_error}
                                  </div>
                                )}
                                {c.response_time_ms && c.response_time_ms > 0 && (
                                  <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                    {c.response_time_ms.toFixed(0)}ms
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                {c.accepted ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                    <CheckCircle2 size={12} /> Monitored
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {candidatesMeta && (
                        <div className="p-3 border-t border-slate-100">
                          <Pagination
                            currentPage={candidatePage}
                            totalPages={Math.ceil((candidatesMeta.total || 0) / candidatesPerPage)}
                            onPageChange={setCandidatePage}
                            totalItems={candidatesMeta.total}
                            itemsPerPage={candidatesPerPage}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
