import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import {
  CheckCircleIcon, ClockIcon, AlertOctagonIcon, PlayIcon,
  PauseIcon, RefreshIcon, SearchIcon, TrashIcon, AlertTriangleIcon
} from '../components/icons';
import { HttpRequestModal } from '../components/HttpRequestModal';
import { formatTime } from '../utils/date';

interface Endpoint {
  id: string;
  name: string;
  url: string;
  path: string;
  method: string;
  enabled: boolean;
  health_state: string;
  check_interval_seconds: number;
  timeout_ms: number;
  failure_threshold: number;
  latency_threshold_ms: number;
  last_checked_at: string | null;
}

export const Monitoring: React.FC = () => {
  const queryClient = useQueryClient();
  const [filterHealth, setFilterHealth] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [selectedEndpointForRequest, setSelectedEndpointForRequest] = useState<Endpoint | null>(null);
  const [endpointToRemove, setEndpointToRemove] = useState<Endpoint | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Fetch real endpoints from backend
  const { data: endpoints = [], isLoading, error } = useQuery<Endpoint[]>({
    queryKey: ['endpoints'],
    queryFn: () => apiFetch('/endpoints')
  });

  // Manual Check Now mutation
  const checkMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/endpoints/${id}/checks`, { method: 'POST' }),
    onSuccess: () => {
      setActionFeedback(`Manual health check queued for endpoint`);
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      setTimeout(() => setActionFeedback(null), 3000);
    },
    onError: (err: any) => {
      setActionFeedback(`Failed to queue check: ${err.message}`);
      setTimeout(() => setActionFeedback(null), 4000);
    }
  });

  // Toggle monitoring enable/disable
  const toggleMonitoringMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/endpoints/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
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

  const filteredEndpoints = endpoints.filter(ep => {
    const matchesHealth = filterHealth === 'all' || ep.health_state?.toLowerCase() === filterHealth.toLowerCase();
    const matchesSearch = !search || ep.url.toLowerCase().includes(search.toLowerCase()) || ep.method.toLowerCase().includes(search.toLowerCase());
    return matchesHealth && matchesSearch;
  });

  const stats = {
    total: endpoints.length,
    healthy: endpoints.filter(e => e.health_state === 'healthy' || e.health_state === 'HEALTHY').length,
    degraded: endpoints.filter(e => e.health_state === 'degraded' || e.health_state === 'DEGRADED').length,
    down: endpoints.filter(e => e.health_state === 'down' || e.health_state === 'DOWN').length,
    enabled: endpoints.filter(e => e.enabled).length,
    paused: endpoints.filter(e => !e.enabled).length
  };

  const getMethodBadge = (m: string) => {
    switch (m.toUpperCase()) {
      case 'GET': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'POST': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'PUT': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'DELETE': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getHealthBadge = (state: string) => {
    switch (state?.toUpperCase()) {
      case 'HEALTHY':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200"><CheckCircleIcon size={12} /> Healthy</span>;
      case 'DEGRADED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200"><ClockIcon size={12} /> Degraded</span>;
      case 'DOWN':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200"><AlertOctagonIcon size={12} /> Down</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">Unknown</span>;
    }
  };

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 bg-blue-600 rounded-full" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Continuous Health Monitoring</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 ml-3.5">
            Operational telemetry, scheduled synthetic probes, and real-time failure budgeting
          </p>
        </div>

        {actionFeedback && (
          <div className="px-4 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium animate-fade-in">
            {actionFeedback}
          </div>
        )}
      </div>

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">Monitored Endpoints</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
        </div>
        <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-100 shadow-xs">
          <div className="text-xs text-emerald-700 font-medium">Healthy</div>
          <div className="text-2xl font-bold text-emerald-800 mt-1">{stats.healthy}</div>
        </div>
        <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-100 shadow-xs">
          <div className="text-xs text-amber-700 font-medium">Degraded</div>
          <div className="text-2xl font-bold text-amber-800 mt-1">{stats.degraded}</div>
        </div>
        <div className="p-4 rounded-xl bg-red-50/60 border border-red-100 shadow-xs">
          <div className="text-xs text-red-700 font-medium">Down</div>
          <div className="text-2xl font-bold text-red-800 mt-1">{stats.down}</div>
        </div>
        <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 shadow-xs">
          <div className="text-xs text-blue-700 font-medium">Active Schedule</div>
          <div className="text-2xl font-bold text-blue-800 mt-1">{stats.enabled}</div>
        </div>
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">Paused</div>
          <div className="text-2xl font-bold text-slate-700 mt-1">{stats.paused}</div>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3 w-full sm:w-auto flex-1 max-w-md">
          <div className="relative w-full">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by URL or method..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={filterHealth}
            onChange={(e) => setFilterHealth(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">All States</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="down">Down</option>
          </select>
        </div>

        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['endpoints'] })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
        >
          <RefreshIcon size={13} />
          Refresh Status
        </button>
      </div>

      {/* Endpoints Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading monitoring inventory...</div>
        ) : error ? (
          <div className="p-12 text-center text-xs text-red-600">Failed to load monitored endpoints. Backend offline.</div>
        ) : filteredEndpoints.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            No monitored endpoints matching current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Method & URL</th>
                  <th className="py-3 px-4">Health State</th>
                  <th className="py-3 px-4">Interval</th>
                  <th className="py-3 px-4">Timeout</th>
                  <th className="py-3 px-4">Last Check</th>
                  <th className="py-3 px-4">Schedule</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredEndpoints.map(ep => (
                  <tr key={ep.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${getMethodBadge(ep.method)}`}>
                          {ep.method}
                        </span>
                        <span className="font-mono text-slate-900 font-medium truncate max-w-sm">
                          {ep.url}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">{getHealthBadge(ep.health_state)}</td>
                    <td className="py-3 px-4 font-mono">{ep.check_interval_seconds || 60}s</td>
                    <td className="py-3 px-4 font-mono">{ep.timeout_ms || 5000}ms</td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {ep.last_checked_at ? formatTime(ep.last_checked_at) : 'Pending'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        ep.enabled ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {ep.enabled ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {['POST', 'PUT', 'PATCH'].includes(ep.method.toUpperCase()) ? (
                          <button
                            onClick={() => setSelectedEndpointForRequest(ep)}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1"
                            title="Open Schema Request Form"
                          >
                            <PlayIcon size={12} />
                            Request Form
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => checkMutation.mutate(ep.id)}
                              disabled={checkMutation.isPending}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200 transition-colors disabled:opacity-50"
                            >
                              Check Now
                            </button>
                            <button
                              onClick={() => setSelectedEndpointForRequest(ep)}
                              className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Test Request / Parameters Form"
                            >
                              <PlayIcon size={13} />
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => toggleMonitoringMutation.mutate({ id: ep.id, enabled: !ep.enabled })}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                          title={ep.enabled ? 'Pause monitoring' : 'Resume monitoring'}
                        >
                          {ep.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                        </button>

                        <button
                          onClick={() => {
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
