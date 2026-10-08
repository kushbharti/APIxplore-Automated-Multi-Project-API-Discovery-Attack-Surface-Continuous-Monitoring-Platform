import { useState } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ShieldAlert, Clock, Activity, AlertOctagon, Filter, ShieldCheck, FileText, CheckCircle2, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../utils/date';

export const Incidents = () => {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => apiFetch<any[]>('/incidents?limit=100'),
    refetchInterval: 10000,
  });

  const filteredIncidents = incidents?.filter((inc: any) => {
    const matchStatus = filterStatus === 'ALL' || inc.status === filterStatus;
    const matchSeverity = filterSeverity === 'ALL' || inc.severity === filterSeverity;
    const matchSearch = (inc.title || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                        (inc.endpoint_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchStatus && matchSeverity && matchSearch;
  });

  const activeIncidentId = selectedIncidentId || (filteredIncidents && filteredIncidents.length > 0 ? filteredIncidents[0].id : null);
  const activeIncident = filteredIncidents?.find((i: any) => i.id === activeIncidentId);

  const { data: recoveryActions, isLoading: actionsLoading } = useQuery({
    queryKey: ['incidents', activeIncidentId, 'recovery-actions'],
    queryFn: () => apiFetch<any[]>(`/incidents/${activeIncidentId}/recovery-actions`),
    enabled: !!activeIncidentId,
    refetchInterval: 10000,
  });

  return (
    <div className="flex flex-col gap-6 h-full pb-10 animate-fade-in max-w-7xl mx-auto">
      <div className="flex justify-between items-center mt-2">
        <div>
          <h3 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--error-transparent)] flex items-center justify-center text-[var(--error)]">
              <ShieldAlert size={20} />
            </div>
            Incident Response
          </h3>
          <p className="text-[var(--text-secondary)] mt-2 max-w-2xl text-sm">
            Investigate system anomalies, review automated recovery actions, and monitor active downtime.
          </p>
        </div>
      </div>

      <div className="flex gap-4 items-center bg-[var(--bg-card)] p-4 rounded-2xl border border-[var(--border-color)] shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] rounded-xl px-3 py-2 focus-within:border-[var(--primary)] transition-colors">
          <Search size={16} className="text-[var(--text-secondary)]" />
          <input 
            type="text" 
            placeholder="Search incidents..." 
            className="bg-transparent border-none outline-none text-sm w-full text-[var(--text-primary)] placeholder-[var(--muted)]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-3 ml-auto">
          <Filter size={16} className="text-[var(--text-secondary)]" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="RESOLVED">Resolved</option>
          </select>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[600px]">
        {/* Incident List */}
        <Card className="col-span-1 flex flex-col p-0 overflow-hidden border-[var(--border-color)] shadow-lg h-full">
          <div className="p-4 border-b bg-[rgba(255,255,255,0.02)]" style={{ borderColor: 'var(--border-color)' }}>
            <h4 className="font-semibold text-sm">Incident Feed</h4>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 flex flex-col gap-3">
                {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl shimmer border border-[var(--border-color)]" />)}
              </div>
            ) : filteredIncidents && filteredIncidents.length > 0 ? (
              <div className="flex flex-col">
                {filteredIncidents.map((inc: any) => (
                  <div 
                    key={inc.id} 
                    onClick={() => setSelectedIncidentId(inc.id)}
                    className={`p-4 border-b cursor-pointer transition-all ${activeIncidentId === inc.id ? 'bg-[rgba(99,102,241,0.1)] border-l-4 border-l-[var(--primary)]' : 'hover:bg-[rgba(255,255,255,0.02)] border-l-4 border-l-transparent'}`} 
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {inc.severity === 'CRITICAL' ? <AlertOctagon size={14} className="text-[var(--error)]" /> :
                         inc.severity === 'HIGH' ? <ShieldAlert size={14} className="text-[var(--warning)]" /> :
                         <ShieldAlert size={14} className="text-[var(--cyan)]" />}
                        <span className="text-xs font-semibold uppercase tracking-wider" style={{
                          color: inc.severity === 'CRITICAL' ? 'var(--error)' : inc.severity === 'HIGH' ? 'var(--warning)' : 'var(--cyan)'
                        }}>{inc.severity}</span>
                      </div>
                      <Badge variant={inc.status === 'RESOLVED' ? 'success' : 'error'}>{inc.status}</Badge>
                    </div>
                    <h5 className="font-semibold text-sm text-[var(--text-primary)] mb-1 truncate">{inc.title || 'System Anomaly'}</h5>
                    <p className="text-xs text-[var(--muted)]">{formatDate(inc.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-16 text-center flex flex-col items-center">
                <ShieldCheck size={48} className="text-[var(--muted)] opacity-30 mb-4" />
                <p className="text-sm text-[var(--text-secondary)]">No incidents match the filters.</p>
              </div>
            )}
          </div>
        </Card>

        {/* Incident Details & Timeline */}
        <Card className="col-span-2 flex flex-col p-0 shadow-lg border-[var(--border-color)] h-full overflow-hidden">
          {activeIncident ? (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-6 border-b border-[var(--border-color)] bg-[rgba(255,255,255,0.02)] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 rounded-full -mr-20 -mt-20 opacity-10 pointer-events-none" style={{ background: `radial-gradient(circle, ${activeIncident.status === 'RESOLVED' ? 'var(--success)' : 'var(--error)'} 0%, transparent 70%)` }} />
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <h2 className="text-2xl font-bold text-[var(--text-primary)] max-w-[80%]">{activeIncident.title || 'System Anomaly'}</h2>
                    <Badge variant={activeIncident.status === 'ACTIVE' ? 'error' : 'success'}>
                      {activeIncident.status === 'ACTIVE' ? 'Investigating' : 'Resolved'}
                    </Badge>
                  </div>
                  
                  <div className="flex flex-wrap gap-6 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase font-bold text-[var(--muted)] tracking-widest">Endpoint</span>
                      <button onClick={() => navigate(`/endpoints/${activeIncident.endpoint_id}`)} className="text-[var(--primary-light)] hover:underline flex items-center gap-1 font-mono">
                        <Activity size={14} /> {activeIncident.endpoint_name || 'Unknown'}
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase font-bold text-[var(--muted)] tracking-widest">Started</span>
                      <span className="text-[var(--text-primary)] flex items-center gap-1">
                        <Clock size={14} className="text-[var(--muted)]" /> {formatDate(activeIncident.created_at)}
                      </span>
                    </div>
                    {activeIncident.resolved_at && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold text-[var(--muted)] tracking-widest">Resolved</span>
                        <span className="text-[var(--text-primary)] flex items-center gap-1">
                          <CheckCircle2 size={14} className="text-[var(--success)]" /> {formatDate(activeIncident.resolved_at)}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {activeIncident.description && (
                    <div className="mt-6 p-4 bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-secondary)]">
                      {activeIncident.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline */}
              <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-dark)]">
                <h4 className="font-semibold mb-6 flex items-center gap-2 text-sm text-[var(--text-primary)]">
                  <FileText size={16} className="text-[var(--primary-light)]" /> Recovery Timeline
                </h4>
                
                <div className="relative pl-4 border-l-2 border-[var(--border-color)] ml-4 flex flex-col gap-6">
                  
                  {actionsLoading ? (
                    <p className="text-[var(--text-secondary)] text-sm ml-4">Loading timeline events...</p>
                  ) : recoveryActions && recoveryActions.length > 0 ? (
                    recoveryActions.map((action: any) => (
                      <div key={action.id} className="relative">
                        <div className={`absolute -left-[25px] w-4 h-4 rounded-full border-2 border-[var(--bg-dark)] ${
                          action.action_type === 'FALLBACK' ? 'bg-[var(--warning)]' : 'bg-[var(--primary)]'
                        } shadow-md`}></div>
                        <div className="ml-4 p-4 rounded-xl border border-[var(--border-color)] bg-[rgba(255,255,255,0.02)]">
                          <div className="flex justify-between items-start mb-2">
                            <h5 className="font-bold text-sm text-[var(--text-primary)]">{action.action_type}</h5>
                            <time className="text-xs text-[var(--muted)] font-mono">{new Date(action.created_at).toLocaleTimeString()}</time>
                          </div>
                          <p className="text-sm text-[var(--text-secondary)]">{action.details || 'Automated system action executed'}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="relative">
                       <div className="absolute -left-[25px] w-4 h-4 rounded-full border-2 border-[var(--bg-dark)] bg-[var(--error)] shadow-md"></div>
                      <div className="ml-4 p-4 rounded-xl border border-[var(--border-color)] bg-[rgba(255,255,255,0.02)]">
                        <div className="flex justify-between items-start mb-2">
                          <h5 className="font-bold text-sm text-[var(--text-primary)]">Incident Logged</h5>
                          <time className="text-xs text-[var(--muted)] font-mono">{new Date(activeIncident.created_at).toLocaleTimeString()}</time>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)]">Incident was detected and logged by the monitoring engine.</p>
                      </div>
                    </div>
                  )}
                  
                  {activeIncident.status === 'RESOLVED' && activeIncident.resolved_at && (
                    <div className="relative mt-2">
                       <div className="absolute -left-[25px] w-4 h-4 rounded-full border-2 border-[var(--bg-dark)] bg-[var(--success)] shadow-md"></div>
                      <div className="ml-4 p-4 rounded-xl border border-[rgba(16,185,129,0.3)] bg-[var(--success-transparent)]">
                        <div className="flex justify-between items-start mb-2">
                          <h5 className="font-bold text-sm text-[var(--success)]">Incident Resolved</h5>
                          <time className="text-xs text-[var(--success)] opacity-80 font-mono">{new Date(activeIncident.resolved_at).toLocaleTimeString()}</time>
                        </div>
                        <p className="text-sm text-[var(--success)] opacity-90">System recovered and stabilized. Normal operations resumed.</p>
                      </div>
                    </div>
                  )}
                  
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)]">
              <Activity size={48} className="mb-4 opacity-30" />
              <p>Select an incident to view its detailed timeline</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
