import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project } from '../types';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Folder, Activity } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';

export const Projects = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => apiFetch<Project[]>('/projects'),
  });

  const filteredProjects = projects?.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.url.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'HEALTHY': return 'var(--success)';
      case 'DEGRADED': return 'var(--warning)';
      case 'DOWN': return 'var(--error)';
      default: return 'var(--muted)';
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Projects</h2>
          <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
            Manage your API observability projects. A project represents a root API domain or website.
          </p>
        </div>
        <Button onClick={() => navigate('/projects/new')} className="flex items-center gap-2">
          <Plus size={16} /> New Project
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4 bg-[var(--bg-card)] p-4 rounded-2xl border border-[var(--border-color)]">
        <div className="flex items-center gap-2 flex-1 max-w-md bg-[var(--bg-dark)] border border-[var(--border-color)] rounded-xl px-3 py-2 focus-within:border-[var(--primary)] transition-colors">
          <Search size={16} className="text-[var(--text-secondary)]" />
          <input 
            type="text" 
            placeholder="Search projects by name or URL..." 
            className="bg-transparent border-none outline-none text-sm w-full text-[var(--text-primary)] placeholder-[var(--muted)]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <div key={i} className="h-48 rounded-2xl shimmer border border-[var(--border-color)]"></div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-8 text-center text-[var(--error)] bg-[var(--error-transparent)] border border-[rgba(239,68,68,0.3)] rounded-2xl">
          Failed to load projects. Ensure the backend is running.
        </div>
      )}

      {!isLoading && !error && filteredProjects.length === 0 && (
         <Card className="flex flex-col items-center justify-center p-16 text-center border-dashed">
           <Folder size={48} className="text-[var(--muted)] mb-4 opacity-50" />
           <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">No projects found</h3>
           <p className="text-sm text-[var(--text-secondary)] mb-6">
             {searchTerm ? 'No projects match your search.' : 'Get started by creating your first API monitoring project.'}
           </p>
           {!searchTerm && (
             <Button onClick={() => navigate('/projects/new')}>Create Project</Button>
           )}
         </Card>
      )}

      {!isLoading && filteredProjects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            const statusColor = getStatusColor(project.status);
            return (
              <Link key={project.id} to={`/projects/${project.id}`} className="block group">
                <Card className="p-6 h-full flex flex-col hover:border-[var(--primary)] transition-colors relative overflow-hidden">
                  {/* Status Indicator Bar */}
                  <div className="absolute top-0 left-0 w-full h-1" style={{ background: statusColor }}></div>
                  
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[var(--border-color)]" style={{ background: 'var(--bg-dark)' }}>
                        <Folder size={20} className="text-[var(--primary-light)] group-hover:scale-110 transition-transform" />
                      </div>
                      <div>
                        <h3 className="font-bold text-[var(--text-primary)] group-hover:text-white transition-colors">{project.name}</h3>
                        <p className="text-xs text-[var(--text-secondary)] truncate max-w-[180px]">{project.url}</p>
                      </div>
                    </div>
                    <Badge variant={project.status === 'HEALTHY' ? 'success' : project.status === 'DEGRADED' ? 'warning' : project.status === 'DOWN' ? 'error' : 'default'}>
                      {project.status}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-[var(--text-secondary)] mb-6 flex-1">
                    {project.description || 'No description provided.'}
                  </p>
                  
                  <div className="grid grid-cols-3 gap-4 border-t border-[var(--border-color)] pt-4 mt-auto">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold flex items-center gap-1">
                        <Activity size={10} /> Endpoints
                      </span>
                      <span className="font-semibold">{project.endpoint_count}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold flex items-center gap-1 text-[var(--success)]">
                        <Activity size={10} /> Healthy
                      </span>
                      <span className="font-semibold">{project.healthy_count}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold flex items-center gap-1 text-[var(--error)]">
                        <Activity size={10} /> Down
                      </span>
                      <span className="font-semibold">{project.down_count}</span>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
