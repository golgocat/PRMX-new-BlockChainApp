'use client';

import { useState } from 'react';
import { 
  Settings, 
  User, 
  Bell, 
  Shield,
  Palette,
  Globe,
  Wallet,
  Save,
  Moon,
  Sun,
  Monitor
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useWalletStore } from '@/stores/walletStore';
import { formatAddress } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  const [saving, setSaving] = useState(false);
  
  // Settings state
  const [notifications, setNotifications] = useState({
    policyUpdates: true,
    settlementAlerts: true,
    lpActivity: true,
    marketNews: false,
    email: '',
  });
  
  const [display, setDisplay] = useState({
    theme: 'dark',
    currency: 'USD',
    language: 'en',
  });

  const handleSave = async () => {
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast.success('Settings saved successfully');
    setSaving(false);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-text-secondary mt-1">Manage your account and preferences</p>
      </div>

      {/* Account Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-prmx-cyan/10 flex items-center justify-center">
              <User className="w-5 h-5 text-prmx-cyan" />
            </div>
            <div>
              <h2 className="font-semibold">Account</h2>
              <p className="text-sm text-text-secondary">Wallet and identity settings</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected && selectedAccount ? (
            <>
              <div className="p-4 rounded-xl bg-background-tertiary/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-prmx-gradient flex items-center justify-center">
                      <span className="text-lg font-bold text-white">
                        {selectedAccount.name?.[0] || 'A'}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold">{selectedAccount.name || 'Account'}</p>
                      <p className="text-sm text-text-secondary font-mono">
                        {formatAddress(selectedAccount.address, 12)}
                      </p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm">
                    <Wallet className="w-4 h-4 mr-2" />
                    Change Wallet
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-background-tertiary/50">
                  <p className="text-sm text-text-secondary">Source</p>
                  <p className="font-medium">{selectedAccount.source}</p>
                </div>
                <div className="p-4 rounded-xl bg-background-tertiary/50">
                  <p className="text-sm text-text-secondary">Network</p>
                  <p className="font-medium">PRMX Testnet</p>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <Wallet className="w-12 h-12 mx-auto mb-4 text-text-tertiary" />
              <p className="text-text-secondary mb-4">Connect your wallet to manage account settings</p>
              <Button onClick={() => useWalletStore.getState().connect()}>
                Connect Wallet
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notifications Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-prmx-purple/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-prmx-purple-light" />
            </div>
            <div>
              <h2 className="font-semibold">Notifications</h2>
              <p className="text-sm text-text-secondary">Configure how you receive alerts</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {[
              { key: 'policyUpdates', label: 'Policy Updates', desc: 'Get notified about your policy status changes' },
              { key: 'settlementAlerts', label: 'Settlement Alerts', desc: 'Receive alerts when policies are settled' },
              { key: 'lpActivity', label: 'LP Activity', desc: 'Notifications about LP token trades and distributions' },
              { key: 'marketNews', label: 'Market News', desc: 'Updates about new markets and changes' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-background-tertiary/50">
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-text-secondary">{item.desc}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={notifications[item.key as keyof typeof notifications] as boolean}
                    onChange={(e) => setNotifications({ ...notifications, [item.key]: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-background-secondary rounded-full peer peer-checked:bg-prmx-cyan peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                </label>
              </div>
            ))}
          </div>
          
          <div className="pt-4 border-t border-border-secondary">
            <Input
              label="Email for notifications (optional)"
              type="email"
              placeholder="your@email.com"
              value={notifications.email}
              onChange={(e) => setNotifications({ ...notifications, email: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Display Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <Palette className="w-5 h-5 text-success" />
            </div>
            <div>
              <h2 className="font-semibold">Display</h2>
              <p className="text-sm text-text-secondary">Customize your experience</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-3">Theme</label>
            <div className="flex gap-3">
              {[
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'system', label: 'System', icon: Monitor },
              ].map((theme) => {
                const Icon = theme.icon;
                return (
                  <button
                    key={theme.value}
                    onClick={() => setDisplay({ ...display, theme: theme.value })}
                    className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                      display.theme === theme.value
                        ? 'border-prmx-cyan bg-prmx-cyan/10'
                        : 'border-border-primary hover:border-prmx-cyan/50'
                    }`}
                  >
                    <Icon className="w-5 h-5 mx-auto mb-2" />
                    <p className="text-sm font-medium">{theme.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Currency & Language */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Currency</label>
              <select
                className="select-field"
                value={display.currency}
                onChange={(e) => setDisplay({ ...display, currency: e.target.value })}
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="PHP">PHP (₱)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Language</label>
              <select
                className="select-field"
                value={display.language}
                onChange={(e) => setDisplay({ ...display, language: e.target.value })}
              >
                <option value="en">English</option>
                <option value="fil">Filipino</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h2 className="font-semibold">Security</h2>
              <p className="text-sm text-text-secondary">Protect your account</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-xl bg-background-tertiary/50">
              <div>
                <p className="font-medium">Transaction Signing</p>
                <p className="text-sm text-text-secondary">Always confirm transactions in your wallet</p>
              </div>
              <span className="text-success text-sm font-medium">Enabled</span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-background-tertiary/50">
              <div>
                <p className="font-medium">Auto-disconnect</p>
                <p className="text-sm text-text-secondary">Disconnect wallet after 30 minutes of inactivity</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-background-secondary rounded-full peer peer-checked:bg-prmx-cyan peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} icon={<Save className="w-5 h-5" />}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
