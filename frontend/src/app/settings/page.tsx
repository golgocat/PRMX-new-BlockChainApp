'use client';

import { useState } from 'react';
import { 
  User, 
  Palette,
  Wallet,
  Save,
  Moon,
  Sun
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useWalletStore } from '@/stores/walletStore';
import { useThemeStore } from '@/stores/themeStore';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  const { theme, setTheme } = useThemeStore();
  const [saving, setSaving] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

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
        <CardContent>
          {isConnected && selectedAccount ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-background-tertiary/50">
                <p className="text-sm text-text-secondary">Address</p>
                <p className="font-medium font-mono text-sm break-all">{selectedAccount.address}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-tertiary/50">
                <p className="text-sm text-text-secondary">Network</p>
                <p className="font-medium">PRMX Testnet</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Wallet className="w-12 h-12 mx-auto mb-4 text-text-tertiary" />
              <p className="text-text-secondary mb-4">Connect your wallet to view account settings</p>
              <Button onClick={() => setShowWalletModal(true)}>
                Connect Wallet
              </Button>
              <WalletConnectionModal 
                isOpen={showWalletModal} 
                onClose={() => setShowWalletModal(false)} 
              />
            </div>
          )}
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
        <CardContent>
          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-3">
              Theme (Current: <span className="text-prmx-cyan font-mono">{theme}</span>)
            </label>
            <div className="flex gap-3">
              {[
                { value: 'light' as const, label: 'Light', icon: Sun },
                { value: 'dark' as const, label: 'Dark', icon: Moon },
              ].map((themeOption) => {
                const Icon = themeOption.icon;
                return (
                  <button
                    key={themeOption.value}
                    onClick={() => setTheme(themeOption.value)}
                    className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                      theme === themeOption.value
                        ? 'border-prmx-cyan bg-prmx-cyan/10'
                        : 'border-border-primary hover:border-prmx-cyan/50'
                    }`}
                  >
                    <Icon className="w-5 h-5 mx-auto mb-2" />
                    <p className="text-sm font-medium">{themeOption.label}</p>
                  </button>
                );
              })}
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
