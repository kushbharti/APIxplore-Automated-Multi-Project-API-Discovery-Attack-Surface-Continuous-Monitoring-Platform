import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { Cpu, Server, Database, HardDrive, LayoutGrid, Clock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';

interface HealthComponent {
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  detail: string;
}

export const SystemHealth = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['system-health-detailed'],
    queryFn: () => apiFetch<{ components: HealthComponent[] }>('/detailed', {}, true), // using /detailed which maps to /health/detailed in api.ts
    refetchInterval: 5000,
  });

  const components = data?.components || [];
  
  const getIcon = (name: string) => {
    switch(name.toLowerCase()) {
      case 'database': return <Database size={24} />;
      case 'redis': return <HardDrive size={24} />;
      case 'scheduler': return <Clock size={24} />;
      case 'workers': return <Cpu size={24} />;
      case 'queue': return <LayoutGrid size={24} />;
      case 'discovery engine': return <ShieldCheck size={24} />;
      default: return <Server size={24} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'HEALTHY': return 'var(--success)';
      case 'DEGRADED': return 'var(--warning)';
      case 'DOWN': 
      case 'UNAVAILABLE': return 'var(--error)';
      case 'NOT_CONFIGURED': return 'var(--muted)';
      case 'UNKNOWN': return 'var(--warning)';
      default: return 'var(--muted)';
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div>
        <h2 className="text-2xl font-bold mb-2">System Health</h2>
        <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
          Real-time infrastructure status for the API Observability platform.
          Monitors internal dependencies, worker queues, and the automated discovery engine.
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-[140px] rounded-2xl shimmer border border-[var(--border-color)]"></div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-6 rounded-2xl bg-[var(--error-transparent)] border border-[rgba(239,68,68,0.3)] flex items-center gap-4 text-[var(--error)]">
          <AlertTriangle size={24} />
          <div>
            <h3 className="font-bold">Failed to load system health</h3>
            <p className="text-sm opacity-80">The health endpoint is unreachable. Backend might be down.</p>
          </div>
        </div>
      )}

      {!isLoading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {components.map((comp) => {
            const color = getStatusColor(comp.status);
            return (
              <Card key={comp.name} className="p-6 flex flex-col gap-4 border transition-colors hover:border-[var(--primary-glow)]">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg-dark)', color: 'var(--text-primary)' }}>
                    {getIcon(comp.name)}
                  </div>
                  <Badge variant={comp.status === 'HEALTHY' ? 'success' : comp.status === 'NOT_CONFIGURED' ? 'default' : comp.status === 'UNKNOWN' ? 'warning' : 'error'}>
                    {comp.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : comp.status}
                  </Badge>
                </div>
                
                <div>
                  <h3 className="text-lg font-bold mb-1">{comp.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] font-mono">
                    <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }}></span>
                    {comp.detail}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
