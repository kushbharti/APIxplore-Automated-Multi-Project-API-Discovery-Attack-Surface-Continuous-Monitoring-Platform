import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ProjectDetails } from './pages/ProjectDetails';
import { Endpoints } from './pages/Endpoints';
import { EndpointDetails } from './pages/EndpointDetails';
import { Incidents } from './pages/Incidents';
import { Cache } from './pages/Cache';

import { Projects } from './pages/Projects';
import { AddProject } from './pages/AddProject';
import { Discovery } from './pages/Discovery';
import { DiscoveryHistory } from './pages/DiscoveryHistory';
import { Alerts } from './pages/Alerts';
import { Analytics } from './pages/Analytics';
import { SystemHealth } from './pages/SystemHealth';
import { Settings } from './pages/Settings';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        
        {/* Project Management */}
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<AddProject />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        
        {/* Discovery */}
        <Route path="discovery" element={<Discovery />} />
        <Route path="discovery/history" element={<DiscoveryHistory />} />
        
        {/* Monitoring */}
        <Route path="endpoints" element={<Endpoints />} />
        <Route path="endpoints/:id" element={<EndpointDetails />} />
        <Route path="cache" element={<Cache />} />
        
        {/* Operations */}
        <Route path="incidents" element={<Incidents />} />
        <Route path="alerts" element={<Alerts />} />
        
        {/* Analytics & Config */}
        <Route path="analytics" element={<Analytics />} />
        <Route path="system-health" element={<SystemHealth />} />
        <Route path="settings" element={<Settings />} />
      </Route>
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
