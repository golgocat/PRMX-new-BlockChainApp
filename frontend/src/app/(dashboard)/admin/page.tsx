'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useOcwHealth } from '@/hooks/useOcwHealth';
import { OcwHealthCard } from '@/components/admin/OcwHealthCard';
import { OracleKeyStatus } from '@/components/admin/OracleKeyStatus';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { useState } from 'react';

export default function AdminDashboardPage() {
  const router = useRouter();
  const isDao = useIsDao();
  const { isConnected } = useWalletStore();
  const { healthData, loading, error, refresh } = useOcwHealth();
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Redirect non-DAO users
  useEffect(() => {
    if (isConnected && !isDao) {
      router.push('/dashboard');
    }
  }, [isConnected, isDao, router]);

  if (!isConnected) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">Admin</Badge>
          </div>
          <h1 className="text-3xl font-bold">System Health</h1>
          <p className="text-text-secondary mt-1">DAO operator dashboard for system monitoring</p>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your DAO wallet to access the admin dashboard
            </p>
            <Button onClick={() => setShowWalletModal(true)}>
              Connect Wallet
            </Button>
            <WalletConnectionModal 
              isOpen={showWalletModal} 
              onClose={() => setShowWalletModal(false)} 
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isDao) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto pt-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">Admin</Badge>
          </div>
          <h1 className="text-3xl font-bold">System Health</h1>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-error" />
            <h3 className="text-lg font-semibold mb-2">Access Denied</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              This dashboard is only accessible to DAO administrators.
            </p>
            <Button onClick={() => router.push('/dashboard')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto pt-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="purple" className="text-xs">Admin</Badge>
          <Badge variant="cyan" className="text-xs">DAO Only</Badge>
        </div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-text-secondary mt-1">Monitor OCW health and system status</p>
      </div>

      {/* OCW Health Status */}
      <OcwHealthCard healthData={healthData} loading={loading} />

      {/* Oracle Key Injections */}
      <OracleKeyStatus />

      {/* Error State */}
      {error && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-error/10 border border-error/30">
              <AlertCircle className="w-5 h-5 text-error mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-error mb-1">Failed to Load Health Status</p>
                <p className="text-sm text-text-secondary">{error}</p>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={refresh}
                  className="mt-3"
                >
                  Retry
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

