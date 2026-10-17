import React from 'react';
import { ShieldCheckIcon, ShieldIcon } from '../components/icons';

export const PrivacyPolicy: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 text-slate-800 font-sans">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
          <ShieldIcon size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Privacy & Data Governance Policy</h1>
          <p className="text-xs text-slate-500 mt-0.5">APIxplore Continuous Attack Surface Intelligence Platform • Version 1.0</p>
        </div>
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-slate-700">
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">1. Minimal Telemetry Collection</h2>
          <p>
            APIxplore stores strictly operational telemetry: endpoint URLs, HTTP methods, HTTP response status codes, round-trip elapsed latency (ms), and response byte lengths.
          </p>
          <div className="mt-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
            <ShieldCheckIcon size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <span>
              By default, response bodies and payload data are discarded immediately following schema parsing. Sensitive user records and response data are never persisted in the database.
            </span>
          </div>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">2. Local Storage & Zero Third-Party Tracking</h2>
          <p>
            No external analytics, tracking pixels, or third-party behavioral beacons are embedded in this product. All operational records, discovery runs, and incident logs remain contained within your local PostgreSQL / SQLite database container.
          </p>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">3. Immutable Snapshots & Cryptographic Diffing</h2>
          <p>
            Discovery runs capture immutable snapshots of discovered attack surfaces to facilitate change detection across time. Snapshot comparisons are evaluated on-premise without exposing discovery deltas to external networks.
          </p>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-base font-bold text-slate-900 mb-2">4. Incident & Evidence Retention</h2>
          <p>
            Incident records preserve chronological status lifecycles and check failure evidence solely for diagnostic auditability. Logs may be cleared or archived through administrative database management.
          </p>
        </section>
      </div>
    </div>
  );
};
