import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { ArrowLeft, Activity, Clock, ShieldCheck, AlertOctagon, Settings2, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import type { Endpoint } from '../types';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { formatDate, formatRelative } from '../utils/date';
import { Server } from 'lucide-react';


function MethodBadge({ method }: { method: string }) {
  const cls = {
    GET: 'method-get', POST: 'method-post', PUT: 'method-put',
    PATCH: 'method-patch', DELETE: 'method-delete',
  }[method.toUpperCase()] ?? 'method-other';
  return <span className={`method-badge ${cls}`}>{method}</span>;
}

// ─── Endpoint Response Section ──────────────────────────────────────────────

const DISPLAY_BODY_LIMIT = 10_000; // chars shown in the UI

function statusColor(code: number | null | undefined): string {
  if (!code) return 'var(--muted)';
  if (code < 300) return 'var(--success)';
  if (code < 400) return 'var(--warning)';
  return 'var(--error)';
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function tryPrettyJson(raw: string): { isJson: boolean; display: string } {
  try {
    const parsed = JSON.parse(raw);
    return { isJson: true, display: JSON.stringify(parsed, null, 2) };
  } catch {
    return { isJson: false, display: raw };
  }
}

function EndpointResponseSection({
  latestResponse,
  onRunCheck,
}: {
  latestResponse: any;
  onRunCheck: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);

  if (latestResponse === undefined) {
    // Still loading
    return null;
  }

  if (!latestResponse) {
    // Explicitly null — no check has been run yet
    return (
      <Card className="p-6 animate-fade-in">
        <h3 className="font-semibold mb-4 text-sm flex items-center gap-2 text-[var(--text-primary)]">
          <Server size={16} className="text-[var(--primary-light)]" />
          Endpoint Response
        </h3>
        <div className="flex flex-col items-center justify-center py-10 text-center gap-3 border border-dashed border-[var(--border-color)] rounded-xl">
          <Server size={36} className="text-[var(--muted)] opacity-40" />
          <p className="text-sm text-[var(--text-secondary)] max-w-sm">
            No response data available yet. Run a check to fetch the latest response.
          </p>
          <button
            onClick={onRunCheck}
            className="mt-2 px-4 py-2 rounded-xl text-sm font-medium bg-[var(--primary-transparent)] border border-[rgba(99,102,241,0.3)] text-[var(--primary-light)] hover:bg-[rgba(99,102,241,0.15)] transition-colors"
          >
            Run Check Now
          </button>
        </div>
      </Card>
    );
  }

  const rawBody: string = latestResponse.response_body ?? '';
  const isBodyTruncated = rawBody.length > DISPLAY_BODY_LIMIT;
  const displayBody = rawBody.slice(0, DISPLAY_BODY_LIMIT);
  const ct: string = latestResponse.content_type ?? '';
  const isJsonCt = ct.toLowerCase().includes('json');
  const { isJson, display: prettyBody } = tryPrettyJson(displayBody);
  const useJson = (isJsonCt || isJson) && !showRaw;

  return (
    <Card className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-sm flex items-center gap-2 text-[var(--text-primary)]">
          <Server size={16} className="text-[var(--primary-light)]" />
          Endpoint Response
        </h3>
        {rawBody && (
          <button
            onClick={() => setShowRaw(r => !r)}
            className="text-xs px-3 py-1 rounded-lg border border-[var(--border-color)] text-[var(--muted)] hover:text-white transition-colors"
          >
            {showRaw ? 'Pretty' : 'Raw'}
          </button>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          {
            label: 'Status',
            value: latestResponse.status_code
              ? `${latestResponse.status_code}`
              : latestResponse.failure_reason ?? '—',
            color: statusColor(latestResponse.status_code),
          },
          {
            label: 'Response Time',
            value: latestResponse.latency_ms != null
              ? `${Math.round(latestResponse.latency_ms)} ms`
              : '—',
            color: 'var(--text-primary)',
          },
          {
            label: 'Content-Type',
            value: ct
              ? ct.split(';')[0].trim()
              : '—',
            color: 'var(--text-secondary)',
          },
          {
            label: 'Response Size',
            value: formatBytes(latestResponse.response_size_bytes),
            color: 'var(--text-secondary)',
          },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="p-3 rounded-xl"
            style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid var(--border-color)' }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">{label}</div>
            <div className="text-sm font-semibold truncate" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Checked-at timestamp */}
      <div className="text-xs text-[var(--muted)] mb-3 flex items-center gap-1">
        <Clock size={12} />
        Checked: {formatDate(latestResponse.checked_at)}
      </div>

      {/* Response body */}
      <div>
        <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-2">
          Response Body
        </div>
        {!rawBody ? (
          <div className="text-sm text-[var(--muted)] italic py-4 text-center border border-dashed border-[var(--border-color)] rounded-xl">
            {latestResponse.error_detail
              ? `Error: ${latestResponse.error_detail}`
              : 'No response body captured.'}
          </div>
        ) : (
          <div className="relative">
            <pre
              className="text-xs leading-relaxed overflow-auto rounded-xl p-4 max-h-[400px]"
              style={{
                background: 'rgba(0,0,0,0.06)',
                border: '1px solid var(--border-color)',
                color: useJson ? '#a5f3fc' : 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {useJson ? prettyBody : displayBody}
            </pre>
            {isBodyTruncated && (
              <div className="mt-2 text-xs text-[var(--warning)] text-center">
                Response body truncated at {(DISPLAY_BODY_LIMIT / 1000).toFixed(0)} KB — full response stored in backend.
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}



export const EndpointDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'checks' | 'incidents' | 'config'>('overview');

  const { data: endpoint, isLoading: epLoading } = useQuery({
    queryKey: ['endpoints', id],
    queryFn: () => apiFetch<Endpoint>(`/endpoints/${id}`),
    refetchInterval: 10000,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics-endpoints', id],
    queryFn: () => apiFetch<any>(`/analytics/endpoints/${id}`),
    refetchInterval: 10000,
  });

  const { data: history } = useQuery({
    queryKey: ['analytics-history', id],
    queryFn: () => apiFetch<any[]>(`/analytics/history/${id}`),
    refetchInterval: 10000,
  });

  const { data: recentChecks } = useQuery({
    queryKey: ['endpoints', id, 'health'],
    queryFn: () => apiFetch<any[]>(`/endpoints/${id}/health?limit=50`),
    refetchInterval: 5000,
  });

  const { data: incidents } = useQuery({
    queryKey: ['endpoints', id, 'incidents'],
    queryFn: () => apiFetch<any[]>(`/endpoints/${id}/incidents?limit=20`),
  });

  const { data: latestResponse } = useQuery({
    queryKey: ['endpoints', id, 'latest-response'],
    queryFn: () => apiFetch<any>(`/endpoints/${id}/latest-response`),
    refetchInterval: 10000,
  });

  const updateConfigMutation = useMutation({
    mutationFn: (data: Partial<Endpoint>) => apiFetch(`/endpoints/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', id] });
    }
  });

  if (epLoading || analyticsLoading) {
    return (
      <div className="flex flex-col gap-6 max-w-6xl mx-auto animate-pulse">
        <div className="h-40 rounded-2xl shimmer border border-[var(--border-color)]" />
        <div className="h-64 rounded-2xl shimmer border border-[var(--border-color)]" />
      </div>
    );
  }

  if (!endpoint) {
    return <div className="p-16 text-center text-[var(--error)]">Endpoint not found</div>;
  }

  const handleToggleMonitoring = async () => {
    try {
      await apiFetch(`/endpoints/${id}/toggle?enabled=${!endpoint.enabled}`, { method: 'PATCH' });
      queryClient.invalidateQueries({ queryKey: ['endpoints', id] });
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunCheck = async () => {
    try {
      await apiFetch(`/endpoints/${id}/check`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['endpoints', id, 'health'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-history', id] });
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfigSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateConfigMutation.mutate({
      check_interval_seconds: parseInt(formData.get('check_interval') as string),
      timeout_ms: parseInt(formData.get('timeout') as string),
      failure_threshold: parseInt(formData.get('failure_threshold') as string),
      latency_threshold_ms: parseInt(formData.get('latency_threshold') as string),
    });
  };

  const chartData = history?.map(h => ({
    time: formatDate(h.timestamp),
    latency: h.latency_ms ?? 0,
    success: h.success ? 1 : 0
  })) || [];


  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {/* ── Back nav ── */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm w-fit transition-colors text-[var(--muted)] hover:text-white"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* ── Header ── */}
      <div className="rounded-2xl p-6 relative overflow-hidden shadow-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full -mr-20 -mt-20 opacity-5 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)' }} />
        
        <div className="flex justify-between items-start relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <MethodBadge method={endpoint.method} />
              <h1 className="text-xl font-bold truncate max-w-[400px] text-[var(--text-primary)]" title={endpoint.path || endpoint.url}>
                {endpoint.path || endpoint.url}
              </h1>
              <Badge variant={
                endpoint.health_state === 'HEALTHY' ? 'success' :
                endpoint.health_state === 'DEGRADED' ? 'warning' :
                endpoint.health_state === 'DOWN' ? 'error' : 'default'
              }>
                {endpoint.health_state}
              </Badge>
            </div>
            <div className="text-sm font-mono text-[var(--muted)] mb-4 truncate max-w-[600px]">{endpoint.url}</div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex gap-3">
              <button 
                onClick={handleRunCheck} 
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-[rgba(255,255,255,0.05)] border border-[var(--border-color)] hover:bg-[rgba(255,255,255,0.1)] transition-colors"
              >
                <Activity size={15} /> Run Check
              </button>
              <button
                onClick={handleToggleMonitoring}
                className="px-4 py-2 text-sm font-medium flex items-center gap-2 rounded-xl transition-colors border"
                style={{
                  background: endpoint.enabled ? 'var(--error-transparent)' : 'var(--success-transparent)',
                  borderColor: endpoint.enabled ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)',
                  color: endpoint.enabled ? 'var(--error)' : 'var(--success)'
                }}
              >
                {endpoint.enabled ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
                {endpoint.enabled ? 'Pause Monitoring' : 'Resume Monitoring'}
              </button>
            </div>
            
            {endpoint.last_checked_at && (
              <div className="text-xs text-[var(--muted)] flex items-center gap-4 text-right">
                <span className="flex items-center gap-1"><Clock size={12}/> Last: {formatRelative(endpoint.last_checked_at)}</span>
                {endpoint.enabled && (
                  <span className="flex items-center gap-1 text-[var(--primary-light)]">
                    Next: {formatDate(new Date(new Date(endpoint.last_checked_at).getTime() + (endpoint.check_interval_seconds * 1000)))}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-color)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Success Rate (24h)</div>
            <div className="text-2xl font-bold text-[var(--primary-light)]">
              {analytics?.success_rate ? `${(analytics.success_rate * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-color)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Avg Latency</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {analytics?.avg_latency_ms ? `${analytics.avg_latency_ms.toFixed(0)}ms` : '—'}
            </div>
          </div>
          <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-color)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">P95 Latency</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {analytics?.p95_latency_ms ? `${analytics.p95_latency_ms.toFixed(0)}ms` : '—'}
            </div>
          </div>
          <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-color)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">Checks (24h)</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {analytics?.checks_24h?.toLocaleString() ?? 0}
            </div>
          </div>
        </div>
      </div>


      {/* ── Tab bar ── */}
      <div className="tab-bar">
        <button onClick={() => setActiveTab('overview')} className={`tab-item ${activeTab === 'overview' ? 'active' : ''}`}>
          <Activity size={15} /> Overview
        </button>
        <button onClick={() => setActiveTab('checks')} className={`tab-item ${activeTab === 'checks' ? 'active' : ''}`}>
          <Clock size={15} /> Recent Checks
        </button>
        <button onClick={() => setActiveTab('incidents')} className={`tab-item ${activeTab === 'incidents' ? 'active' : ''}`}>
          <AlertOctagon size={15} /> Incidents
        </button>
        <button onClick={() => setActiveTab('config')} className={`tab-item ${activeTab === 'config' ? 'active' : ''}`}>
          <Settings2 size={15} /> Configuration
        </button>
      </div>

      {/* ── Tab Content: Overview ── */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-6 animate-fade-in">

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 p-6 h-[400px]">
              <h3 className="font-semibold mb-6 text-sm flex items-center gap-2 text-[var(--text-primary)]">
                <Activity size={16} className="text-[var(--primary-light)]" /> Latency &amp; Performance (24h)
              </h3>
              <div className="h-[300px]">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                      <XAxis dataKey="time" stroke="var(--muted)" fontSize={11} tickMargin={10} minTickGap={30} />
                      <YAxis stroke="var(--muted)" fontSize={11} tickFormatter={(v) => `${v}ms`} />
                      <Tooltip
                        contentStyle={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                        itemStyle={{ color: 'var(--primary-light)' }}
                      />
                      <Area type="monotone" dataKey="latency" stroke="var(--primary)" fillOpacity={1} fill="url(#colorLatency)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--muted)] text-sm">
                    Not enough data collected yet.
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4 text-sm flex items-center gap-2">
                <Clock size={16} className="text-[var(--primary-light)]" /> Latest Health Checks
              </h3>
              <div className="flex flex-col gap-3">
                {recentChecks?.slice(0, 5).map((check, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 rounded-lg border bg-[rgba(0,0,0,0.03)] transition-colors" style={{
                    borderColor: check.success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'
                  }}>
                    <div className="flex items-center gap-3">
                      {check.success ? <CheckCircle2 size={16} className="text-[var(--success)]" /> : <XCircle size={16} className="text-[var(--error)]" />}
                      <div>
                        <div className="text-xs font-semibold">{check.status_code || 'Err'}</div>
                        <div className="text-[10px] text-[var(--muted)]">{formatRelative(check.checked_at)}</div>
                      </div>
                    </div>
                    <div className="text-xs font-mono text-[var(--text-secondary)]">
                      {check.latency_ms?.toFixed(0) ?? '—'} ms
                    </div>
                  </div>
                ))}
                {!recentChecks?.length && (
                  <div className="text-center text-sm text-[var(--muted)] py-8 border border-dashed border-[var(--border-color)] rounded-xl">No recent checks</div>
                )}
                {recentChecks && recentChecks.length > 5 && (
                  <button onClick={() => setActiveTab('checks')} className="mt-2 text-xs text-[var(--primary-light)] hover:underline text-center w-full">
                    View all checks &rarr;
                  </button>
                )}
              </div>
            </Card>
          </div>

          {/* ── Endpoint Response ── */}
          <EndpointResponseSection latestResponse={latestResponse} onRunCheck={handleRunCheck} />
        </div>
      )}

      {/* ── Tab Content: Checks ── */}
      {activeTab === 'checks' && (
        <Card className="p-0 overflow-hidden animate-fade-in flex flex-col h-[500px]">
          <div className="p-4 border-b border-[var(--border-color)] bg-[rgba(255,255,255,0.02)]">
            <h3 className="font-semibold text-sm">Health Check Log</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-2">
              {recentChecks?.map((check, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 rounded-xl border bg-[rgba(0,0,0,0.03)]" style={{
                  borderColor: check.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.2)'
                }}>
                  <div className="flex items-center gap-4">
                    {check.success ? <CheckCircle2 size={18} className="text-[var(--success)]" /> : <XCircle size={18} className="text-[var(--error)]" />}
                    <div>
                      <div className="text-sm font-semibold flex items-center gap-2">
                        HTTP {check.status_code || 'Network Error'}
                        {!check.success && check.failure_reason && (
                          <span className="text-xs font-normal text-[var(--error)]">({check.failure_reason})</span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{formatDate(check.checked_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-sm font-mono text-[var(--text-primary)]">
                      {check.latency_ms?.toFixed(0) ?? '—'} ms
                    </div>
                  </div>
                </div>
              ))}
              {!recentChecks?.length && (
                <div className="text-center text-sm text-[var(--muted)] py-12">No check history available.</div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Tab Content: Incidents ── */}
      {activeTab === 'incidents' && (
        <Card className="p-0 overflow-hidden animate-fade-in flex flex-col min-h-[300px]">
          <div className="p-4 border-b border-[var(--border-color)] bg-[rgba(255,255,255,0.02)]">
            <h3 className="font-semibold text-sm">Incident History</h3>
          </div>
          <div className="p-4">
            {incidents && incidents.length > 0 ? (
              <div className="flex flex-col gap-3">
                {incidents.map((incident: any) => (
                  <div key={incident.id} className="p-4 rounded-xl border border-[var(--border-color)] bg-[rgba(0,0,0,0.03)]">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <AlertOctagon size={16} className={incident.severity === 'CRITICAL' ? 'text-[var(--error)]' : 'text-[var(--warning)]'} />
                        <span className="font-semibold text-sm">{incident.title}</span>
                      </div>
                      <Badge variant={incident.status === 'RESOLVED' ? 'success' : 'error'}>{incident.status}</Badge>
                    </div>
                    <div className="text-xs text-[var(--muted)] mb-2">
                      Started: {formatDate(incident.created_at)}
                      {incident.resolved_at && ` • Resolved: ${formatDate(incident.resolved_at)}`}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">{incident.description}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 flex flex-col items-center">
                <ShieldCheck size={48} className="text-[var(--muted)] opacity-50 mb-4" />
                <h4 className="text-lg font-medium text-[var(--text-primary)] mb-1">No Incidents</h4>
                <p className="text-sm text-[var(--text-secondary)]">This endpoint has a clean operational history.</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Tab Content: Config ── */}
      {activeTab === 'config' && (
        <Card className="p-6 animate-fade-in max-w-2xl">
          <h3 className="font-semibold mb-6 text-sm flex items-center gap-2">
            <Settings2 size={16} className="text-[var(--primary-light)]" /> Monitoring Configuration
          </h3>
          <form onSubmit={handleConfigSubmit} className="flex flex-col gap-6">
            
            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Check Interval</label>
                <select name="check_interval" defaultValue={endpoint.check_interval_seconds} className="bg-[rgba(0,0,0,0.03)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--primary)]">
                  <option value={10}>10 Seconds (Aggressive)</option>
                  <option value={30}>30 Seconds</option>
                  <option value={60}>1 Minute (Standard)</option>
                  <option value={300}>5 Minutes</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Timeout</label>
                <select name="timeout" defaultValue={endpoint.timeout_ms} className="bg-[rgba(0,0,0,0.03)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--primary)]">
                  <option value={2000}>2 Seconds</option>
                  <option value={5000}>5 Seconds (Standard)</option>
                  <option value={10000}>10 Seconds</option>
                  <option value={30000}>30 Seconds (Lenient)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Failure Threshold</label>
                <select name="failure_threshold" defaultValue={endpoint.failure_threshold} className="bg-[rgba(0,0,0,0.03)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--primary)]">
                  <option value={1}>1 Check (Immediate)</option>
                  <option value={3}>3 Checks (Standard)</option>
                  <option value={5}>5 Checks (Forgiving)</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Latency Alert Threshold</label>
                <select name="latency_threshold" defaultValue={endpoint.latency_threshold_ms} className="bg-[rgba(0,0,0,0.03)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--primary)]">
                  <option value={500}>500ms</option>
                  <option value={1000}>1 Second</option>
                  <option value={2000}>2 Seconds (Standard)</option>
                  <option value={5000}>5 Seconds</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--border-color)] flex justify-end">
              <Button type="submit" disabled={updateConfigMutation.isPending}>
                {updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
            
            {updateConfigMutation.isSuccess && (
              <div className="text-sm text-[var(--success)] bg-[var(--success-transparent)] p-3 rounded-xl border border-[rgba(16,185,129,0.3)] text-center">
                Configuration updated successfully!
              </div>
            )}
          </form>
        </Card>
      )}

    </div>
  );
};
