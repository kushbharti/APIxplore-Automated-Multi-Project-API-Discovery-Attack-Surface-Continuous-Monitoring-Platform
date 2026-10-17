import { useState } from 'react';
import { Card } from '../components/Card';
import {
  Server, FileCode2, Search as SearchIcon, Clock, ShieldCheck,
  Database, Filter, PlayIcon, TrashIcon, RefreshIcon, AlertTriangleIcon
} from '../components/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { Endpoint } from '../types';
import { HttpRequestModal } from '../components/HttpRequestModal';
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
    CRAWLER:    { cls: 'source-crawler',    icon: <SearchIcon size={11} />,    label: 'Crawler' },
    JAVASCRIPT: { cls: 'source-javascript', icon: <FileCode2 size={11} />,     label: 'JavaScript' },
    MANUAL:     { cls: 'source-manual',     icon: <Server size={11} />,    label: 'Manual' },
  };
  const c = cfg[source] ?? cfg.MANUAL;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${c.cls}`}>
      {c.icon} {c.label}
    </span>
  );
}

export const Endpoints = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEndpointForRequest, setSelectedEndpointForRequest] = useState<Endpoint | null>(null);
  const [endpointToRemove, setEndpointToRemove] = useState<Endpoint | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ['endpoints'],
    queryFn: () => apiFetch<Endpoint[]>('/endpoints'),
    refetchInterval: 10000,
  });

  // Manual Check Now mutation
  const checkMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/endpoints/${id}/checks`, { method: 'POST' }),
    onSuccess: () => {
      setActionFeedback('Health check queued for endpoint');
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      setTimeout(() => setActionFeedback(null), 3000);
    },
    onError: (err: any) => {
      setActionFeedback(`Check failed: ${err.message}`);
      setTimeout(() => setActionFeedback(null), 4000);
    }
  });

  // Remove from monitoring mutation
  const removeMonitoringMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      setActionFeedback('Endpoint removed from continuous monitoring.');
      setEndpointToRemove(null);
      setRemoveError(null);
      setTimeout(() => setActionFeedback(null), 3500);
    },
    onError: (err: any) => {
      setRemoveError(err.message || 'Failed to remove endpoint from monitoring');
    }
  });

  const filteredEndpoints = endpoints?.filter(ep => 
    (ep.path || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (ep.url || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (ep.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="flex flex-col gap-6 h-full relative animate-fade-in pb-10">
      <div className="flex justify-between items-center mt-2 flex-wrap gap-4">
        <div>
          <h3 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary-transparent)] flex items-center justify-center text-[var(--primary-light)]">
              <Server size={20} />
            </div>
            Global Endpoints
          </h3>
          <p className="text-[var(--text-secondary)] mt-2 max-w-2xl text-sm">
            A unified view of all monitored API endpoints and web routes across your entire infrastructure.
          </p>
        </div>

        {actionFeedback && (
          <div className="px-4 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium animate-fade-in">
            {actionFeedback}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4 bg-[var(--bg-card)] p-4 rounded-2xl border border-[var(--border-color)] shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-md bg-[var(--bg-dark)] border border-[var(--border-color)] rounded-xl px-3 py-2 focus-within:border-[var(--primary)] transition-colors">
          <SearchIcon size={16} className="text-[var(--text-secondary)]" />
          <input 
            type="text" 
            placeholder="Search by path, URL or name..." 
            className="bg-transparent border-none outline-none text-sm w-full text-[var(--text-primary)] placeholder-[var(--muted)]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-slate-100 hover:text-slate-900 transition-colors ml-auto">
          <Filter size={16} /> Filters
        </button>
      </div>

      <Card className="flex-1 overflow-hidden p-0 flex flex-col shadow-lg border-[var(--border-color)]">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="h-16 rounded-xl shimmer border border-[var(--border-color)]"></div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-dark)] border-b border-[var(--border-color)] text-[10px] uppercase tracking-widest text-[var(--muted)]">
                  <th className="px-5 py-4 font-semibold">Method & Path</th>
                  <th className="px-5 py-4 font-semibold">Health</th>
                  <th className="px-5 py-4 font-semibold">Source</th>
                  <th className="px-5 py-4 font-semibold">Monitoring</th>
                  <th className="px-5 py-4 font-semibold">Last Checked</th>
                  <th className="px-5 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEndpoints.length > 0 ? filteredEndpoints.map((ep) => (
                    <tr 
                      key={ep.id} 
                      className="data-row cursor-pointer group"
                      onClick={() => navigate(`/endpoints/${ep.id}`)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <MethodBadge method={ep.method} />
                          <div className="flex flex-col">
                            <span className="font-mono text-sm max-w-[300px] truncate text-[var(--text-primary)] group-hover:text-blue-600 transition-colors" title={ep.path || ep.url}>
                              {ep.path || ep.url}
                            </span>
                            {ep.name && ep.name !== (ep.path || ep.url) && (
                              <span className="text-[10px] text-[var(--muted)] truncate max-w-[300px] mt-0.5">{ep.name}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
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
                          {ep.health_state || 'UNKNOWN'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <SourceChip source={ep.discovery_source} />
                      </td>
                      <td className="px-5 py-4">
                        {ep.enabled ? (
                          <span className="text-xs text-[var(--success)] flex items-center gap-1.5 font-medium">
                            <ShieldCheck size={14} /> Active
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)] flex items-center gap-1.5 font-medium">
                            <Database size={14} /> Paused
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-[var(--text-secondary)]">
                        {ep.last_checked_at ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <Clock size={12} className="text-[var(--muted)]" /> 
                            {formatTime(ep.last_checked_at)}
                          </span>
                        ) : <span className="text-[var(--muted)]">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {['POST', 'PUT', 'PATCH'].includes(ep.method.toUpperCase()) ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEndpointForRequest(ep);
                              }}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1"
                              title="Open Schema Request Form"
                            >
                              <PlayIcon size={12} />
                              Request Form
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  checkMutation.mutate(ep.id);
                                }}
                                disabled={checkMutation.isPending}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200 transition-colors disabled:opacity-50"
                              >
                                Check
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEndpointForRequest(ep);
                                }}
                                className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Test Request / Parameters Form"
                              >
                                <PlayIcon size={13} />
                              </button>
                            </div>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRemoveError(null);
                              setEndpointToRemove(ep);
                            }}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold border border-rose-200 transition-colors flex items-center gap-1"
                            title="Remove from Continuous Monitoring"
                          >
                            <TrashIcon size={12} />
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                  <tr>
                    <td colSpan={6} className="p-16 text-center border-dashed">
                      <Server className="mx-auto text-[var(--muted)] opacity-50 mb-4" size={48} />
                      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">No endpoints found</h3>
                      <p className="text-[var(--text-secondary)] text-sm">
                        {searchTerm ? 'Adjust your search filters.' : 'Endpoints will appear here once discovered and accepted.'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* HTTP Request Form Modal */}
      {selectedEndpointForRequest && (
        <HttpRequestModal
          isOpen={true}
          onClose={() => setSelectedEndpointForRequest(null)}
          endpoint={selectedEndpointForRequest}
        />
      )}

      {/* Remove from Monitoring Confirmation Dialog */}
      {endpointToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center flex-shrink-0">
                <TrashIcon size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Remove from Monitoring</h3>
                <p className="text-xs text-slate-500">Continuous health probes will be stopped</p>
              </div>
            </div>

            {removeError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                <AlertTriangleIcon size={14} />
                <span>{removeError}</span>
              </div>
            )}

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to remove <span className="font-mono font-bold text-slate-900">{endpointToRemove.method} {endpointToRemove.path || endpointToRemove.url}</span> from monitoring?
            </p>
            <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              Note: This removes only the continuous monitoring association. The underlying endpoint and discovery history will remain safe.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={removeMonitoringMutation.isPending}
                onClick={() => {
                  setEndpointToRemove(null);
                  setRemoveError(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removeMonitoringMutation.isPending}
                onClick={() => removeMonitoringMutation.mutate(endpointToRemove.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-all disabled:opacity-50"
              >
                {removeMonitoringMutation.isPending ? (
                  <>
                    <RefreshIcon size={14} className="animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <TrashIcon size={14} />
                    <span>Remove from Monitoring</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
