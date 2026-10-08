import { useState } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { HardDrive, Trash2 } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

export const Cache = () => {
  const [resource, setResource] = useState('');

  const { data: policies, isLoading } = useQuery({
    queryKey: ['cachePolicies'],
    queryFn: () => apiFetch<any[]>('/cache/policies'),
  });

  const invalidateMutation = useMutation({
    mutationFn: (res: string) => apiFetch(`/cache/resource/${res}`, { method: 'DELETE' }),
    onSuccess: (_, res) => {
      alert(`Invalidated cache for: ${res}`);
      setResource('');
    },
    onError: () => {
      alert(`Failed to invalidate cache for: ${resource}`);
    }
  });

  const handleInvalidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (resource) {
      invalidateMutation.mutate(resource);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold">Intelligent Cache Management</h3>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center gap-3 mb-6 pb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <HardDrive className="text-[var(--primary)]" />
            <h4 className="font-semibold text-lg text-[var(--text-primary)]">Cache Policies</h4>
          </div>
          <div className="flex flex-col gap-4">
            {isLoading ? (
              <p className="text-[var(--text-secondary)] text-sm">Loading policies...</p>
            ) : policies && policies.length > 0 ? (
              policies.map(p => (
                <div key={p.resource} className="flex justify-between items-center p-3 bg-[var(--bg-card)] rounded border border-[var(--border-color)]">
                  <div>
                    <span className="font-mono text-sm text-[var(--text-primary)]">{p.resource}</span>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">Priority: {p.priority}</p>
                    {p.fallback_enabled && <p className="text-xs text-[var(--success)] mt-1">Fallback Enabled</p>}
                  </div>
                  <span className="text-sm font-medium text-[var(--text-primary)]">{p.ttl_seconds}s TTL</span>
                </div>
              ))
            ) : (
              <p className="text-[var(--text-secondary)] text-sm">No policies found.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3 mb-6 pb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <Trash2 className="text-[var(--error)]" />
            <h4 className="font-semibold text-lg text-[var(--text-primary)]">Manual Invalidation</h4>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            Force invalidate user-specific cache by resource name. This will bypass the policy TTL.
          </p>
          <form onSubmit={handleInvalidate} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text-primary)]">Resource Name</label>
              <input 
                type="text" 
                value={resource}
                onChange={e => setResource(e.target.value)}
                placeholder="e.g. profile" 
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary)] transition-colors"
                required
              />
            </div>
            <Button 
              type="submit" 
              variant="danger" 
              className="mt-2"
              disabled={invalidateMutation.isPending || !resource}
            >
              {invalidateMutation.isPending ? 'Invalidating...' : 'Invalidate Cache'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
