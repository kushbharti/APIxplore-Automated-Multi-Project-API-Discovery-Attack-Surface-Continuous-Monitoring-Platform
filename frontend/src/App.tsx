import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LandingPage } from './pages/LandingPage';
import { Dashboard } from './pages/Dashboard';
import { EndpointDiscoveryGraph } from './pages/EndpointDiscoveryGraph';
import { ProjectDetails } from './pages/ProjectDetails';
import { Endpoints } from './pages/Endpoints';
import { EndpointDetails } from './pages/EndpointDetails';
import { Incidents } from './pages/Incidents';
import { Cache } from './pages/Cache';
import { Projects } from './pages/Projects';
import { AddProject } from './pages/AddProject';
import { Discovery } from './pages/Discovery';
import { DiscoveryHistory } from './pages/DiscoveryHistory';
import { Monitoring } from './pages/Monitoring';
import { Alerts } from './pages/Alerts';
import { Analytics } from './pages/Analytics';
import { SystemHealth } from './pages/SystemHealth';
import { Settings } from './pages/Settings';
import { TermsOfService } from './pages/TermsOfService';
import { PrivacyPolicy } from './pages/PrivacyPolicy';

function AppRoutes() {
  return (
    <Routes>
      {/* 3D Cinematic Landing Page */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<LandingPage />} />

      {/* Operational Dashboard & Workspaces within App Layout */}
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Endpoint Discovery Graph (Screenshot Re-creation & Dedicated Route) */}
        <Route path="/graph" element={<EndpointDiscoveryGraph />} />
        <Route path="/discovery/graph" element={<EndpointDiscoveryGraph />} />

        {/* Project Management */}
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={<AddProject />} />
        <Route path="/projects/:id" element={<ProjectDetails />} />

        {/* Discovery */}
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/discovery/history" element={<DiscoveryHistory />} />

        {/* Monitoring & Endpoints */}
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/endpoints" element={<Endpoints />} />
        <Route path="/endpoints/:id" element={<EndpointDetails />} />
        <Route path="/cache" element={<Cache />} />

        {/* Operations & Intelligence */}
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/alerts" element={<Alerts />} />

        {/* Analytics & Config */}
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/system-health" element={<SystemHealth />} />
        <Route path="/settings" element={<Settings />} />

        {/* Legal & Governance */}
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
