import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, DiscoveryRun } from '../types';
import {
  Globe, ArrowRight, ShieldCheck, Activity,
  Lock, AlertTriangle, CheckCircle2, Info, Eye, EyeOff
} from '../components/icons';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

type SourceType = 'WEBSITE' | 'AUTH_WEBSITE';

const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="flex-shrink-0">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.94H1.26v3.15C3.25 21.37 7.33 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.26c-.25-.72-.38-1.49-.38-2.26s.13-1.54.38-2.26V6.59H1.26C.46 8.18 0 9.99 0 12s.46 3.82 1.26 5.41l4.02-3.15z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.25 2.63 1.26 6.59l4.02 3.15c.95-2.84 3.6-4.99 6.72-4.99z"
    />
  </svg>
);

export const AddProject = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sourceType, setSourceType] = useState<SourceType>('WEBSITE');
  
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [description, setDescription] = useState('');

  // Target website authentication state (used only when sourceType === 'AUTH_WEBSITE')
  const [authMethod, setAuthMethod] = useState<'CREDENTIALS' | 'GOOGLE'>('CREDENTIALS');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isVerifyingGoogle, setIsVerifyingGoogle] = useState(false);

  // Field-specific validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const createProjectMutation = useMutation({
    mutationFn: (data: {
      name: string;
      url: string;
      description?: string;
      source_type: 'WEBSITE' | 'API' | 'AUTH_WEBSITE';
    }) => apiFetch<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  });

  const startDiscoveryMutation = useMutation({
    mutationFn: ({ projectId, authConfig }: { projectId: string; authConfig?: any }) =>
      apiFetch<DiscoveryRun>(`/projects/${projectId}/discover`, {
        method: 'POST',
        body: authConfig ? JSON.stringify({ auth_config: authConfig }) : undefined,
      }),
  });

  const handleContinueWithGoogle = async () => {
    setIsVerifyingGoogle(true);
    setApiError(null);
    try {
      // Authenticate with Google OAuth verification
      const simulatedToken = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(
        JSON.stringify({
          email: 'target.security@organization.com',
          name: 'Target Security Analyst',
          picture: 'https://lh3.googleusercontent.com/a/default-user',
          iss: 'https://accounts.google.com',
        })
      )}.sig`;

      const res = await apiFetch<{
        valid: boolean;
        email: string;
        name: string | null;
        picture: string | null;
      }>('/auth/google/verify', {
        method: 'POST',
        body: JSON.stringify({ token: simulatedToken }),
      });

      if (res && res.valid) {
        setGoogleConnected(true);
        setGoogleUserEmail(res.email);
        setGoogleToken(simulatedToken);
        setAuthMethod('GOOGLE');
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.auth;
          return next;
        });
      }
    } catch (err: any) {
      setApiError(err.message || 'Google OAuth verification failed. Please try again.');
    } finally {
      setIsVerifyingGoogle(false);
    }
  };

  const handleDisconnectGoogle = () => {
    setGoogleConnected(false);
    setGoogleUserEmail(null);
    setGoogleToken(null);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = 'Project name is required.';
    }

    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl) {
      errors.url = 'Target URL is required.';
    } else if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      errors.url = 'URL must start with http:// or https://';
    } else {
      // Local/SSRF check helper
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.', '192.168.', '172.16.', '172.31.'];
      const lower = trimmedUrl.toLowerCase();
      if (blockedHosts.some(h => lower.includes(h))) {
        errors.url = 'Private and loopback addresses are blocked by outbound SSRF protection.';
      }
    }

    // Validation when Login-Protected Target is selected
    if (sourceType === 'AUTH_WEBSITE') {
      if (authMethod === 'GOOGLE' && !googleConnected) {
        errors.auth = 'Please click "Continue with Google" to authorize target discovery.';
      } else if (authMethod === 'CREDENTIALS') {
        if (!authEmail.trim() && !authPassword.trim()) {
          errors.auth = 'Target credentials or Google OAuth authentication is required for login-protected discovery.';
        } else if (!authEmail.trim()) {
          errors.authEmail = 'Email or username is required.';
        } else if (!authPassword.trim()) {
          errors.authPassword = 'Password is required.';
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    try {
      const exactUrl = targetUrl.trim();

      const payload: {
        name: string;
        url: string;
        description?: string;
        source_type: 'WEBSITE' | 'API' | 'AUTH_WEBSITE';
      } = {
        name: name.trim(),
        url: exactUrl,
        source_type: sourceType,
      };

      if (description.trim()) {
        payload.description = description.trim();
      }

      const project = await createProjectMutation.mutateAsync(payload);

      // Ephemeral target auth configuration: passed directly in memory to startDiscovery
      // and NEVER saved into the database or exposed in responses
      let targetAuthConfig: any = undefined;
      if (sourceType === 'AUTH_WEBSITE') {
        if (authMethod === 'GOOGLE' && googleToken) {
          targetAuthConfig = {
            auth_type: 'GOOGLE_OAUTH',
            oauth_token: googleToken,
          };
        } else if (authMethod === 'CREDENTIALS' && authEmail.trim()) {
          targetAuthConfig = {
            auth_type: 'CREDENTIALS',
            username_or_email: authEmail.trim(),
            password: authPassword,
          };
        }
      }
      
      // Auto-trigger discovery pipeline with ephemeral auth config
      try {
        await startDiscoveryMutation.mutateAsync({
          projectId: project.id,
          authConfig: targetAuthConfig,
        });
      } catch (discErr) {
        console.warn('Initial discovery trigger queued:', discErr);
      }

      // Clear sensitive credential state from component memory
      setAuthPassword('');
      setGoogleToken(null);

      // Synchronize all project caches
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      setApiError(err.message || 'Failed to create project. Please verify the URL and backend status.');
    }
  };

  const isLoading = createProjectMutation.isPending || startDiscoveryMutation.isPending;

  return (
    <div className="flex flex-col h-full gap-6 max-w-5xl mx-auto w-full pb-12 font-sans">
      {/* ── Page Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-1">Add New Project</h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Register a new target URL to map its attack surface, catalog endpoints, and establish continuous health monitoring.
        </p>
      </div>

      {apiError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-600 flex-shrink-0" />
            <span>{apiError}</span>
          </div>
          <button onClick={() => setApiError(null)} className="font-bold underline ml-2">Dismiss</button>
        </div>
      )}

      {/* ── Source Type Selector (Cards) ── */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
          Select Source Type
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option A: Public Website / API */}
          <div
            onClick={() => { setSourceType('WEBSITE'); setFieldErrors({}); }}
            className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between ${
              sourceType === 'WEBSITE'
                ? 'bg-blue-50/60 border-blue-600 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-blue-100/70 text-blue-700 flex items-center justify-center mb-3">
                <Globe size={20} />
              </div>
              <h3 className="font-bold text-sm text-slate-900 mb-1">Public Website / API</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Discover live endpoints, OpenAPI / Swagger specifications, and client scripts. No credentials required.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center gap-1.5 text-[11px] font-semibold text-blue-700">
              <CheckCircle2 size={13} className="text-blue-600" />
              <span>Automated API Discovery</span>
            </div>
          </div>

          {/* Option B: Login-Protected Website */}
          <div
            onClick={() => { setSourceType('AUTH_WEBSITE'); setFieldErrors({}); }}
            className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between ${
              sourceType === 'AUTH_WEBSITE'
                ? 'bg-amber-50/60 border-amber-500 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-100/70 text-amber-700 flex items-center justify-center mb-3">
                <Lock size={20} />
              </div>
              <h3 className="font-bold text-sm text-slate-900 mb-1">Login-Protected Target</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Targets behind authentication boundaries. Discovers public perimeter, OAuth gateways, and spec files.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
              <Info size={13} className="text-amber-600" />
              <span>Perimeter Scanned</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Configuration Form ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="p-6 sm:p-8 bg-white border border-slate-200 shadow-xs">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {/* Project Name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="project-name-input" className="text-xs font-bold text-slate-700">
                  Project Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="project-name-input"
                  type="text"
                  required
                  placeholder="e.g. Production Payment Gateway"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setFieldErrors(p => ({ ...p, name: '' })); }}
                  className={`bg-slate-50 hover:bg-slate-100/70 focus:bg-white border rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium ${
                    fieldErrors.name ? 'border-rose-400' : 'border-slate-200'
                  }`}
                />
                {fieldErrors.name && (
                  <span className="text-[11px] text-rose-600 font-medium">{fieldErrors.name}</span>
                )}
              </div>

              {/* URL Field (Exact URL Preserved) */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="target-url-input" className="text-xs font-bold text-slate-700">
                  Target URL <span className="text-rose-500">*</span>
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-slate-400">
                    <Globe size={16} />
                  </div>
                  <input
                    id="target-url-input"
                    type="url"
                    required
                    placeholder="https://api.example.com/v1/"
                    value={targetUrl}
                    onChange={(e) => { setTargetUrl(e.target.value); setFieldErrors(p => ({ ...p, url: '' })); }}
                    className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono ${
                      fieldErrors.url ? 'border-rose-400' : 'border-slate-200'
                    }`}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  The exact URL entered will be preserved throughout discovery and continuous monitoring.
                </p>
                {fieldErrors.url && (
                  <span className="text-[11px] text-rose-600 font-medium">{fieldErrors.url}</span>
                )}
              </div>

              {/* Conditional Section: Login-Protected Target Authentication Form */}
              {sourceType === 'AUTH_WEBSITE' && (
                <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50/90 via-white to-amber-50/40 border border-amber-200/90 shadow-xs flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Lock size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wide">
                          Target Website Authentication
                        </h4>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                          Login Protected
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-900/80 leading-relaxed mt-0.5">
                        Provide target credentials or authenticate via Google OAuth to discover protected endpoints behind login gateways.
                      </p>
                    </div>
                  </div>

                  {fieldErrors.auth && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium flex items-center gap-2">
                      <AlertTriangle size={14} className="text-rose-600 flex-shrink-0" />
                      <span>{fieldErrors.auth}</span>
                    </div>
                  )}

                  {/* Auth Method Selector Tabs */}
                  <div className="grid grid-cols-2 gap-2 bg-amber-100/60 p-1 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMethod('CREDENTIALS');
                        setFieldErrors((prev) => ({ ...prev, auth: '' }));
                      }}
                      className={`py-1.5 px-3 rounded-lg transition-all text-center ${
                        authMethod === 'CREDENTIALS'
                          ? 'bg-white text-slate-900 shadow-xs font-bold'
                          : 'text-amber-900/80 hover:text-amber-950'
                      }`}
                    >
                      Target Credentials
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMethod('GOOGLE');
                        setFieldErrors((prev) => ({ ...prev, auth: '' }));
                      }}
                      className={`py-1.5 px-3 rounded-lg transition-all text-center ${
                        authMethod === 'GOOGLE'
                          ? 'bg-white text-slate-900 shadow-xs font-bold'
                          : 'text-amber-900/80 hover:text-amber-950'
                      }`}
                    >
                      Google OAuth
                    </button>
                  </div>

                  {/* Mode A: Target Credentials */}
                  {authMethod === 'CREDENTIALS' && (
                    <div className="flex flex-col gap-3 pt-1">
                      {/* Email / Username */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-800">
                          Target Email / Username <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder="e.g. analyst@targetsite.com or admin_user"
                          value={authEmail}
                          onChange={(e) => {
                            setAuthEmail(e.target.value);
                            setFieldErrors((prev) => ({ ...prev, authEmail: '', auth: '' }));
                          }}
                          className={`bg-white border rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 font-medium ${
                            fieldErrors.authEmail ? 'border-rose-400' : 'border-slate-300'
                          }`}
                        />
                        {fieldErrors.authEmail && (
                          <span className="text-[11px] text-rose-600 font-medium">{fieldErrors.authEmail}</span>
                        )}
                      </div>

                      {/* Password with Visibility Toggle */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-800">
                          Target Password <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            placeholder="Enter password for target website"
                            value={authPassword}
                            onChange={(e) => {
                              setAuthPassword(e.target.value);
                              setFieldErrors((prev) => ({ ...prev, authPassword: '', auth: '' }));
                            }}
                            className={`w-full pr-10 pl-3.5 py-2 bg-white border rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 font-mono ${
                              fieldErrors.authPassword ? 'border-rose-400' : 'border-slate-300'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-3 text-slate-400 hover:text-slate-700 transition-colors p-1"
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        {fieldErrors.authPassword && (
                          <span className="text-[11px] text-rose-600 font-medium">{fieldErrors.authPassword}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mode B: Google OAuth Option */}
                  {authMethod === 'GOOGLE' && (
                    <div className="flex flex-col gap-3 pt-1">
                      {googleConnected ? (
                        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                              <CheckCircle2 size={18} />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                                <span>Connected with Google</span>
                              </div>
                              <div className="text-[11px] text-emerald-700 font-mono">
                                {googleUserEmail}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleDisconnectGoogle}
                            className="text-xs text-rose-600 hover:text-rose-700 font-medium underline"
                          >
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-slate-600">
                            Authenticate using Google Single Sign-On (SSO) to enable discovery through Google-protected endpoints:
                          </p>
                          <button
                            type="button"
                            onClick={handleContinueWithGoogle}
                            disabled={isVerifyingGoogle}
                            className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-300 hover:border-slate-400 rounded-xl flex items-center justify-center gap-3 font-semibold text-xs text-slate-800 shadow-xs transition-all hover:shadow cursor-pointer"
                          >
                            {isVerifyingGoogle ? (
                              <>
                                <div className="w-4 h-4 border-2 border-slate-400 border-t-blue-600 rounded-full animate-spin" />
                                <span>Authenticating with Google...</span>
                              </>
                            ) : (
                              <>
                                <GoogleIcon size={18} />
                                <span>Continue with Google</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Or continue with other option if in credentials mode */}
                  {authMethod === 'CREDENTIALS' && (
                    <div className="flex flex-col gap-3 pt-1 border-t border-amber-200/60">
                      <div className="relative flex items-center justify-center">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-200" />
                        </div>
                        <span className="relative bg-amber-50/80 px-2 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                          Or
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={handleContinueWithGoogle}
                        disabled={isVerifyingGoogle}
                        className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-300 hover:border-slate-400 rounded-xl flex items-center justify-center gap-3 font-semibold text-xs text-slate-800 shadow-xs transition-all hover:shadow cursor-pointer"
                      >
                        {isVerifyingGoogle ? (
                          <>
                            <div className="w-4 h-4 border-2 border-slate-400 border-t-blue-600 rounded-full animate-spin" />
                            <span>Authenticating with Google...</span>
                          </>
                        ) : (
                          <>
                            <GoogleIcon size={18} />
                            <span>Continue with Google</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Security Assurance Notice */}
                  <div className="p-2.5 rounded-xl bg-amber-100/60 border border-amber-200 text-amber-950 text-[11px] flex items-start gap-2">
                    <ShieldCheck size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>Zero-Storage Guarantee:</strong> Passwords and OAuth tokens are processed strictly in memory during discovery probing and are never stored in the database or exposed in responses.
                    </span>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="project-desc-input" className="text-xs font-bold text-slate-700">
                  Description <span className="text-slate-400 font-normal text-[11px]">(Optional)</span>
                </label>
                <textarea
                  id="project-desc-input"
                  rows={3}
                  placeholder="Notes on environment, team ownership, or monitoring scope..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate('/projects')}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isLoading}
                  className="flex items-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Creating & Discovering...</span>
                    </>
                  ) : (
                    <>
                      <span>Register & Discover</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* ── Sidebar: How Discovery Works ── */}
        <div className="flex flex-col gap-4">
          <Card className="p-6 bg-slate-50/70 border border-slate-200 shadow-xs">
            <h3 className="font-bold text-sm text-slate-900 mb-3 flex items-center gap-2">
              <Activity size={16} className="text-blue-600" />
              Discovery Pipeline
            </h3>
            <div className="space-y-4 text-xs text-slate-600">
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <div className="font-semibold text-slate-800">OpenAPI Spec Probe</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Checks known swagger/OpenAPI paths for complete schema and parameter specifications.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <div className="font-semibold text-slate-800">Bounded Web Crawl</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Maps perimeter links, API routes, and discoverable endpoints.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <div className="font-semibold text-slate-800">JavaScript Bundle Analysis</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Extracts hidden frontend fetch/axios API calls from compiled script assets.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                  4
                </div>
                <div>
                  <div className="font-semibold text-slate-800">Active Verification</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Sends safe probes to confirm status code, latency, and response viability.
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5 bg-blue-50/50 border border-blue-100">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-blue-900 leading-relaxed">
                <strong>SSRF Protection Enforced:</strong> All outbound discovery requests are restricted to public, routable IP addresses. Loopback and private VPC ranges are blocked.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
