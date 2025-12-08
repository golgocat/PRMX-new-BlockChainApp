'use client';

import { useState } from 'react';
import { 
  Shield, 
  Plus, 
  Search, 
  Clock,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { formatUSDT, formatTimeRemaining, formatDate, formatCoordinates, formatAddress } from '@/lib/utils';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useMyPolicies, usePolicies, useMarkets } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function PoliciesPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  const isDao = useIsDao();
  
  const { policies: myPolicies, loading: myLoading, refresh: refreshMy } = useMyPolicies();
  const { policies: allPolicies, loading: allLoading, refresh: refreshAll } = usePolicies();
  const { markets } = useMarkets();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('my');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [settlingPolicy, setSettlingPolicy] = useState<number | null>(null);

  const policies = activeTab === 'my' ? myPolicies : allPolicies;
  const loading = activeTab === 'my' ? myLoading : allLoading;

  const getMarketName = (marketId: number) => {
    const market = markets.find(m => m.id === marketId);
    return market?.name || `Market #${marketId}`;
  };

  const filteredPolicies = policies.filter((policy) => {
    const marketName = getMarketName(policy.marketId);
    return marketName.toLowerCase().includes(searchQuery.toLowerCase()) ||
           policy.holder.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const now = Math.floor(Date.now() / 1000);
  const activePolicies = policies.filter(p => p.status === 'Active' && p.coverageEnd > now);
  const settledPolicies = policies.filter(p => p.status === 'Settled');
  const expiredPolicies = policies.filter(p => p.status === 'Active' && p.coverageEnd <= now);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (activeTab === 'my') {
      await refreshMy();
    } else {
      await refreshAll();
    }
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleSettlePolicy = async (policyId: number, eventOccurred: boolean) => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect your wallet');
      return;
    }

    setSettlingPolicy(policyId);
    try {
      await api.settlePolicy(keypair, policyId, eventOccurred);
      toast.success(`Policy #${policyId} settled successfully!`);
      handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to settle policy');
    } finally {
      setSettlingPolicy(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Policies</h1>
          <p className="text-text-secondary mt-1">Manage insurance coverage</p>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to view and manage insurance policies
            </p>
            <Button onClick={() => useWalletStore.getState().connect()}>
              Connect Wallet
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Policies</h1>
          <p className="text-text-secondary mt-1">
            {isDao ? 'Manage all policies on the platform' : 'Manage your insurance coverage'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          {!isDao && (
            <Link href="/policies/new">
              <Button icon={<Plus className="w-5 h-5" />}>
                Get Coverage
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          title={activeTab === 'my' ? 'My Policies' : 'Total Policies'}
          value={loading ? '...' : policies.length}
          icon={<Shield className="w-5 h-5" />}
        />
        <StatCard
          title="Active"
          value={loading ? '...' : activePolicies.length}
          icon={<CheckCircle2 className="w-5 h-5" />}
          iconColor="bg-success/10 text-success"
        />
        <StatCard
          title="Expired (Unsettled)"
          value={loading ? '...' : expiredPolicies.length}
          icon={<Clock className="w-5 h-5" />}
          iconColor="bg-warning/10 text-warning"
        />
        <StatCard
          title="Settled"
          value={loading ? '...' : settledPolicies.length}
          icon={<XCircle className="w-5 h-5" />}
          iconColor="bg-text-tertiary/10 text-text-tertiary"
        />
      </div>

      {/* Policy List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Tabs defaultValue="my" onChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="my">My Policies ({myPolicies.length})</TabsTrigger>
                <TabsTrigger value="all">All Policies ({allPolicies.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1">
              <Input
                placeholder="Search by market or holder..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-5 h-5" />}
                className="max-w-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Policy</TableHeaderCell>
                <TableHeaderCell>Holder</TableHeaderCell>
                <TableHeaderCell>Coverage Period</TableHeaderCell>
                <TableHeaderCell>Shares</TableHeaderCell>
                <TableHeaderCell>Max Payout</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-text-tertiary" />
                  </TableCell>
                </TableRow>
              ) : filteredPolicies.length === 0 ? (
                <TableEmpty
                  icon={<Shield className="w-8 h-8" />}
                  title="No policies found"
                  description={activeTab === 'my' 
                    ? "You don't have any policies yet" 
                    : "No policies match your search"}
                />
              ) : (
                filteredPolicies.map((policy) => {
                  const isExpired = policy.coverageEnd < now;
                  const status = policy.status === 'Active' && isExpired ? 'Expired' : policy.status;
                  const canSettle = isExpired && policy.status === 'Active';
                  const isOwner = policy.holder === selectedAccount?.address;
                  
                  return (
                    <TableRow key={policy.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-prmx-gradient flex items-center justify-center">
                            <Shield className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <p className="font-medium">{getMarketName(policy.marketId)}</p>
                            <p className="text-xs text-text-tertiary">#{policy.id}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <code className="text-sm text-text-secondary">
                            {formatAddress(policy.holder)}
                          </code>
                          {isOwner && (
                            <Badge variant="cyan" className="ml-2">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{formatDate(policy.coverageStart)} - {formatDate(policy.coverageEnd)}</p>
                          {!isExpired && policy.status === 'Active' && (
                            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              {formatTimeRemaining(policy.coverageEnd)} remaining
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{policy.shares.toString()}</TableCell>
                      <TableCell>{formatUSDT(policy.maxPayout)}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canSettle && (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSettlePolicy(policy.id, true)}
                                loading={settlingPolicy === policy.id}
                                className="text-success hover:bg-success/10"
                                title="Event occurred - pay policyholder"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSettlePolicy(policy.id, false)}
                                loading={settlingPolicy === policy.id}
                                className="text-error hover:bg-error/10"
                                title="No event - pay LP holders"
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          <Link href={`/policies/${policy.id}`}>
                            <Button variant="ghost" size="sm">
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
