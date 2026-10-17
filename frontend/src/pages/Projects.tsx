import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun } from '../types';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Search, Folder, Globe,
  NetworkGraphIcon, Trash2, ArrowRight, RefreshCw, AlertOctagon
} from '../components/icons';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';

export const Projects = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Synchronized with global ['projects'] cache key
  const { data: projects = [], isLoading, error, refetch } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/projects'),
    refetchInterval: 10000,
  });

  // Discovery trigger mutation
  const triggerDiscoveryMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiFetch<DiscoveryRun>(`/projects/${projectId}/discover`, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['discovery-runs'] });
      navigate(`/projects/${data.project_id}`);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to start discovery.');
    }
  });

  // Delete project mutation
  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiFetch(`/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDeletingProjectId(null);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to delete project.');
    }
  });

  const filteredProjects = projects.filter(p => {
    const matchesSearch = !searchTerm ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.url.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
    const matchesSource = sourceFilter === 'ALL' || p.source_type === sourceFilter;
    return matchesSearch && matchesStatus && matchesSource;
  });

  const getStatusBadge = (status: Project['status']) => {
    switch (status) {
      case 'HEALTHY':
        return <Badge variant="success">Healthy</Badge>;
      case 'DEGRADED':
        return <Badge variant="warning">Degraded</Badge>;
      case 'DOWN':
        return <Badge variant="error">Down</Badge>;
      default:
        return <Badge variant="default">Unknown</Badge>;
    }
  };

  const handleDeleteConfirm = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project? All associated monitored endpoints and discovery history will be permanently deleted.')) {
      setDeletingProjectId(projectId);
      await deleteProjectMutation.mutateAsync(projectId);
    }
  };

  const handleTriggerDiscovery = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    await triggerDiscoveryMutation.mutateAsync(projectId);
  };

  return (
    <div className="flex flex-col h-full gap-6 max-w-7xl mx-auto w-full pb-12">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Projects</h1>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {projects.length} Total
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Manage your API attack surface targets. Each project scopes continuous discovery runs, endpoints, and health telemetry.
          </p>
        </div>
        <Button onClick={() => navigate('/projects/new')} className="flex items-center gap-2 self-start sm:self-auto">
          <Plus size={16} /> New Project
        </Button>
      </div>

      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-800 text-xs">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="font-bold underline ml-2">Dismiss</button>
        </div>
      )}

      {/* ── Toolbar: Search & Filters ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-blue-500 focus-within:bg-white transition-colors">
          <Search size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search projects by name or exact URL..."
            className="bg-transparent border-none outline-none text-xs w-full text-slate-800 placeholder-slate-400 font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium hidden sm:inline">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="ALL">All Status</option>
              <option value="HEALTHY">Healthy</option>
              <option value="DEGRADED">Degraded</option>
              <option value="DOWN">Down</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </div>

          {/* Source Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium hidden sm:inline">Source:</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="ALL">All Sources</option>
              <option value="WEBSITE">Website</option>
              <option value="API">API Target</option>
            </select>
          </div>

          {(searchTerm || statusFilter !== 'ALL' || sourceFilter !== 'ALL') && (
            <button
              onClick={() => { setSearchTerm(''); setStatusFilter('ALL'); setSourceFilter('ALL'); }}
              className="text-xs text-blue-600 font-semibold hover:underline px-2 py-1"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Loading Skeleton ── */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-64 rounded-2xl bg-white border border-slate-200 p-6 animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-2/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              </div>
              <div className="h-12 bg-slate-100 rounded-lg my-4" />
              <div className="grid grid-cols-4 gap-2 mt-auto">
                <div className="h-8 bg-slate-100 rounded" />
                <div className="h-8 bg-slate-100 rounded" />
                <div className="h-8 bg-slate-100 rounded" />
                <div className="h-8 bg-slate-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Error State ── */}
      {error && (
        <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-2xl text-rose-800">
          <AlertOctagon size={32} className="mx-auto mb-2 text-rose-600" />
          <h3 className="font-bold text-base mb-1">Failed to load projects</h3>
          <p className="text-xs text-rose-600 mb-4 max-w-sm mx-auto">
            Unable to communicate with the backend service. Ensure APIxplore backend is running on port 8000.
          </p>
          <Button onClick={() => refetch()} className="text-xs">
            Retry Loading
          </Button>
        </div>
      )}

      {/* ── Empty State ── */}
      {!isLoading && !error && filteredProjects.length === 0 && (
        <Card className="flex flex-col items-center justify-center p-16 text-center border-dashed border-slate-300 bg-white">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-4">
            <Folder size={32} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">
            {searchTerm || statusFilter !== 'ALL' || sourceFilter !== 'ALL'
              ? 'No projects match your filter criteria'
              : 'No monitored projects yet'}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mb-6">
            {searchTerm || statusFilter !== 'ALL' || sourceFilter !== 'ALL'
              ? 'Try relaxing your search terms or clearing your status/source filters.'
              : 'Register an API or Web Application to start automated attack surface discovery.'}
          </p>
          {searchTerm || statusFilter !== 'ALL' || sourceFilter !== 'ALL' ? (
            <Button
              onClick={() => { setSearchTerm(''); setStatusFilter('ALL'); setSourceFilter('ALL'); }}
              className="text-xs"
            >
              Clear Filters
            </Button>
          ) : (
            <Button onClick={() => navigate('/projects/new')} className="flex items-center gap-2">
              <Plus size={16} /> Add Your First Project
            </Button>
          )}
        </Card>
      )}

      {/* ── Projects Cards Grid ── */}
      {!isLoading && filteredProjects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            const unknownCount = project.unknown_count ?? Math.max(0, project.endpoint_count - (project.healthy_count + project.degraded_count + project.down_count));

            return (
              <div
                key={project.id}
                className="bg-white border border-slate-200 rounded-2xl shadow-xs hover:border-blue-400 hover:shadow-md transition-all flex flex-col overflow-hidden group"
              >
                {/* Card Header */}
                <div className="p-5 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-blue-50 text-blue-600 border border-blue-100">
                        <Globe size={18} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-sm truncate text-slate-900 leading-tight" title={project.name}>
                          {project.name}
                        </h3>
                        {/* Exact target URL preserved without truncation or modifications */}
                        <p className="text-[11px] truncate text-slate-500 font-mono mt-0.5" title={project.url}>
                          {project.url}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(project.status)}
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-2 min-h-[32px] mt-1">
                    {project.description || 'Target cataloged for automated continuous API discovery.'}
                  </p>
                </div>

                {/* Endpoint Counts by Health (Scoped to Project) */}
                <div className="px-3 py-3 bg-slate-50/70 border-y border-slate-100 grid grid-cols-5 gap-1 text-center mt-auto">
                  <div className="flex flex-col py-1 bg-white rounded-lg border border-slate-200/60">
                    <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold">Total</span>
                    <span className="font-extrabold text-xs text-slate-900">{project.endpoint_count}</span>
                  </div>
                  <div className="flex flex-col py-1 bg-emerald-50/50 rounded-lg border border-emerald-100/60">
                    <span className="text-[8px] uppercase tracking-wider text-emerald-600 font-bold">Healthy</span>
                    <span className="font-extrabold text-xs text-emerald-700">{project.healthy_count}</span>
                  </div>
                  <div className="flex flex-col py-1 bg-amber-50/50 rounded-lg border border-amber-100/60">
                    <span className="text-[8px] uppercase tracking-wider text-amber-600 font-bold">Degraded</span>
                    <span className="font-extrabold text-xs text-amber-700">{project.degraded_count}</span>
                  </div>
                  <div className="flex flex-col py-1 bg-rose-50/50 rounded-lg border border-rose-100/60">
                    <span className="text-[8px] uppercase tracking-wider text-rose-600 font-bold">Down</span>
                    <span className="font-extrabold text-xs text-rose-700">{project.down_count}</span>
                  </div>
                  <div className="flex flex-col py-1 bg-slate-100/70 rounded-lg border border-slate-200/60">
                    <span className="text-[8px] uppercase tracking-wider text-slate-500 font-bold">Unknown</span>
                    <span className="font-extrabold text-xs text-slate-600">{unknownCount}</span>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="p-3.5 px-5 flex items-center justify-between gap-2 bg-white">
                  <div className="flex items-center gap-1.5">
                    {/* View Graph */}
                    <button
                      onClick={() => navigate(`/graph?project=${project.id}`)}
                      title="View Attack Surface Graph"
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100 text-xs flex items-center gap-1 font-semibold"
                    >
                      <NetworkGraphIcon size={14} />
                      <span className="hidden sm:inline text-[11px]">Graph</span>
                    </button>

                    {/* Trigger Discovery */}
                    <button
                      onClick={(e) => handleTriggerDiscovery(e, project.id)}
                      disabled={triggerDiscoveryMutation.isPending}
                      title="Trigger Fresh Discovery Run"
                      className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-transparent hover:border-emerald-100 text-xs flex items-center gap-1 font-semibold disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={triggerDiscoveryMutation.isPending ? 'animate-spin' : ''} />
                      <span className="hidden sm:inline text-[11px]">Scan</span>
                    </button>

                    {/* Delete Project */}
                    <button
                      onClick={(e) => handleDeleteConfirm(e, project.id)}
                      disabled={deletingProjectId === project.id}
                      title="Delete Project"
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors text-xs disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Primary Inspect Link */}
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Inspect <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
