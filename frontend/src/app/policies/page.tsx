'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Shield, 
  Plus, 
  Search, 
  Clock,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  CloudRain,
  DollarSign,
  AlertTriangle
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
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import * as api from '@/lib/api';
import type { SettlementResult } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function PoliciesPage() {
  const { isConnected, selectedAccount } = useWalletStore();
  const isDao = useIsDao();
  
  const { policies: myPolicies, loading: myLoading, refresh: refreshMy } = useMyPolicies();
  const { policies: allPolicies, loading: allLoading, refresh: refreshAll } = usePolicies();
  const { markets } = useMarkets();
  
  const [searchQuery, setSearchQuery] = useState('');
  // DAO should always see "All Policies", customers default to "My Policies"
  const [activeTab, setActiveTab] = useState(isDao ? 'all' : 'my');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [settlingPolicy, setSettlingPolicy] = useState<number | null>(null);
  const [settlementResults, setSettlementResults] = useState<Map<number, SettlementResult>>(new Map());
  const [loadingSettlements, setLoadingSettlements] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

  // DAO always sees all policies
  const policies = isDao || activeTab === 'all' ? allPolicies : myPolicies;
  const loading = isDao || activeTab === 'all' ? allLoading : myLoading;

  // Fetch settlement results for settled policies
  const fetchSettlementResults = useCallback(async () => {
    const settledPolicies = policies.filter(p => p.status === 'Settled');
    if (settledPolicies.length === 0) return;

    setLoadingSettlements(true);
    const results = new Map<number, SettlementResult>();
    
    await Promise.all(
      settledPolicies.map(async (policy) => {
        try {
          const result = await api.getSettlementResult(policy.id);
          if (result) {
            results.set(policy.id, result);
          }
        } catch (err) {
          console.error(`Failed to fetch settlement for policy ${policy.id}:`, err);
        }
      })
    );
    
    setSettlementResults(results);
    setLoadingSettlements(false);
  }, [policies]);

  // Load settlement results when policies change
  useEffect(() => {
    if (!loading && policies.length > 0) {
      fetchSettlementResults();
    }
  }, [loading, policies.length, fetchSettlementResults]);

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
    if (isDao || activeTab === 'all') {
      await refreshAll();
    } else {
      await refreshMy();
    }
    // Settlement results will be refetched via useEffect when policies update
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <StatCard
          title={isDao ? 'Total Policies' : (activeTab === 'my' ? 'My Policies' : 'Total Policies')}
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
          title="Pending Settlement"
          value={loading ? '...' : expiredPolicies.length}
          icon={<Clock className="w-5 h-5" />}
          iconColor="bg-warning/10 text-warning"
        />
        <StatCard
          title="Events Triggered"
          value={loading || loadingSettlements ? '...' : Array.from(settlementResults.values()).filter(r => r.eventOccurred).length}
          icon={<CloudRain className="w-5 h-5" />}
          iconColor="bg-prmx-cyan/10 text-prmx-cyan"
        />
        <StatCard
          title="Matured (No Event)"
          value={loading || loadingSettlements ? '...' : Array.from(settlementResults.values()).filter(r => !r.eventOccurred).length}
          icon={<CheckCircle2 className="w-5 h-5" />}
          iconColor="bg-text-tertiary/10 text-text-tertiary"
        />
      </div>

      {/* Policy List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* DAO sees only "All Policies", no tabs needed */}
            {isDao ? (
              <h3 className="text-lg font-semibold">All Policies ({allPolicies.length})</h3>
            ) : (
              <Tabs defaultValue="my" onChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="my">My Policies ({myPolicies.length})</TabsTrigger>
                  <TabsTrigger value="all">All Policies ({allPolicies.length})</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
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
                <TableHeaderCell>Status / Outcome</TableHeaderCell>
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
                  description={isDao 
                    ? "No policies have been created yet" 
                    : (activeTab === 'my' 
                      ? "You don't have any policies yet" 
                      : "No policies match your search")}
                />
              ) : (
                filteredPolicies.map((policy) => {
                  const isExpired = policy.coverageEnd < now;
                  const status = policy.status === 'Active' && isExpired ? 'Expired' : policy.status;
                  const canSettle = isExpired && policy.status === 'Active';
                  const isOwner = policy.holder === selectedAccount?.address;
                  const settlementResult = settlementResults.get(policy.id);
                  
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
                        {policy.status === 'Settled' && settlementResult ? (
                          <div className="space-y-1">
                            <div className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
                              settlementResult.eventOccurred 
                                ? "bg-success/10 text-success" 
                                : "bg-prmx-cyan/10 text-prmx-cyan"
                            )}>
                              {settlementResult.eventOccurred ? (
                                <>
                                  <CloudRain className="w-3 h-3" />
                                  Event Triggered
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  Matured
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-xs">
                              <DollarSign className="w-3 h-3 text-text-tertiary" />
                              {settlementResult.eventOccurred ? (
                                <span className="text-success font-medium">
                                  Payout: {formatUSDT(settlementResult.payoutToHolder)}
                                </span>
                              ) : (
                                <span className="text-text-secondary">
                                  Returned to LPs
                                </span>
                              )}
                            </div>
                          </div>
                        ) : policy.status === 'Settled' ? (
                          <StatusBadge status={status} />
                        ) : status === 'Expired' ? (
                          <div className="space-y-1">
                            <StatusBadge status={status} />
                            <div className="flex items-center gap-1 text-xs text-warning">
                              <AlertTriangle className="w-3 h-3" />
                              Pending settlement
                            </div>
                          </div>
                        ) : (
                          <StatusBadge status={status} />
                        )}
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
