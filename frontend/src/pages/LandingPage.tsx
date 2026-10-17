import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ParticleHero3D } from '../components/ParticleHero3D';
import {
  APIxploreLogo, ArrowRightIcon, ShieldCheckIcon,
  NetworkGraphIcon, GlobeIcon, CheckCircleIcon
} from '../components/icons';

interface StoryStage {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
}

const STORY_STAGES: StoryStage[] = [
  {
    id: 'discover',
    badge: 'Stage 01 • Discovery',
    title: 'Map the Invisible Public Attack Surface',
    subtitle: 'From zero-knowledge public host to complete endpoint catalog',
    description: 'APIxplore autonomously analyzes public OpenAPI/Swagger specs, crawls same-origin links, and deconstructs client-side JavaScript bundles to expose uncataloged shadow endpoints without destructive fuzzing.',
    highlights: ['Multi-provider ingestion', 'Zero-credential public crawl', 'Client-side bundle analysis']
  },
  {
    id: 'connect',
    badge: 'Stage 02 • Connectivity',
    title: 'Autonomous Provenance & Graph Synthesis',
    subtitle: 'Every route linked to source evidence and confidence scoring',
    description: 'Endpoints are deterministically normalized, deduplicated, and mapped to exact discovery origins with cryptographic snapshot integrity.',
    highlights: ['Canonical path deduplication', 'Provenance attribution', 'Confidence rating (1-100%)']
  },
  {
    id: 'explore',
    badge: 'Stage 03 • Topology',
    title: 'Hierarchical 3D API Route Architecture',
    subtitle: 'Visualize endpoints as living, structured constellations',
    description: 'Deconstruct complex multi-tiered services into navigable trees: root hosts, nested parent gateways (/api, /products, /docs), and discrete sub-route endpoints.',
    highlights: ['Depth-indexed route trees', 'Interactive zoom & pan', 'Parameter token normalization']
  },
  {
    id: 'verify',
    badge: 'Stage 04 • Safe Verification',
    title: 'Zero-Mutation Validation Policy',
    subtitle: 'Non-destructive verification adhering strictly to security policies',
    description: 'All candidate endpoints undergo safe pre-flight validation. Dangerous mutation methods (POST, PUT, DELETE) are never automatically executed, strictly honoring SSRF and private-network safeguards.',
    highlights: ['SSRF protection engine', 'Safe-method policy enforcement', 'Private IP blocking']
  },
  {
    id: 'monitor',
    badge: 'Stage 05 • Health Monitoring',
    title: 'Continuous Synthetic Telemetry',
    subtitle: 'Asynchronous health checks, latency tracking, and error-rate budgeting',
    description: 'High-frequency distributed workers monitor response codes, P50/P95/P99 latency trends, and TLS certificates at user-defined intervals ranging from 30 seconds to 1 hour.',
    highlights: ['P95/P99 latency percentiles', 'Configurable consecutive failure rules', 'Automated degraded classification']
  },
  {
    id: 'investigate',
    badge: 'Stage 06 • Intelligence',
    title: 'Immutable Snapshots & Change Detection',
    subtitle: 'Audit surface drifts between consecutive discovery runs',
    description: 'Pinpoint newly exposed routes, decommissioned endpoints, or modified signatures. Receive in-product deduplicated alerts before anomalies become critical incidents.',
    highlights: ['Cryptographic snapshot diffing', 'NEW / REMOVED / CHANGED tracking', 'Incident lifecycle timeline']
  }
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [activeStage, setActiveStage] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Monitor scroll progression
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? Math.min(Math.max(scrollY / maxScroll, 0), 1) : 0;
      setScrollProgress(progress);

      // Determine active stage based on scroll percentage
      const stageIndex = Math.min(Math.floor(progress * 6.8), 5);
      setActiveStage(stageIndex);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (index: number) => {
    const sectionEl = document.getElementById(`story-stage-${index}`);
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div ref={containerRef} className="relative bg-[#05070a] text-[#f8fafc] min-h-screen font-sans selection:bg-blue-600 selection:text-white">
      {/* ── Fixed 3D Particle Canvas Background ── */}
      <div className="fixed inset-0 w-full h-full pointer-events-auto z-0">
        <ParticleHero3D
          scrollProgress={scrollProgress}
          activeStage={activeStage}
          className="w-full h-full"
        />

        {/* Cinematic Subtle Vignette & Gradient Overlays (Blackish to Cobalt) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 50% 30%, transparent 20%, rgba(5, 7, 10, 0.75) 75%, #05070a 100%)'
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage: 'linear-gradient(to bottom, transparent 0%, rgba(37, 99, 235, 0.05) 50%, rgba(5, 7, 10, 0.95) 100%)'
          }}
        />
      </div>

      {/* ── Cinematic Fixed Navigation Bar ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 px-6 sm:px-12 py-4 flex items-center justify-between backdrop-blur-xl border-b transition-all duration-300"
        style={{
          background: 'rgba(5, 7, 10, 0.75)',
          borderColor: 'rgba(255, 255, 255, 0.07)'
        }}
      >
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="p-1.5 rounded-xl bg-blue-900/30 border border-blue-500/40 shadow-lg shadow-blue-500/20">
            <APIxploreLogo size={24} />
          </div>
          <div>
            <div className="font-display font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
              APIxplore
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-400 border border-blue-500/30">
                v1.0
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
              Attack-Surface Intelligence
            </div>
          </div>
        </div>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-slate-300">
          <button
            onClick={() => scrollToSection(0)}
            className="hover:text-blue-400 transition-colors"
          >
            Discovery Engine
          </button>
          <button
            onClick={() => navigate('/graph')}
            className="hover:text-blue-400 transition-colors flex items-center gap-1.5"
          >
            <NetworkGraphIcon size={14} className="text-blue-500" />
            Endpoint Graph
          </button>
          <button
            onClick={() => scrollToSection(4)}
            className="hover:text-blue-400 transition-colors"
          >
            Continuous Monitoring
          </button>
          <button
            onClick={() => navigate('/system-health')}
            className="hover:text-blue-400 transition-colors"
          >
            System Architecture
          </button>
        </nav>

        {/* Right CTA Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/graph')}
            className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
          >
            Interactive Graph
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Open Dashboard
            <ArrowRightIcon size={14} />
          </button>
        </div>
      </header>

      {/* ── Fixed Chapter Progress Indicator (Floating Left) ── */}
      <div className="hidden lg:flex fixed left-8 top-1/2 -translate-y-1/2 z-40 flex-col gap-4">
        {STORY_STAGES.map((stage, idx) => (
          <button
            key={stage.id}
            onClick={() => scrollToSection(idx)}
            className="group flex items-center gap-3 text-left focus:outline-none"
          >
            <div
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                activeStage === idx
                  ? 'bg-blue-500 ring-4 ring-blue-500/20 scale-125'
                  : 'bg-slate-700 group-hover:bg-slate-500'
              }`}
            />
            <span
              className={`text-[11px] font-semibold transition-all duration-200 tracking-wide ${
                activeStage === idx
                  ? 'text-white translate-x-1'
                  : 'text-slate-500 opacity-60 group-hover:opacity-100 group-hover:text-slate-300'
              }`}
            >
              0{idx + 1} {stage.id.toUpperCase()}
            </span>
          </button>
        ))}
      </div>

      {/* ── MAIN CONTENT (Scroll-Driven Sections) ── */}
      <div className="relative z-10">
        {/* HERO SECTION */}
        <section className="min-h-screen flex flex-col justify-center items-center text-center px-6 pt-28 pb-16 max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-950/60 border border-blue-500/40 text-blue-300 text-xs font-semibold mb-6 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Continuous Multi-Project API Attack Surface Platform
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold font-display tracking-tight text-white leading-[1.08] max-w-4xl">
            Autonomous Discovery.
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-blue-200 to-white bg-clip-text text-transparent">
              Zero Blindspots.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg md:text-xl text-slate-300 max-w-2xl leading-relaxed font-normal">
            Safely discover, map, and monitor public API surfaces across distributed web properties in real-time. Continuous OpenAPI extraction, client-bundle deconstruction, and non-destructive synthetic telemetry.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-600/30 transition-all flex items-center gap-2 hover:scale-[1.02]"
            >
              Launch Dashboard
              <ArrowRightIcon size={16} />
            </button>

            <button
              onClick={() => navigate('/projects/new')}
              className="px-6 py-3.5 rounded-xl font-semibold text-sm text-slate-200 bg-white/5 hover:bg-white/10 border border-white/15 transition-all flex items-center gap-2"
            >
              <GlobeIcon size={16} className="text-blue-400" />
              Add Target Project
            </button>

            <button
              onClick={() => navigate('/graph')}
              className="px-6 py-3.5 rounded-xl font-semibold text-sm text-blue-400 bg-blue-950/40 hover:bg-blue-900/40 border border-blue-500/30 transition-all flex items-center gap-2"
            >
              <NetworkGraphIcon size={16} />
              Explore 3D Topology Graph
            </button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-3xl">
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm">
              <div className="text-2xl font-bold text-white font-display">100%</div>
              <div className="text-xs text-slate-400 mt-1">Non-Destructive</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm">
              <div className="text-2xl font-bold text-white font-display">30s - 1h</div>
              <div className="text-xs text-slate-400 mt-1">Synthetic Cadence</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm">
              <div className="text-2xl font-bold text-white font-display">4 Providers</div>
              <div className="text-xs text-slate-400 mt-1">OpenAPI, JS & Crawl</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm">
              <div className="text-2xl font-bold text-white font-display">SSRF Guard</div>
              <div className="text-xs text-slate-400 mt-1">Zero Private Probes</div>
            </div>
          </div>

          <div className="mt-12 text-slate-500 text-xs flex items-center gap-2 animate-bounce">
            <span>Scroll down to experience the 3D discovery story</span>
            <span>↓</span>
          </div>
        </section>

        {/* ── SCROLL-LINKED STORY STAGES ── */}
        {STORY_STAGES.map((stage, idx) => (
          <section
            key={stage.id}
            id={`story-stage-${idx}`}
            className="min-h-screen flex items-center justify-center px-6 py-20 max-w-5xl mx-auto"
          >
            <div
              className="w-full p-8 sm:p-12 rounded-3xl backdrop-blur-2xl border transition-all duration-500"
              style={{
                background: 'rgba(10, 14, 23, 0.82)',
                borderColor: activeStage === idx ? 'rgba(37, 99, 235, 0.4)' : 'rgba(255, 255, 255, 0.08)',
                boxShadow: activeStage === idx ? '0 20px 60px rgba(37, 99, 235, 0.15)' : 'none'
              }}
            >
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-white/10 pb-6">
                <div>
                  <span className="text-xs font-mono font-bold tracking-widest uppercase text-blue-400">
                    {stage.badge}
                  </span>
                  <h2 className="text-2xl sm:text-4xl font-bold font-display text-white mt-1">
                    {stage.title}
                  </h2>
                </div>
                <div className="text-sm font-medium text-slate-400 max-w-sm">
                  {stage.subtitle}
                </div>
              </div>

              <p className="mt-6 text-sm sm:text-base text-slate-300 leading-relaxed max-w-3xl">
                {stage.description}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {stage.highlights.map((h, hIdx) => (
                  <span
                    key={hIdx}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-950/40 border border-blue-500/20 text-xs font-medium text-blue-300"
                  >
                    <CheckCircleIcon size={13} className="text-blue-400" />
                    {h}
                  </span>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-mono">
                  Stage {idx + 1} of 6 • 3D Particle Swarm Active
                </span>
                <button
                  onClick={() => navigate('/graph')}
                  className="inline-flex items-center gap-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View in Endpoint Graph →
                </button>
              </div>
            </div>
          </section>
        ))}

        {/* ── FINAL SECTION: ENTER THE PRODUCT ── */}
        <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 py-20 max-w-4xl mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 mb-6 shadow-2xl shadow-blue-500/30">
            <ShieldCheckIcon size={32} />
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold font-display text-white">
            Operational Attack Surface Command
          </h2>

          <p className="mt-4 text-base text-slate-300 max-w-xl">
            Transition directly from interactive 3D simulation into production attack-surface management. No accounts, zero friction.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-8 py-4 rounded-xl font-bold text-base text-white bg-blue-600 hover:bg-blue-500 shadow-2xl shadow-blue-600/40 transition-all hover:scale-[1.03] flex items-center gap-2.5"
            >
              Enter Dashboard
              <ArrowRightIcon size={18} />
            </button>

            <button
              onClick={() => navigate('/graph')}
              className="px-8 py-4 rounded-xl font-semibold text-base text-slate-200 bg-white/10 hover:bg-white/15 border border-white/20 transition-all flex items-center gap-2.5"
            >
              <NetworkGraphIcon size={18} className="text-blue-400" />
              Open Discovery Graph
            </button>
          </div>

          {/* Footer Navigation */}
          <div className="mt-20 pt-8 border-t border-white/10 w-full flex flex-wrap items-center justify-between text-xs text-slate-500 gap-4">
            <div>© 2026 APIxplore Platform • Continuous API Attack Surface Intelligence</div>
            <div className="flex items-center gap-6">
              <button onClick={() => navigate('/terms')} className="hover:text-slate-300 transition-colors">
                Terms of Service
              </button>
              <button onClick={() => navigate('/privacy')} className="hover:text-slate-300 transition-colors">
                Privacy Policy
              </button>
              <button onClick={() => navigate('/system-health')} className="hover:text-slate-300 transition-colors">
                System Health
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
