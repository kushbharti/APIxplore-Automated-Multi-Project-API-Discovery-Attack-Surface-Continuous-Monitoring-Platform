import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, RefreshCw, Activity, CheckCircle2, XCircle, Search,
  FileCode2, Clock, Code2, ArrowLeft, Zap, Shield, Play,
  GitBranch, Server, Info, Settings, Trash2, Lock,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun, DiscoveryCandidate, Endpoint } from '../types';
import { formatDate, formatRelative, formatLatency } from '../utils/date';
import { Pagination } from '../components/Pagination';

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
      desc: isActive(['URL_VALIDATION', 'OPENAPI_DETECTION']) 
        ? (progressDetails?.status ? `Status: ${progressDetails.status}` : 'Validating URL...')
        : 'Scanning common spec paths: /openapi.json, /swagger.json, /docs',
      status: run.openapi_checked
        ? 'completed'
        : isActive(['URL_VALIDATION', 'OPENAPI_DETECTION'])
        ? 'active'
        : isFailed
        ? 'error'
        : 'pending',
      result: run.openapi_checked
        ? run.openapi_found
          ? `✓ Found spec at ${run.openapi_url ?? 'unknown'}`
          : '✗ No OpenAPI spec found — falling back to crawler'
        : undefined,
    },
    {
      id: 'crawl',
      icon: <Search size={16} />,
      title: 'Website Crawler',
      desc: isActive(['CRAWLING']) && progressDetails
        ? `Pages visited: ${progressDetails.pages_visited ?? 0} | Queue: ${progressDetails.queue_size ?? 0}`
        : 'BFS crawl (depth 2, max 50 pages) — following same-domain links',
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
  label, value, color, sub
}: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}
    >
      <div className="text-[10px] uppercase font-semibold tracking-widest mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-2xl font-bold stat-counter" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</div>}
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
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [isAccepting, setIsAccepting] = useState(false);
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

  const handleAcceptSelected = async () => {
    if (!latestRun?.id || selectedCandidates.size === 0) return;
    setIsAccepting(true);
    try {
      await apiFetch(`/discovery/${latestRun.id}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          candidate_ids: Array.from(selectedCandidates),
          check_interval_seconds: checkInterval,
          failure_threshold: 3,
          latency_threshold_ms: 2000,
          timeout_ms: 5000,
          enabled: true
        }),
      });
      setSelectedCandidates(new Set());
      queryClient.invalidateQueries({ queryKey: ['discovery-candidates', latestRun.id] });
      queryClient.invalidateQueries({ queryKey: ['projects', id, 'endpoints'] });
      queryClient.invalidateQueries({ queryKey: ['projects', id] });
    } catch (e: any) {
      console.error('Failed to accept candidates:', e.message);
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
    if (!filteredCandidates) return;
    
    // Only select verified candidates that are not yet accepted
    const verifiableCandidates = filteredCandidates.filter(c => c.verification_status === 'VERIFIED' && !c.accepted);
    
    if (selectedCandidates.size === verifiableCandidates.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(verifiableCandidates.map(c => c.id)));
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

  /* ── Filtered candidates ── */
  const filteredCandidates = candidates?.filter(c => {
    // Note: source filtering is now handled partially by the backend, 
    // but we can still filter by method client-side since the backend doesn't support method filtering.
    const mthOk = filterMethod === 'ALL' || c.method === filterMethod;
    return mthOk;
  });

  /* ── Render ── */
  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-12">

      {/* ── Back nav ── */}
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-sm w-fit transition-colors"
        style={{ color: 'var(--muted)' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
      >
        <ArrowLeft size={16} /> Back to Dashboard
      </button>

      {/* ── Project header ── */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(12,12,28,0.95), rgba(18,12,40,0.95))',
          border: '1px solid rgba(99,102,241,0.2)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* BG decoration */}
        <div
          className="absolute top-0 right-0 w-64 h-64 rounded-full -mr-20 -mt-20 opacity-10"
          style={{ background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)' }}
        />
        <Globe
          size={120}
          className="absolute top-4 right-8 opacity-5 animate-float"
        />

        <div className="relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold text-white">{project.name}</h1>
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-lg ${
                    project.status === 'HEALTHY'  ? 'text-[var(--success)]' :
                    project.status === 'DEGRADED' ? 'text-[var(--warning)]' :
                    project.status === 'DOWN'     ? 'text-[var(--error)]'   :
                    'text-[var(--muted)]'
                  }`}
                  style={{
                    background: project.status === 'HEALTHY'  ? 'var(--success-transparent)' :
                                project.status === 'DEGRADED' ? 'var(--warning-transparent)' :
                                project.status === 'DOWN'     ? 'var(--error-transparent)'   :
                                'rgba(100,100,130,0.12)',
                    border: `1px solid ${
                      project.status === 'HEALTHY'  ? 'rgba(16,185,129,0.3)' :
                      project.status === 'DEGRADED' ? 'rgba(245,158,11,0.3)' :
                      project.status === 'DOWN'     ? 'rgba(239,68,68,0.3)' :
                      'rgba(100,100,130,0.3)'
                    }`
                  }}
                >
                  {project.status}
                </span>
              </div>
              <div className="flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                <Globe size={13} />
                <span className="text-sm font-mono">{project.url}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditName(project.name);
                  setEditUrl(project.url);
                  setIsEditing(true);
                }}
                className="p-2.5 rounded-xl transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                title="Edit Project"
              >
                <Settings size={15} />
              </button>
              <button
                onClick={handleDeleteProject}
                className="p-2.5 rounded-xl transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--error)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--error-transparent)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                title="Delete Project"
              >
                <Trash2 size={15} />
              </button>
              <button
                onClick={handleStartDiscovery}
                disabled={isDiscovering}
                className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2 ml-2"
              >
                {isDiscovering ? (
                  <><RefreshCw size={15} className="animate-spin" /> Discovering…</>
                ) : (
                  <><Play size={15} /> Run Discovery</>
                )}
              </button>
            </div>
          </div>

          {/* Stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Monitored" value={project.endpoint_count} color="var(--text-primary)" />
            <StatBox label="Healthy"   value={project.healthy_count}  color="var(--success)" />
            <StatBox label="Degraded"  value={project.degraded_count} color="var(--warning)" />
            <StatBox label="Down"      value={project.down_count}     color={project.down_count > 0 ? 'var(--error)' : 'var(--muted)'} />
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4">Edit Project</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1 block">Project Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1 block">Project URL</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  className="w-full bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none focus:border-[var(--primary)] transition-colors"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditProject}
                className="btn-primary px-5 py-2 text-sm rounded-xl"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="tab-bar">
        <button
          onClick={() => setActiveTab('endpoints')}
          className={`tab-item ${activeTab === 'endpoints' ? 'active' : ''}`}
        >
          <Activity size={15} /> Monitored Endpoints
          {endpoints && endpoints.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}
            >
              {endpoints.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('discovery')}
          className={`tab-item ${activeTab === 'discovery' ? 'active' : ''}`}
        >
          <Search size={15} /> Discovery Engine
          {isDiscovering && (
            <span className="flex h-1.5 w-1.5 ml-1 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--primary)' }} />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: 'var(--primary)' }} />
            </span>
          )}
          {candidates && candidates.length > 0 && !isDiscovering && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}
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
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Shield size={16} style={{ color: 'var(--primary-light)' }} />
              Active Monitoring
            </h3>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>
              {endpoints?.length ?? 0} endpoint{endpoints?.length !== 1 ? 's' : ''} tracked
            </span>
          </div>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          >
            {endpoints?.length === 0 ? (
              <div className="py-16 text-center">
                <Server size={36} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium mb-1">No endpoints monitored yet</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  Run Discovery to find endpoints, then accept them to start monitoring.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)' }}>
                    {['Method & Path', 'Health', 'Source', 'Last Checked', 'Monitoring'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
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
                            className="font-mono text-sm max-w-[240px] truncate"
                            title={ep.path || ep.url}
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {ep.path || ep.url}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
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
                          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                            <Clock size={12} />
                            {new Date(ep.last_checked_at).toLocaleTimeString()}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => handleToggleMonitoring(ep.id, !ep.enabled)}
                          className="relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300"
                          style={{ background: ep.enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}
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
            )}
          </div>
        </div>
      )}

      {/* ── Discovery tab ── */}
      {activeTab === 'discovery' && (
        <div className="flex flex-col gap-5 animate-fade-in">
          {!latestRun ? (
            <div
              className="text-center py-20 rounded-2xl"
              style={{ background: 'var(--bg-card)', border: '1px dashed rgba(99,102,241,0.2)' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
                style={{ background: 'var(--primary-transparent)', border: '1px solid rgba(99,102,241,0.2)' }}
              >
                <Search size={28} style={{ color: 'var(--primary-light)' }} />
              </div>
              <h3 className="text-lg font-semibold mb-2">No Discovery Runs</h3>
              <p className="text-sm mb-6 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Start a discovery run to automatically find API endpoints in your project.
              </p>
              <button onClick={handleStartDiscovery} className="btn-primary px-6 py-2.5 text-sm flex items-center gap-2 mx-auto">
                <Play size={15} /> Run Discovery Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* ── Left: Live Step Tracker ── */}
              <div className="lg:col-span-1">
                <div
                  className="rounded-2xl p-5 h-full"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                >
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <GitBranch size={15} style={{ color: 'var(--primary-light)' }} />
                      Discovery Pipeline
                    </h3>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                        latestRun.status === 'COMPLETED' ? 'text-[var(--success)]' :
                        latestRun.status === 'FAILED'    ? 'text-[var(--error)]'   :
                        'text-[var(--primary-light)]'
                      }`}
                      style={{
                        background: latestRun.status === 'COMPLETED' ? 'var(--success-transparent)'
                          : latestRun.status === 'FAILED' ? 'var(--error-transparent)'
                          : 'var(--primary-transparent)',
                        border: `1px solid ${
                          latestRun.status === 'COMPLETED' ? 'rgba(16,185,129,0.3)'
                          : latestRun.status === 'FAILED' ? 'rgba(239,68,68,0.3)'
                          : 'rgba(99,102,241,0.3)'
                        }`
                      }}
                    >
                      {latestRun.status}
                    </span>
                  </div>

                  <StepTracker run={latestRun} />

                  {/* Timing */}
                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-color)' }}>
                    <div className="text-[10px] uppercase font-semibold tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                      Run Info
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center justify-between">
                        <span style={{ color: 'var(--muted)' }}>Started</span>
                        <span>{new Date(latestRun.created_at).toLocaleTimeString()}</span>
                      </div>
                      {latestRun.completed_at && (
                        <div className="flex items-center justify-between">
                          <span style={{ color: 'var(--muted)' }}>Completed</span>
                          <span>{new Date(latestRun.completed_at).toLocaleTimeString()}</span>
                        </div>
                      )}
                      {latestRun.openapi_url && (
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ color: 'var(--muted)' }}>Spec URL</span>
                          <span className="font-mono truncate max-w-[120px] text-[var(--success)]" title={latestRun.openapi_url}>
                            {latestRun.openapi_url}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error */}
                  {latestRun.error_message && (
                    <div
                      className="mt-3 p-3 rounded-xl text-xs animate-fade-in"
                      style={{ background: 'var(--error-transparent)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
                    >
                      <div className="flex items-center gap-1.5 mb-1 font-semibold" style={{ color: 'var(--error)' }}>
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
                {/* Filter row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-semibold text-sm flex-1">Discovered Candidates</h3>

                  {/* Source filter */}
                  <select
                    value={filterSource}
                    onChange={e => {
                      setFilterSource(e.target.value);
                      setCandidatePage(1);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border-none outline-none cursor-pointer"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                    }}
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
                    className="text-xs px-3 py-1.5 rounded-lg border-none outline-none cursor-pointer"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <option value="ALL">All Methods</option>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>

                  <span className="text-[11px] flex-1" style={{ color: 'var(--muted)' }}>
                    {filteredCandidates?.length ?? 0} result{filteredCandidates?.length !== 1 ? 's' : ''}
                  </span>
                  
                  {selectedCandidates.size > 0 && (
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <Clock size={12} style={{ color: 'var(--muted)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Interval (s):</span>
                        <input
                          type="number"
                          min="5"
                          value={checkInterval}
                          onChange={(e) => setCheckInterval(Math.max(5, parseInt(e.target.value) || 5))}
                          className="bg-transparent border-none outline-none w-12 text-[var(--text-primary)] font-mono"
                        />
                      </div>
                      <button
                        onClick={handleAcceptSelected}
                        disabled={isAccepting}
                        className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
                      >
                        {isAccepting ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        Accept {selectedCandidates.size} Endpoints
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className="rounded-2xl overflow-hidden flex-1"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                >
                  {isDiscovering && (!candidates || candidates.length === 0) ? (
                    <div className="py-12 text-center">
                      <RefreshCw size={32} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--primary)' }} />
                      <p className="font-medium mb-1" style={{ color: 'var(--primary-light)' }}>Discovery in progress…</p>
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>
                        Crawling pages, parsing specs, and probing endpoints.
                      </p>
                    </div>
                  ) : filteredCandidates?.length === 0 ? (
                    <div className="py-12 text-center">
                      <Search size={32} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>
                        {candidates?.length === 0
                          ? 'No endpoints discovered yet.'
                          : 'No results for current filters.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)' }}>
                            <th className="px-4 py-3 w-8">
                              <input 
                                type="checkbox"
                                onChange={toggleAllCandidates}
                                checked={(filteredCandidates?.filter(c => c.verification_status === 'VERIFIED' && !c.accepted).length ?? 0) > 0 && selectedCandidates.size === (filteredCandidates?.filter(c => c.verification_status === 'VERIFIED' && !c.accepted).length ?? 0)}
                                disabled={!filteredCandidates?.some(c => c.verification_status === 'VERIFIED' && !c.accepted)}
                                className="rounded bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] text-[var(--primary)] focus:ring-[var(--primary)]"
                              />
                            </th>
                            {['Method & Path', 'Source', 'Confidence', 'Verification', 'Accepted'].map(h => (
                              <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCandidates?.map((c, idx) => (
                            <tr
                              key={c.id}
                              className={`data-row animate-fade-in ${selectedCandidates.has(c.id) ? 'bg-[rgba(99,102,241,0.05)]' : ''}`}
                              style={{ animationDelay: `${Math.min(idx * 20, 300)}ms` }}
                            >
                              <td className="px-4 py-3">
                                <input 
                                  type="checkbox"
                                  checked={selectedCandidates.has(c.id)}
                                  onChange={() => toggleCandidateSelection(c.id)}
                                  disabled={c.accepted || c.verification_status !== 'VERIFIED'}
                                  className="rounded bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] text-[var(--primary)] focus:ring-[var(--primary)]"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <MethodBadge method={c.method} />
                                  <span
                                    className="font-mono text-xs max-w-[180px] lg:max-w-[260px] truncate"
                                    title={c.path}
                                    style={{ color: 'var(--text-primary)' }}
                                  >
                                    {c.path}
                                  </span>
                                </div>
                                {c.summary && (
                                  <div className="text-[10px] mt-0.5 truncate max-w-[200px]" style={{ color: 'var(--muted)' }}>
                                    {c.summary}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <SourceChip source={c.source} />
                              </td>
                              <td className="px-4 py-3">
                                <ConfidenceChip confidence={c.confidence} />
                              </td>
                              <td className="px-4 py-3">
                                <VerifyChip status={c.verification_status} httpStatus={c.http_status} />
                                {c.response_time_ms && c.response_time_ms > 0 && (
                                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
                                    {c.response_time_ms.toFixed(0)}ms
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {c.accepted ? (
                                  <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--success)' }}>
                                    <CheckCircle2 size={12} /> Monitoring
                                  </span>
                                ) : (
                                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {candidatesMeta && (
                        <Pagination
                          currentPage={candidatePage}
                          totalPages={Math.ceil((candidatesMeta.total || 0) / candidatesPerPage)}
                          onPageChange={setCandidatePage}
                          totalItems={candidatesMeta.total}
                          itemsPerPage={candidatesPerPage}
                        />
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
