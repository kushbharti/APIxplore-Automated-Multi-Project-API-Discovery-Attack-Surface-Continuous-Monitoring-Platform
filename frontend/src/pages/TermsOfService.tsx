import React from 'react';
import { InfoIcon, FileTextIcon } from '../components/icons';

export const TermsOfService: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 text-slate-800 font-sans">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
          <FileTextIcon size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Terms of Service</h1>
          <p className="text-xs text-slate-500 mt-0.5">APIxplore Continuous Attack Surface Intelligence Platform • Version 1.0</p>
        </div>
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-slate-700">
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">1. Permitted Use & Safe Discovery Contract</h2>
          <p>
            APIxplore is designed strictly for authorized reconnaissance, inventory cataloging, and continuous health monitoring of public web applications. You must own or have explicit written permission to probe any domain or URL added to the platform.
          </p>
          <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
            <InfoIcon size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <span>
              The platform implements hardcoded server-side Server-Side Request Forgery (SSRF) filters. Internal destinations, private subnets (RFC 1918), link-local addresses, and loopback devices are strictly blocked by design.
            </span>
          </div>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">2. Zero-Mutation Policy</h2>
          <p>
            Automated discovery probes adhere to non-destructive RFC 7231 safe-method standards. Under no circumstances will automated discovery runs trigger destructive or mutation HTTP verbs (POST, PUT, PATCH, DELETE) without explicit manual verification.
          </p>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">3. Accuracy of Attack Surface Intelligence</h2>
          <p>
            Endpoint discovery is inherently best-effort and bounded by crawler depth and JavaScript token parsing limits. Discovery results represent observed exposures, not an exhaustive inventory or vulnerability assessment. A detected endpoint does not constitute an actionable security flaw without evidence.
          </p>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">4. Single-Instance Deployment & Network Trust</h2>
          <p>
            This software is provided for trusted internal networks. In accordance with platform security specifications, no credentials or multi-tenant user accounts are maintained. The operator is responsible for securing physical and network-level access to the deployment.
          </p>
        </section>
      </div>
    </div>
  );
};
