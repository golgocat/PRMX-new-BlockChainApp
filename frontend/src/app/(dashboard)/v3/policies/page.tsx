'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Shield,
  Search, 
  Clock,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  CloudRain,
  DollarSign,
  MapPin,
  AlertTriangle,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { formatUSDT, formatTimeRemaining, formatDateTimeUTCCompact, formatAddress } from '@/lib/utils';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useV3Policies, useV3MyPolicies, useV3MyLpHoldings } from '@/hooks/useV3ChainData';
import { WalletConnectionModal } from '@/components/features/WalletConnectionModal';
import { cn } from '@/lib/utils';
import { 
  V3Policy, 
  V3PolicyStatus, 
  getEventTypeInfo, 
  formatThresholdValue
} from '@/types/v3';

type TabValue = 'my' | 'lp' | 'all';

function getStatusBadge(status: V3PolicyStatus, coverageEnd: number) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = coverageEnd <= now;
  
  if (status === 'Active' && isExpired) {
    return (
      <div className="space-y-1">
        <Badge variant="warning">Pending Settlement</Badge>
      </div>
    );
  }
  
  switch (status) {
    case 'Active':
      return <Badge variant="success">Active</Badge>;
    case 'Triggered':
      return <Badge variant="info">Event Triggered</Badge>;
    case 'Matured':
      return <Badge variant="default">Matured</Badge>;
    case 'Settled':
      return <Badge variant="cyan">Settled</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}

export default function V3PoliciesPage() {
  const router = useRouter();
  const { isConnected, selectedAccount } = useWalletStore();
  const isDao = useIsDao();
  
  const { policies: allPolicies, loading: allLoading, refresh: refreshAll, isRefreshing } = useV3Policies();
  const { policies: myPolicies, loading: myLoading, refresh: refreshMy } = useV3MyPolicies();
  const { holdings: lpHoldings, loading: lpLoading, refresh: refreshLp } = useV3MyLpHoldings();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>(isDao ? 'all' : 'my');
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Get policies for current tab
  let policies: V3Policy[];
  let loading: boolean;
  
  switch (activeTab) {
    case 'my':
      policies = myPolicies;
      loading = myLoading;
      break;
    case 'lp':
      // Get policies where user has LP holdings
      const lpPolicyIds = new Set(lpHoldings.map(h => h.policyId));
      policies = allPolicies.filter(p => lpPolicyIds.has(p.id));
      loading = allLoading || lpLoading;
      break;
    case 'all':
    default:
      policies = allPolicies;
      loading = allLoading;
  }

  const filteredPolicies = policies
    .filter((policy) => {
      const eventInfo = getEventTypeInfo(policy.eventSpec.eventType);
      const searchLower = searchQuery.toLowerCase();
      return (
        policy.id.toString().includes(searchQuery) ||
        policy.location?.name.toLowerCase().includes(searchLower) ||
        eventInfo?.label.toLowerCase().includes(searchLower) ||
        policy.holder.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => sortOrder === 'asc' ? a.id - b.id : b.id - a.id);

  // Stats
  const now = Math.floor(Date.now() / 1000);
  const activePolicies = allPolicies.filter(p => p.status === 'Active' && p.coverageEnd > now);
  const pendingSettlement = allPolicies.filter(p => p.status === 'Active' && p.coverageEnd <= now);
  const triggeredPolicies = allPolicies.filter(p => p.status === 'Triggered');
  const settledPolicies = allPolicies.filter(p => p.status === 'Settled');

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshAll(), refreshMy(), refreshLp()]);
  }, [refreshAll, refreshMy, refreshLp]);

  if (!isConnected) {
    return (
      <div className="space-y-8 pt-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
          </div>
          <h1 className="text-3xl font-bold">Climate Risk Policies</h1>
          <p className="text-text-secondary mt-1">View and manage V3 P2P policies</p>
        </div>
        
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Connect your wallet to view your V3 climate risk policies
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
    <div className="space-y-8 pt-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="purple" className="text-xs">V3 P2P</Badge>
          </div>
          <h1 className="text-3xl font-bold">Climate Risk Policies</h1>
          <p className="text-text-secondary mt-1">
            {isDao ? 'Manage all V3 policies' : 'View and manage your V3 policies'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshing && 'animate-spin')} />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          <Link href="/v3/requests">
            <Button>
              Marketplace
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <StatCard
          title="Total Policies"
          value={allLoading ? '...' : allPolicies.length}
          icon={<Shield className="w-5 h-5" />}
        />
        <StatCard
          title="Active"
          value={allLoading ? '...' : activePolicies.length}
          icon={<CheckCircle2 className="w-5 h-5" />}
          iconColor="bg-success/10 text-success"
        />
        <StatCard
          title="Pending Settlement"
          value={allLoading ? '...' : pendingSettlement.length}
          icon={<Clock className="w-5 h-5" />}
          iconColor="bg-warning/10 text-warning"
        />
        <StatCard
          title="Events Triggered"
          value={allLoading ? '...' : triggeredPolicies.length}
          icon={<CloudRain className="w-5 h-5" />}
          iconColor="bg-prmx-cyan/10 text-prmx-cyan"
        />
        <StatCard
          title="Settled"
          value={allLoading ? '...' : settledPolicies.length}
          icon={<DollarSign className="w-5 h-5" />}
          iconColor="bg-prmx-purple/10 text-prmx-purple"
        />
      </div>

      {/* Policy List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Tabs defaultValue={isDao ? 'all' : 'my'} onChange={(v) => setActiveTab(v as TabValue)}>
              <TabsList>
                <TabsTrigger value="my">My Policies ({myPolicies.length})</TabsTrigger>
                <TabsTrigger value="lp">LP Holdings ({lpHoldings.length})</TabsTrigger>
                <TabsTrigger value="all">All Policies ({allPolicies.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1">
              <Input
                placeholder="Search by location, event type, or holder..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-5 h-5" />}
                className="max-w-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>
                  <button 
                    onClick={() => setSortOrder(s => s === 'asc' ? 'desc' : 'asc')}
                    className="flex items-center gap-1 hover:text-prmx-cyan transition-colors"
                  >
                    Policy
                    {sortOrder === 'asc' ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : (
                      <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Coverage Period</TableHeaderCell>
                <TableHeaderCell>Shares</TableHeaderCell>
                <TableHeaderCell>Max Payout</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>{'\u00A0'}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 w-24 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-28 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-32 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-12 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-background-tertiary/50 rounded" /></TableCell>
                      <TableCell><div className="h-6 w-16 bg-background-tertiary/50 rounded-full" /></TableCell>
                      <TableCell><div className="h-8 w-8 bg-background-tertiary/50 rounded" /></TableCell>
                    </TableRow>
                  ))}
                </>
              ) : filteredPolicies.length === 0 ? (
                <TableEmpty
                  icon={<Shield className="w-8 h-8" />}
                  title="No policies found"
                  description={
                    activeTab === 'my' 
                      ? "You don't have any V3 policies yet" 
                      : activeTab === 'lp'
                        ? "You don't have LP holdings in any V3 policies"
                        : "No policies match your search"
                  }
                />
              ) : (
                filteredPolicies.map((policy) => {
                  const eventInfo = getEventTypeInfo(policy.eventSpec.eventType);
                  const isOwner = policy.holder === selectedAccount?.address;
                  const lpHolding = lpHoldings.find(h => h.policyId === policy.id);
                  const isExpired = policy.coverageEnd <= now;
                  
                  return (
                    <TableRow 
                      key={policy.id} 
                      className={cn(
                        'cursor-pointer hover:bg-background-tertiary/50 transition-colors',
                        isRefreshing && 'opacity-50'
                      )}
                      onClick={() => router.push(`/v3/policies/${policy.id}`)}
                    >
                      <TableCell>
                        {(() => {
                          // Format short policy ID for avatar
                          const shortId = typeof policy.id === 'string' && policy.id.startsWith('0x') 
                            ? policy.id.slice(2, 10) 
                            : String(policy.id).slice(0, 8);
                          return (
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-mono text-xs font-bold shadow-sm flex-shrink-0"
                                style={{
                                  background: `linear-gradient(135deg, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 160}, 70%, 45%) 0%, 
                                    hsl(${(parseInt(shortId, 16) % 60) + 200}, 80%, 35%) 100%)`
                                }}
                              >
                                {shortId.slice(0, 4)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-medium text-text-primary">{shortId}...</span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300 uppercase">
                                    V3
                                  </span>
                                </div>
                                <p className="text-xs text-text-tertiary">
                                  {eventInfo?.label} ≥ {formatThresholdValue(
                                    policy.eventSpec.threshold.value, 
                                    policy.eventSpec.threshold.unit
                                  )}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-text-tertiary" />
                          <span>{policy.location?.name || `Loc #${policy.locationId}`}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {new Date(policy.coverageStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                            {' → '}
                            {new Date(policy.coverageEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </p>
                          {!isExpired && policy.status === 'Active' && (
                            <p className="text-xs text-prmx-cyan flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimeRemaining(policy.coverageEnd)}
                            </p>
                          )}
                          {isExpired && policy.status === 'Active' && (
                            <p className="text-xs text-warning">Coverage ended</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium">{policy.totalShares}</span>
                          {lpHolding && activeTab === 'lp' && (
                            <p className="text-xs text-prmx-cyan">
                              You own {lpHolding.lpShares} LP ({lpHolding.percentageOwned.toFixed(1)}%)
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-prmx-cyan">{formatUSDT(policy.maxPayout, false)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {getStatusBadge(policy.status, policy.coverageEnd)}
                          {isOwner && <Badge variant="cyan" className="block w-fit">Holder</Badge>}
                          {lpHolding && !isOwner && <Badge variant="purple" className="block w-fit">LP</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-text-tertiary" />
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

