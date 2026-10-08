import { useState, useEffect } from 'react';
import { Save, Settings as SettingsIcon, Shield, Bell, Moon, Database } from 'lucide-react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export const Settings = () => {
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState({
    defaultInterval: 60,
    retentionDays: 30,
    enableNotifications: true,
    strictSsl: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem('agy_observability_settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        // ignore
      }
    }
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      localStorage.setItem('agy_observability_settings', JSON.stringify(settings));
      setIsSaving(false);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full gap-8 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Platform Settings</h2>
          <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
            Configure default thresholds, data retention policies, and platform behavior.
            (Note: These settings are currently saved locally as per the implementation plan).
          </p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={isSaving}
          className="flex items-center gap-2"
        >
          <Save size={16} />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Navigation / Sections */}
        <div className="col-span-1 flex flex-col gap-2">
          <button className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--primary-transparent)] text-[var(--primary-light)] border border-[rgba(99,102,241,0.2)] text-left font-medium">
            <SettingsIcon size={18} /> General
          </button>
          <button className="flex items-center gap-3 px-4 py-3 rounded-xl text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white transition-colors text-left font-medium">
            <Database size={18} /> Data & Retention
          </button>
          <button className="flex items-center gap-3 px-4 py-3 rounded-xl text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white transition-colors text-left font-medium">
            <Shield size={18} /> Security
          </button>
          <button className="flex items-center gap-3 px-4 py-3 rounded-xl text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white transition-colors text-left font-medium">
            <Bell size={18} /> Notifications
          </button>
        </div>

        {/* Form Area */}
        <div className="col-span-2 flex flex-col gap-6">
          <Card className="p-6">
            <h3 className="text-lg font-bold mb-6 border-b border-[var(--border-color)] pb-4">Monitoring Defaults</h3>
            
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Default Check Interval</label>
                <p className="text-xs text-[var(--text-secondary)] mb-1">
                  The standard interval applied to newly discovered endpoints.
                </p>
                <select 
                  className="bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors appearance-none"
                  value={settings.defaultInterval}
                  onChange={(e) => setSettings({...settings, defaultInterval: parseInt(e.target.value)})}
                >
                  <option value={30}>30 Seconds (Aggressive)</option>
                  <option value={60}>1 Minute (Standard)</option>
                  <option value={300}>5 Minutes (Relaxed)</option>
                </select>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                <label className="text-sm font-medium text-[var(--text-primary)]">Strict SSL Validation</label>
                <p className="text-xs text-[var(--text-secondary)] mb-1">
                  Reject endpoints with self-signed or expired SSL certificates.
                </p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-12 h-6 rounded-full transition-colors relative ${settings.strictSsl ? 'bg-[var(--primary)]' : 'bg-[rgba(255,255,255,0.1)]'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${settings.strictSsl ? 'left-7' : 'left-1'}`}></div>
                  </div>
                  <span className="text-sm font-medium">{settings.strictSsl ? 'Enabled' : 'Disabled'}</span>
                  <input type="checkbox" className="hidden" checked={settings.strictSsl} onChange={(e) => setSettings({...settings, strictSsl: e.target.checked})} />
                </label>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold mb-6 border-b border-[var(--border-color)] pb-4">Data Retention</h3>
            
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Incident History Retention</label>
                <p className="text-xs text-[var(--text-secondary)] mb-1">
                  How long to keep detailed logs of resolved incidents and recovery actions.
                </p>
                <select 
                  className="bg-[rgba(0,0,0,0.2)] border border-[var(--border-color)] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors appearance-none"
                  value={settings.retentionDays}
                  onChange={(e) => setSettings({...settings, retentionDays: parseInt(e.target.value)})}
                >
                  <option value={7}>7 Days</option>
                  <option value={30}>30 Days</option>
                  <option value={90}>90 Days</option>
                </select>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold mb-6 border-b border-[var(--border-color)] pb-4">Appearance</h3>
            
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Theme Preference</label>
                <div className="flex items-center gap-3 mt-2">
                  <div className="px-4 py-2 rounded-lg bg-[var(--primary-transparent)] border border-[var(--primary)] text-[var(--primary-light)] flex items-center gap-2 cursor-pointer font-medium text-sm">
                    <Moon size={16} /> Premium Dark
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-2">
                  Note: The UI/UX Master requirement explicitly specifies a premium dark mode.
                </p>
              </div>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
};
