import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun } from '../types';
import { Globe, ArrowRight, ShieldCheck, Activity, Search, GitBranch, Link } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

type SourceType = 'WEBSITE' | 'GITHUB_REPOSITORY';

export const AddProject = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sourceType, setSourceType] = useState<SourceType>('WEBSITE');
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    description: '',
    deployment_url: '',
  });
  const [errorMsg, setErrorMsg] = useState('');

  const isGitHub = sourceType === 'GITHUB_REPOSITORY';

  const createProjectMutation = useMutation({
    mutationFn: (data: {
      name: string;
      url: string;
      description: string;
      source_type: SourceType;
      deployment_url?: string;
    }) => apiFetch<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  });

  const startDiscoveryMutation = useMutation({
    mutationFn: (projectId: string) => apiFetch<DiscoveryRun>(`/projects/${projectId}/discover`, {
      method: 'POST',
    }),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.name || !formData.url) {
      setErrorMsg('Name and URL are required.');
      return;
    }

    if (!formData.url.startsWith('http://') && !formData.url.startsWith('https://')) {
      setErrorMsg('URL must start with http:// or https://');
      return;
    }

    if (isGitHub && !formData.url.includes('github.com/')) {
      setErrorMsg('GitHub Repository URL must be a valid github.com repository URL (e.g. https://github.com/owner/repo)');
      return;
    }

    if (!isGitHub) {
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.', '192.168.', '172.'];
      const urlLower = formData.url.toLowerCase();
      if (blockedHosts.some(h => urlLower.includes(h))) {
        setErrorMsg('Private/local URLs are not allowed for security reasons (SSRF protection).');
        return;
      }
    }

    try {
      const payload: Record<string, string> = {
        name: formData.name,
        url: formData.url,
        description: formData.description,
        source_type: sourceType,
      };
      if (isGitHub && formData.deployment_url) {
        payload.deployment_url = formData.deployment_url;
      }

      const project = await createProjectMutation.mutateAsync(payload as any);
      await startDiscoveryMutation.mutateAsync(project.id);

      queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create project.');
    }
  };

  const isLoading = createProjectMutation.isPending || startDiscoveryMutation.isPending;

  return (
    <div className="flex flex-col h-full gap-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Add New Project</h2>
          <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
            Register a new API, Web Application, or GitHub Repository. We will automatically discover and catalog its endpoints.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-4">
        {/* Helper Panel */}
        <div className="col-span-1 flex flex-col gap-6">
          {/* Source Type Toggle */}
          <Card className="p-5">
            <h3 className="font-bold text-[var(--text-primary)] mb-3 text-sm uppercase tracking-wide">Source Type</h3>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setSourceType('WEBSITE')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all text-sm ${
                  sourceType === 'WEBSITE'
                    ? 'border-[var(--primary)] bg-[var(--primary-transparent)] text-[var(--primary-light)]'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary-glow)]'
                }`}
              >
                <Globe size={16} />
                <div>
                  <div className="font-medium">Website / API</div>
                  <div className="text-[10px] opacity-70">Crawl live deployment</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSourceType('GITHUB_REPOSITORY')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all text-sm ${
                  sourceType === 'GITHUB_REPOSITORY'
                    ? 'border-[var(--primary)] bg-[var(--primary-transparent)] text-[var(--primary-light)]'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary-glow)]'
                }`}
              >
                <GitBranch size={16} />
                <div>
                  <div className="font-medium">GitHub Repository</div>
                  <div className="text-[10px] opacity-70">Analyze source code</div>
                </div>
              </button>
            </div>
          </Card>

          <Card className="p-5 border-dashed border-[var(--primary-glow)] bg-[var(--primary-transparent)]">
            <h3 className="font-bold text-[var(--primary-light)] mb-3 flex items-center gap-2 text-sm">
              <Search size={16} />
              {isGitHub ? 'Source Code Analysis' : 'Automated Discovery'}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {isGitHub
                ? 'We analyze your repository\'s source code to detect route definitions for FastAPI, Flask, Django, Express, and Next.js. No cloning — uses the GitHub API.'
                : 'Our engines search for OpenAPI specs, crawl accessible routes, and parse client-side JavaScript bundles to map the entire API surface automatically.'}
            </p>
          </Card>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
              <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] flex items-center justify-center text-[var(--success)]">
                <ShieldCheck size={16} />
              </div>
              {isGitHub ? 'Public repos only' : 'SSRF Protection Enabled'}
            </div>
            <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
              <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[var(--border-color)] flex items-center justify-center text-[var(--primary-light)]">
                <Activity size={16} />
              </div>
              Real-time Analysis
            </div>
          </div>
        </div>

        {/* Form Panel */}
        <Card className="col-span-2 p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">

            {errorMsg && (
              <div className="p-4 rounded-xl bg-[var(--error-transparent)] border border-[rgba(239,68,68,0.3)] text-[var(--error)] text-sm">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">Project Name</label>
              <input
                type="text"
                required
                placeholder={isGitHub ? 'e.g. My API Repository' : 'e.g. Production Billing API'}
                className="bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                {isGitHub ? 'GitHub Repository URL' : 'Target URL'}
              </label>
              <p className="text-xs text-[var(--text-secondary)] mb-1">
                {isGitHub
                  ? 'Must be a public GitHub repository (e.g. https://github.com/owner/repo)'
                  : 'The root URL where the API is hosted.'}
              </p>
              <div className="relative flex items-center">
                <div className="absolute left-4 text-[var(--muted)]">
                  {isGitHub ? <GitBranch size={18} /> : <Globe size={18} />}
                </div>
                <input
                  type="url"
                  required
                  placeholder={isGitHub ? 'https://github.com/owner/repo' : 'https://api.example.com'}
                  className="bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-xl pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors w-full"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                />
              </div>
            </div>

            {isGitHub && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">
                  Deployment URL <span className="text-[var(--muted)] font-normal">(Optional)</span>
                </label>
                <p className="text-xs text-[var(--text-secondary)] mb-1">
                  The live URL where this repo is deployed. If provided, discovered routes will be verified against it.
                </p>
                <div className="relative flex items-center">
                  <div className="absolute left-4 text-[var(--muted)]">
                    <Link size={18} />
                  </div>
                  <input
                    type="url"
                    placeholder="https://my-api.example.com (optional)"
                    className="bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-xl pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors w-full"
                    value={formData.deployment_url}
                    onChange={(e) => setFormData({ ...formData, deployment_url: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">Description <span className="text-[var(--muted)] font-normal">(Optional)</span></label>
              <textarea
                placeholder="Briefly describe the purpose of this project..."
                className="bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors min-h-[80px] resize-y"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="pt-4 flex justify-end">
              <Button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-2 px-6"
              >
                {isLoading ? 'Initializing...' : `Create & Start ${isGitHub ? 'Analysis' : 'Discovery'}`}
                {!isLoading && <ArrowRight size={16} />}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
};
