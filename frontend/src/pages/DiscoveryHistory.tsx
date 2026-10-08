import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun } from '../types';
import { History, Shield, CheckCircle, XCircle, Clock, AlertTriangle, ChevronRight, Activity } from 'lucide-react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Link } from 'react-router-dom';
import { formatDate } from '../utils/date';

interface EnrichedRun extends DiscoveryRun {
  project_name: string;
}

export const DiscoveryHistory = () => {
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => apiFetch<Project[]>('/projects'),
  });

  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  useEffect(() => {
    const fetchRuns = async () => {
      if (!projects || projects.length === 0) return;
      setLoadingRuns(true);
      
      try {
        const promises = projects.slice(0, 10).map(async (p) => {
          try {
            const projectRuns = await apiFetch<DiscoveryRun[]>(`/projects/${p.id}/discovery`);
            return projectRuns.map(r => ({ ...r, project_name: p.name }));
          } catch (e) {
            return [];
          }
        });
        
        const results = await Promise.all(promises);
        const allRuns = results.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setRuns(allRuns);
      } finally {
        setLoadingRuns(false);
      }
    };
    
    fetchRuns();
  }, [projects]);

  const isLoading = projectsLoading || loadingRuns;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <Badge variant="success">Completed</Badge>;
      case 'FAILED': return <Badge variant='error'>Failed</Badge>;
      case 'RUNNING': return <Badge variant="default" className="animate-pulse">Running</Badge>;
      case 'PENDING': return <Badge variant="default">Pending</Badge>;
      default: return <Badge variant="default">{status}</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle size={18} className="text-[var(--success)]" />;
      case 'FAILED': return <XCircle size={18} className="text-[var(--error)]" />;
      case 'RUNNING': return <Activity size={18} className="text-[var(--primary)]" />;
      default: return <Clock size={18} className="text-[var(--muted)]" />;
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Discovery History</h2>
          <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
            A global chronological ledger of all automated endpoint discovery runs across your projects.
          </p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden p-0 border-[var(--border-color)]">
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-[var(--border-color)] bg-[rgba(255,255,255,0.02)] text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
          <div className="col-span-3">Project</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Methods Used</div>
          <div className="col-span-3">Candidates Found</div>
          <div className="col-span-2">Started</div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading && (
            <div className="flex flex-col gap-2 p-4">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="h-16 rounded-xl shimmer border border-[var(--border-color)]"></div>
              ))}
            </div>
          )}

          {!isLoading && runs.length === 0 && (
             <div className="flex flex-col items-center justify-center p-16 text-center">
               <History size={48} className="text-[var(--muted)] mb-4 opacity-50" />
               <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1">No discovery runs found</h3>
               <p className="text-sm text-[var(--text-secondary)]">Create a project to trigger a discovery run.</p>
             </div>
          )}

          {!isLoading && runs.map((run) => (
            <Link key={run.id} to={`/projects/${run.project_id}`} className="grid grid-cols-12 gap-4 p-4 border border-transparent border-b-[var(--border-color)] hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.05)] rounded-xl transition-colors items-center text-sm group">
              <div className="col-span-3 font-medium flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.05)] flex items-center justify-center border border-[var(--border-color)] group-hover:border-[var(--primary)] transition-colors">
                  <Shield size={14} className="text-[var(--text-primary)] group-hover:text-[var(--primary)]" />
                </div>
                <span className="truncate text-white">{run.project_name}</span>
              </div>
              
              <div className="col-span-2 flex items-center gap-2">
                {getStatusIcon(run.status)}
                {getStatusBadge(run.status)}
              </div>
              
              <div className="col-span-2 flex gap-1">
                {run.openapi_checked && <span className="px-2 py-0.5 rounded bg-[rgba(52,211,153,0.1)] text-[var(--success)] text-[10px] font-bold">OAS</span>}
                {run.crawl_checked && <span className="px-2 py-0.5 rounded bg-[rgba(129,140,248,0.1)] text-[var(--primary-light)] text-[10px] font-bold">CRAWL</span>}
                {run.js_checked && <span className="px-2 py-0.5 rounded bg-[rgba(251,146,60,0.1)] text-[var(--warning)] text-[10px] font-bold">JS</span>}
                {(!run.openapi_checked && !run.crawl_checked && !run.js_checked) && <span className="text-[var(--muted)] text-xs">None</span>}
              </div>
              
              <div className="col-span-3 flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-xs text-[var(--muted)]">Total</span>
                  <span className="font-semibold text-white">{run.candidates_total}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-[var(--muted)]">Verified</span>
                  <span className="font-semibold text-[var(--success)]">{run.candidates_verified}</span>
                </div>
                {(run.candidates_blocked > 0 || run.candidates_unavailable > 0) && (
                  <div className="flex items-center justify-center w-6 h-6 rounded bg-[var(--error-transparent)] text-[var(--error)]" title={`${run.candidates_blocked} Blocked, ${run.candidates_unavailable} Unavailable`}>
                    <AlertTriangle size={12} />
                  </div>
                )}
              </div>
              
              <div className="col-span-2 text-[var(--text-secondary)] flex items-center justify-between text-xs">
                <span>{formatDate(run.created_at)}</span>
                <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--primary)]" />
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
};
