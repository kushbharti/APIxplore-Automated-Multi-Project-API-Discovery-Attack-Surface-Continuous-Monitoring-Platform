import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { OverviewStats } from '../types';
import { Activity, ServerCrash, CheckCircle, Clock, Zap, LineChart, PieChart } from 'lucide-react';
import { Card } from '../components/Card';

export const Analytics = () => {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => apiFetch<OverviewStats>('/analytics/overview'),
    refetchInterval: 30000,
  });

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Platform Analytics</h2>
          <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
            High-level metrics and health overview across all monitored endpoints and projects.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="h-32 rounded-2xl shimmer border border-[var(--border-color)]"></div>
          ))}
        </div>
      )}
      
      {error && (
        <div className="p-8 text-center text-[var(--error)] bg-[var(--error-transparent)] border border-[rgba(239,68,68,0.3)] rounded-2xl">
          Failed to load analytics data.
        </div>
      )}

      {!isLoading && stats && (
        <div className="flex flex-col gap-8">
          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            
            <Card className="p-6 flex flex-col justify-between hover:border-[var(--primary)] transition-colors group">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--primary-transparent)] flex items-center justify-center text-[var(--primary-light)] group-hover:scale-110 transition-transform">
                  <Activity size={20} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black mb-1 text-[var(--text-primary)] tracking-tight">{stats.total_endpoints}</div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">Total Endpoints</div>
              </div>
            </Card>

            <Card className="p-6 flex flex-col justify-between hover:border-[var(--success)] transition-colors group">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--success-transparent)] flex items-center justify-center text-[var(--success)] group-hover:scale-110 transition-transform">
                  <CheckCircle size={20} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black mb-1 text-[var(--text-primary)] tracking-tight">{stats.healthy_endpoints}</div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">Healthy Endpoints</div>
              </div>
            </Card>

            <Card className="p-6 flex flex-col justify-between hover:border-[var(--error)] transition-colors group">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--error-transparent)] flex items-center justify-center text-[var(--error)] group-hover:scale-110 transition-transform">
                  <ServerCrash size={20} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black mb-1 text-[var(--text-primary)] tracking-tight">{stats.down_endpoints}</div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">Down Endpoints</div>
              </div>
            </Card>

            <Card className="p-6 flex flex-col justify-between hover:border-[var(--warning)] transition-colors group">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--warning-transparent)] flex items-center justify-center text-[var(--warning)] group-hover:scale-110 transition-transform">
                  <Clock size={20} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black mb-1 text-[var(--text-primary)] tracking-tight">
                  {stats.avg_latency_24h ? `${stats.avg_latency_24h}ms` : 'N/A'}
                </div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">Avg Latency (24h)</div>
              </div>
            </Card>
            
            <Card className="p-6 flex flex-col justify-between hover:border-[var(--purple)] transition-colors group">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--purple-transparent)] flex items-center justify-center text-[var(--purple)] group-hover:scale-110 transition-transform">
                  <Zap size={20} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black mb-1 text-[var(--text-primary)] tracking-tight">
                  {stats.success_rate_24h !== null ? `${(stats.success_rate_24h * 100).toFixed(1)}%` : 'N/A'}
                </div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">Success Rate (24h)</div>
              </div>
            </Card>
            
            <Card className="p-6 flex flex-col justify-between hover:border-[var(--cyan)] transition-colors group">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--cyan-transparent)] flex items-center justify-center text-[var(--cyan)] group-hover:scale-110 transition-transform">
                  <Activity size={20} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black mb-1 text-[var(--text-primary)] tracking-tight">
                  {stats.total_checks_24h.toLocaleString()}
                </div>
                <div className="text-sm font-medium text-[var(--text-secondary)]">Checks Performed (24h)</div>
              </div>
            </Card>

            <Card className="p-6 flex flex-col justify-between col-span-1 md:col-span-2">
               <div className="flex items-center gap-3 mb-6">
                 <div className="p-2 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[var(--border-color)] text-[var(--muted)]">
                   <LineChart size={20} />
                 </div>
                 <h3 className="font-semibold text-lg text-[var(--text-primary)]">Time-Series Analytics</h3>
               </div>
               <div className="flex-1 min-h-[120px] flex items-center justify-center rounded-xl bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.02)] border-dashed text-center p-6">
                 <div>
                   <PieChart size={32} className="mx-auto mb-3 opacity-30 text-[var(--primary)]" />
                   <p className="text-[var(--text-secondary)] text-sm font-medium">Global Time-Series Aggregation Engine Pending Implementation</p>
                   <p className="text-[var(--muted)] text-xs mt-1">Navigate to specific endpoints to view granular latency charts.</p>
                 </div>
               </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
