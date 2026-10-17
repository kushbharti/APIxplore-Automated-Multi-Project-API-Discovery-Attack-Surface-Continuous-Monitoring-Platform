import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun } from '../types';
import {
  History, CheckCircle, XCircle, Clock, AlertTriangle,
  ChevronRight, Activity, Search, RefreshCw, NetworkGraphIcon,
  Globe, ArrowRight, AlertOctagon
} from '../components/icons';
import { Card } from '../components/Card';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate } from '../utils/date';

interface EnrichedRun extends DiscoveryRun {
  project_name: string;
  project_url: string;
  source_type?: string;
}

export const DiscoveryHistory = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState('ALL');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Synchronized with global ['projects']
  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/projects'),
  });

  // Query discovery runs across projects
  const {
    data: allRuns = [],
    isLoading: runsLoading,
    error: runsError,
    refetch: refetchRuns
  } = useQuery<EnrichedRun[]>({
    queryKey: ['discovery-history', projects.map(p => p.id).join(',')],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const fetchList = projects.slice(0, 20); // Top projects
      const runPromises = fetchList.map(async (p) => {
        try {
          const runs = await apiFetch<DiscoveryRun[]>(`/projects/${p.id}/discovery?limit=10`);
          return runs.map(r => ({
            ...r,
            project_name: p.name,
            project_url: p.url,
            source_type: p.source_type,
          }));
        } catch {
          return [];
        }
      });
      const results = await Promise.all(runPromises);
      return results.flat().sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    enabled: projects.length > 0,
    refetchInterval: 12000,
  });

  const isLoading = projectsLoading || runsLoading;

  // Filtered runs
  const filteredRuns = useMemo(() => {
    return allRuns.filter(r => {
      const q = searchTerm.toLowerCase();
      const matchesSearch = !q ||
        r.project_name.toLowerCase().includes(q) ||
        r.project_url.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
      const matchesProject = selectedProjectId === 'ALL' || r.project_id === selectedProjectId;

      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [allRuns, searchTerm, statusFilter, selectedProjectId]);

  // Visually distinct status badge & indicator
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle size={13} className="text-emerald-600 flex-shrink-0" />
            COMPLETED
          </span>
        );
      case 'PARTIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
            PARTIAL
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle size={13} className="text-rose-600 flex-shrink-0" />
            FAILED
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <Activity size={13} className="text-blue-600 flex-shrink-0 animate-spin" />
            RUNNING
          </span>
        );
      case 'QUEUED':
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <Clock size={13} className="text-slate-500 flex-shrink-0" />
            {status}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  const calculateDuration = (start?: string | null, end?: string | null) => {
    if (!start) return '—';
    if (!end) return 'In progress';
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const diffSec = Math.max(1, Math.round((e - s) / 1000));
    if (diffSec < 60) return `${diffSec}s`;
    const min = Math.floor(diffSec / 60);
    const rem = diffSec % 60;
    return `${min}m ${rem}s`;
  };

  return (
    <div className="flex flex-col h-full gap-6 max-w-7xl mx-auto w-full pb-12 font-sans">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Discovery History</h1>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {allRuns.length} Runs Recorded
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Audit trail of all automated crawler executions, OpenAPI parsing jobs, and AST repository inspections.
          </p>
        </div>

        <button
          onClick={() => refetchRuns()}
          className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-xs transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {/* ── Toolbar: Search & Filters ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-blue-500 focus-within:bg-white transition-colors">
          <Search size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search by project name, exact target URL, or run ID..."
            className="bg-transparent border-none outline-none text-xs w-full text-slate-800 placeholder-slate-400 font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="PARTIAL">Partial</option>
              <option value="FAILED">Failed</option>
              <option value="RUNNING">Running</option>
              <option value="QUEUED">Queued / Pending</option>
            </select>
          </div>

          {/* Project Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium">Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 max-w-[180px] truncate"
            >
              <option value="ALL">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {(searchTerm || statusFilter !== 'ALL' || selectedProjectId !== 'ALL') && (
            <button
              onClick={() => { setSearchTerm(''); setStatusFilter('ALL'); setSelectedProjectId('ALL'); }}
              className="text-xs text-blue-600 font-bold hover:underline px-2 py-1"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Table / Cards Container ── */}
      <Card className="flex-1 flex flex-col p-0 border border-slate-200 shadow-xs bg-white rounded-2xl overflow-hidden">
        {/* Table Header */}
        <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-3.5 bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-3">Project & Target URL</div>
          <div className="col-span-2">Execution State</div>
          <div className="col-span-2">Discovery Providers</div>
          <div className="col-span-3">Surface Inventory</div>
          <div className="col-span-2 text-right">Timestamp & Actions</div>
        </div>

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="flex flex-col gap-3 p-5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-20 rounded-xl bg-slate-50 border border-slate-200 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error State */}
        {runsError && (
          <div className="p-12 text-center text-rose-700 bg-rose-50/50">
            <AlertOctagon size={36} className="mx-auto mb-2 text-rose-600" />
            <h3 className="font-bold text-base mb-1">Failed to query discovery history</h3>
            <p className="text-xs text-rose-600 mb-4">Ensure the APIxplore backend database is initialized and accessible.</p>
            <button
              onClick={() => refetchRuns()}
              className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !runsError && filteredRuns.length === 0 && (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3">
              <History size={28} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {searchTerm || statusFilter !== 'ALL' || selectedProjectId !== 'ALL'
                ? 'No matching discovery runs found'
                : 'No discovery runs recorded yet'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mb-4">
              {searchTerm || statusFilter !== 'ALL' || selectedProjectId !== 'ALL'
                ? 'Try broadening your search term or clearing the active filters.'
                : 'Run a discovery on any project to start mapping its endpoints and security telemetry.'}
            </p>
            <button
              onClick={() => navigate('/projects')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
            >
              Go to Projects
            </button>
          </div>
        )}

        {/* Rows */}
        {!isLoading && !runsError && filteredRuns.length > 0 && (
          <div className="divide-y divide-slate-100 overflow-y-auto">
            {filteredRuns.map((run) => {
              const isExpanded = expandedRunId === run.id;

              return (
                <div
                  key={run.id}
                  className={`transition-colors ${isExpanded ? 'bg-blue-50/20' : 'hover:bg-slate-50/70'}`}
                >
                  <div
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="p-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 items-center cursor-pointer select-none"
                  >
                    {/* Project & Target URL */}
                    <div className="lg:col-span-3 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-100/70 text-blue-700">
                          <Globe size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-slate-900 truncate" title={run.project_name}>
                            {run.project_name}
                          </div>
                          {/* Exact target URL preserved */}
                          <div className="text-[11px] text-slate-500 font-mono truncate" title={run.project_url}>
                            {run.project_url}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Status Indicator */}
                    <div className="lg:col-span-2 flex items-center gap-2">
                      {getStatusBadge(run.status)}
                    </div>

                    {/* Methods / Providers Used */}
                    <div className="lg:col-span-2 flex flex-wrap gap-1 items-center">
                      {run.openapi_checked && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200" title="OpenAPI / Swagger Spec Probed">
                          OAS
                        </span>
                      )}
                      {run.crawl_checked && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200" title="HTML / Endpoint Web Crawler">
                          CRAWL
                        </span>
                      )}
                      {run.js_checked && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200" title="Client JavaScript Analyzer">
                          JS
                        </span>
                      )}
                      {!run.openapi_checked && !run.crawl_checked && !run.js_checked && (
                        <span className="text-[11px] text-slate-400 font-medium">Standard</span>
                      )}
                    </div>

                    {/* Discovered Surface Metrics */}
                    <div className="lg:col-span-3 flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Total</span>
                        <span className="text-xs font-extrabold text-slate-900">{run.candidates_total}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-600">Verified</span>
                        <span className="text-xs font-extrabold text-emerald-700">{run.candidates_verified}</span>
                      </div>
                      {run.candidates_unavailable > 0 && (
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-wider font-bold text-amber-600">Unavail</span>
                          <span className="text-xs font-extrabold text-amber-700">{run.candidates_unavailable}</span>
                        </div>
                      )}
                      {run.candidates_blocked > 0 && (
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-wider font-bold text-rose-600">Blocked</span>
                          <span className="text-xs font-extrabold text-rose-700">{run.candidates_blocked}</span>
                        </div>
                      )}
                    </div>

                    {/* Timestamp & Actions */}
                    <div className="lg:col-span-2 flex items-center justify-between lg:justify-end gap-3 text-xs">
                      <div className="text-right">
                        <div className="font-semibold text-slate-800 text-[11px]">{formatDate(run.created_at)}</div>
                        <div className="text-[10px] text-slate-400">Duration: {calculateDuration(run.started_at, run.completed_at)}</div>
                      </div>
                      <ChevronRight
                        size={16}
                        className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90 text-blue-600' : ''}`}
                      />
                    </div>
                  </div>

                  {/* ── Expandable Details Drawer ── */}
                  {isExpanded && (
                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200/80 text-xs flex flex-col gap-3 animate-fade-in">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600">
                          <span>Run ID: <strong className="text-slate-900">{run.id}</strong></span>
                          <span>•</span>
                          <span>Project ID: <strong className="text-slate-900">{run.project_id}</strong></span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Link
                            to={`/graph?project=${run.project_id}`}
                            className="flex items-center gap-1 px-3 py-1 bg-white border border-slate-200 hover:border-blue-300 rounded-lg text-blue-600 font-bold transition-all text-xs shadow-xs"
                          >
                            <NetworkGraphIcon size={13} /> View in Graph
                          </Link>
                          <Link
                            to={`/projects/${run.project_id}`}
                            className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-bold transition-all text-xs shadow-xs"
                          >
                            Project Details <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>

                      {/* Error Banner if Failed */}
                      {run.error_message && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2">
                          <AlertTriangle size={15} className="text-rose-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold">Execution Error Details</div>
                            <div className="font-mono mt-0.5">{run.error_message}</div>
                          </div>
                        </div>
                      )}

                      {/* Discovered Specs & Details */}
                      {run.openapi_found && run.openapi_url && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle size={15} className="text-emerald-600 flex-shrink-0" />
                            <span>OpenAPI Specification Detected: <strong className="font-mono">{run.openapi_url}</strong></span>
                          </div>
                          <a
                            href={run.openapi_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold underline text-emerald-900 text-xs"
                          >
                            Open Spec ↗
                          </a>
                        </div>
                      )}

                      {/* Progress State (if Running / Queued) */}
                      {run.progress_state && (
                        <div className="p-3 bg-white border border-slate-200 rounded-xl">
                          <div className="font-bold text-slate-700 mb-1 text-[11px] uppercase tracking-wider">Engine State</div>
                          <div className="text-slate-600 font-mono text-[11px]">
                            Step: <strong className="text-blue-600">{run.progress_state.step}</strong> · Updated {formatDate(run.progress_state.timestamp)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
