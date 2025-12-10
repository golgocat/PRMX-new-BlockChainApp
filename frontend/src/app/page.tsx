'use client';

import { useEffect, useState } from 'react';
import { 
  Shield, 
  TrendingUp, 
  Droplets, 
  Wallet, 
  ArrowRight, 
  Globe2,
  Activity,
  Clock,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  DollarSign
} from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, TableEmpty } from '@/components/ui/Table';
import { RainfallChart, PremiumChart } from '@/components/features/RainfallChart';
import { formatUSDT, formatTimeRemaining, formatAddress } from '@/lib/utils';
import { useWalletStore, useFormattedBalance, useIsDao } from '@/stores/walletStore';
import { useMarkets, usePolicies, useLpOrders, useDashboardStats } from '@/hooks/useChainData';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';
import type { DaoSolvencyInfo } from '@/types';

export default function DashboardPage() {
  const { isConnected, selectedAccount, isChainConnected, currentBlock } = useWalletStore();
  const { usdtFormatted } = useFormattedBalance();
  const isDao = useIsDao();
  
  const { markets, loading: marketsLoading, refresh: refreshMarkets } = useMarkets();
  const { policies, loading: policiesLoading, refresh: refreshPolicies } = usePolicies();
  const { orders, loading: ordersLoading } = useLpOrders();
  const { stats, loading: statsLoading, refresh: refreshStats } = useDashboardStats();

  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // DAO Solvency State
  const [solvencyInfo, setSolvencyInfo] = useState<DaoSolvencyInfo | null>(null);
  const [loadingSolvency, setLoadingSolvency] = useState(false);
  
  // Load DAO solvency info
  const loadSolvencyInfo = async () => {
    setLoadingSolvency(true);
    try {
      const info = await api.getDaoSolvencyInfo();
      setSolvencyInfo(info);
    } catch (err) {
      console.error('Failed to load solvency info:', err);
    } finally {
      setLoadingSolvency(false);
    }
  };
  
  useEffect(() => {
    if (isDao) {
      loadSolvencyInfo();
    }
  }, [isDao]);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    const refreshPromises = [refreshMarkets(), refreshPolicies(), refreshStats()];
    if (isDao) {
      refreshPromises.push(loadSolvencyInfo());
    }
    await Promise.all(refreshPromises);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Get recent policies (last 5)
  const recentPolicies = policies
    .sort((a, b) => b.id - a.id)
    .slice(0, 5);

  // Get market name by ID
  const getMarketName = (marketId: number) => {
    const market = markets.find(m => m.id === marketId);
    return market?.name || `Market #${marketId}`;
  };

  const isLoading = marketsLoading || policiesLoading || statsLoading;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-text-secondary mt-1">
            {isConnected && selectedAccount ? (
              <>Welcome back, <span className="text-prmx-cyan">{selectedAccount.name}</span> ({selectedAccount.role})</>
            ) : (
              'Connect your wallet to get started'
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />}
            onClick={handleRefreshAll}
            disabled={isRefreshing || isLoading}
          >
            Refresh
          </Button>
          {isDao ? (
            <Link href="/markets">
              <Button icon={<Plus className="w-5 h-5" />}>
                Create Market
              </Button>
            </Link>
          ) : (
            <Link href="/policies/new">
              <Button icon={<Shield className="w-5 h-5" />}>
                Get Coverage
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Role-specific banner */}
      {isConnected && selectedAccount && (
        <div className={cn(
          'p-4 rounded-xl border flex items-center justify-between',
          isDao 
            ? 'bg-prmx-purple/10 border-prmx-purple/30' 
            : selectedAccount.role === 'Customer'
            ? 'bg-prmx-cyan/10 border-prmx-cyan/30'
            : 'bg-success/10 border-success/30'
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              isDao ? 'bg-prmx-purple/20' : selectedAccount.role === 'Customer' ? 'bg-prmx-cyan/20' : 'bg-success/20'
            )}>
              {isDao ? <Shield className="w-5 h-5 text-prmx-purple-light" /> : 
               selectedAccount.role === 'Customer' ? <Shield className="w-5 h-5 text-prmx-cyan" /> :
               <Wallet className="w-5 h-5 text-success" />}
            </div>
            <div>
              <p className="font-semibold">{selectedAccount.role} Dashboard</p>
              <p className="text-sm text-text-secondary">
                {isDao 
                  ? 'Create markets, manage parameters, and oversee the platform'
                  : selectedAccount.role === 'Customer'
                  ? 'Get insurance coverage and manage your policies'
                  : 'Trade LP tokens and earn returns on your investments'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-text-secondary">Available Balance</p>
            <p className="text-lg font-bold">{usdtFormatted}</p>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Active Markets"
          value={isLoading ? '...' : stats.totalMarkets}
          icon={<Globe2 className="w-5 h-5" />}
        />
        <StatCard
          title="Total Policies"
          value={isLoading ? '...' : stats.totalPolicies}
          icon={<Shield className="w-5 h-5" />}
          iconColor="bg-prmx-purple/10 text-prmx-purple-light"
        />
        <StatCard
          title="Active Policies"
          value={isLoading ? '...' : stats.activePolicies}
          icon={<TrendingUp className="w-5 h-5" />}
          iconColor="bg-success/10 text-success"
        />
        <StatCard
          title="LP Orders"
          value={isLoading ? '...' : stats.totalLpOrders}
          icon={<Wallet className="w-5 h-5" />}
          iconColor="bg-prmx-cyan/10 text-prmx-cyan"
        />
      </div>

      {/* My Stats (when connected) */}
      {isConnected && selectedAccount && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-gradient-to-br from-prmx-cyan/10 to-prmx-purple/10 border-prmx-cyan/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">{isDao ? 'Total Policies' : 'My Policies'}</p>
                  <p className="text-2xl font-bold">{isDao ? stats.totalPolicies : stats.myPolicies}</p>
                  <p className="text-xs text-text-tertiary mt-1">{isDao ? stats.activePolicies : stats.myActivePolicies} active</p>
                </div>
                <Shield className="w-10 h-10 text-prmx-cyan opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-prmx-cyan/10 border-success/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">LP Holdings</p>
                  <p className="text-2xl font-bold">{stats.myLpHoldings}</p>
                  <p className="text-xs text-text-tertiary mt-1">positions</p>
                </div>
                <Wallet className="w-10 h-10 text-success opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-prmx-purple/10 to-prmx-magenta/10 border-prmx-purple/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Current Block</p>
                  <p className="text-2xl font-bold">#{currentBlock}</p>
                  <p className="text-xs text-text-tertiary mt-1">
                    {isChainConnected ? 'Chain synced' : 'Disconnected'}
                  </p>
                </div>
                <Activity className="w-10 h-10 text-prmx-purple-light opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* DAO DeFi Strategy Dashboard */}
      {isDao && (
        <Card className="border-prmx-cyan/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-prmx-cyan/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-prmx-cyan" />
                </div>
                <div>
                  <h2 className="font-semibold">DeFi Strategy Dashboard</h2>
                  <p className="text-sm text-text-secondary">DeFi yield strategy status & DAO solvency</p>
                </div>
              </div>
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={loadSolvencyInfo}
                disabled={loadingSolvency}
                icon={<RefreshCw className={cn('w-4 h-4', loadingSolvency && 'animate-spin')} />}
              >
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingSolvency && !solvencyInfo ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-prmx-cyan" />
              </div>
            ) : solvencyInfo ? (
              <div className="space-y-4">
                {/* Solvency Status Banner */}
                <div className={cn(
                  'p-4 rounded-xl border',
                  solvencyInfo.isSolvent 
                    ? 'bg-success/10 border-success/30' 
                    : 'bg-warning/10 border-warning/30'
                )}>
                  <div className="flex items-center gap-3">
                    {solvencyInfo.isSolvent ? (
                      <CheckCircle2 className="w-6 h-6 text-success" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-warning" />
                    )}
                    <div className="flex-1">
                      <p className="font-semibold">
                        {solvencyInfo.isSolvent ? 'DAO is Solvent' : 'Solvency Warning'}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {solvencyInfo.isSolvent 
                          ? 'DAO can cover all potential DeFi losses' 
                          : 'DAO may not cover all potential DeFi losses'}
                      </p>
                    </div>
                    <Badge 
                      variant={solvencyInfo.isSolvent ? 'success' : 'warning'}
                    >
                      {solvencyInfo.isSolvent ? '🟢 Solvent' : '🟡 At Risk'}
                    </Badge>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-background-tertiary/50">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-success" />
                      <span className="text-sm text-text-secondary">DAO Balance</span>
                    </div>
                    <p className="text-xl font-bold text-success">
                      {formatUSDT(solvencyInfo.daoBalance)}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-background-tertiary/50">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-prmx-purple" />
                      <span className="text-sm text-text-secondary">Total in DeFi</span>
                    </div>
                    <p className="text-xl font-bold text-prmx-purple-light">
                      {formatUSDT(solvencyInfo.totalAllocatedCapital)}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-background-tertiary/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-prmx-cyan" />
                      <span className="text-sm text-text-secondary">Active Positions</span>
                    </div>
                    <p className="text-xl font-bold">{solvencyInfo.activePositionsCount}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-background-tertiary/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-4 h-4 text-text-secondary" />
                      <span className="text-sm text-text-secondary">Allocation Rate</span>
                    </div>
                    <p className="text-xl font-bold">
                      {(solvencyInfo.allocationPercentagePpm / 10000).toFixed(0)}%
                    </p>
                  </div>
                </div>

                {/* Coverage Ratio */}
                <div className="p-4 rounded-xl bg-prmx-cyan/5 border border-prmx-cyan/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">Coverage Ratio</span>
                    <span className="text-sm font-mono">
                      {solvencyInfo.totalAllocatedCapital > BigInt(0)
                        ? `${((Number(solvencyInfo.daoBalance) / Number(solvencyInfo.totalAllocatedCapital)) * 100).toFixed(1)}%`
                        : 'N/A'
                      }
                    </span>
                  </div>
                  <div className="w-full h-2 bg-background-secondary rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        'h-full transition-all',
                        solvencyInfo.isSolvent ? 'bg-success' : 'bg-warning'
                      )}
                      style={{ 
                        width: solvencyInfo.totalAllocatedCapital > BigInt(0)
                          ? `${Math.min(100, (Number(solvencyInfo.daoBalance) / Number(solvencyInfo.totalAllocatedCapital)) * 100)}%`
                          : '0%'
                      }}
                    />
                  </div>
                  <p className="text-xs text-text-tertiary mt-2">
                    DAO Balance / Total Allocated Capital (100% = full coverage)
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <TrendingUp className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                <p className="text-text-secondary">Unable to load solvency data</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={loadSolvencyInfo}>
                  Try Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Policies */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Recent Policies</h3>
                <Link href="/policies" className="text-sm text-prmx-cyan hover:text-prmx-cyan-light flex items-center gap-1">
                  View all <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Policy</TableHeaderCell>
                    <TableHeaderCell>Holder</TableHeaderCell>
                    <TableHeaderCell>Shares</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {policiesLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-text-tertiary" />
                      </TableCell>
                    </TableRow>
                  ) : recentPolicies.length === 0 ? (
                    <TableEmpty
                      icon={<Shield className="w-8 h-8" />}
                      title="No policies yet"
                      description={isDao ? "No policies have been created yet" : "Be the first to get coverage!"}
                    />
                  ) : (
                    recentPolicies.map((policy) => {
                      const now = Math.floor(Date.now() / 1000);
                      const isExpired = policy.coverageEnd < now;
                      const status = policy.status === 'Active' && isExpired ? 'Expired' : policy.status;
                      
                      return (
                        <TableRow key={policy.id} clickable>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-prmx-gradient flex items-center justify-center">
                                <Globe2 className="w-4 h-4 text-white" />
                              </div>
                              <div>
                                <span className="font-medium">{getMarketName(policy.marketId)}</span>
                                <p className="text-xs text-text-tertiary">#{policy.id}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <code className="text-sm text-text-secondary">
                              {formatAddress(policy.holder)}
                            </code>
                          </TableCell>
                          <TableCell>{policy.shares.toString()}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-text-secondary">
                              <Clock className="w-4 h-4" />
                              {formatTimeRemaining(policy.coverageEnd)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={status} />
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

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <h3 className="font-semibold">Quick Actions</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {isDao ? (
              <>
                <Link href="/markets" className="block">
                  <div className="p-4 rounded-xl bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-prmx-purple/20 flex items-center justify-center">
                        <Plus className="w-5 h-5 text-prmx-purple-light" />
                      </div>
                      <div>
                        <p className="font-medium">Create Market</p>
                        <p className="text-xs text-text-secondary">Add a new insurance market</p>
                      </div>
                    </div>
                  </div>
                </Link>
                <Link href="/oracle" className="block">
                  <div className="p-4 rounded-xl bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                        <Droplets className="w-5 h-5 text-info" />
                      </div>
                      <div>
                        <p className="font-medium">Oracle Data</p>
                        <p className="text-xs text-text-secondary">Monitor rainfall data</p>
                      </div>
                    </div>
                  </div>
                </Link>
              </>
            ) : selectedAccount?.role === 'Customer' ? (
              <>
                <Link href="/policies/new" className="block">
                  <div className="p-4 rounded-xl bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-prmx-cyan/20 flex items-center justify-center">
                        <Shield className="w-5 h-5 text-prmx-cyan" />
                      </div>
                      <div>
                        <p className="font-medium">Get Coverage</p>
                        <p className="text-xs text-text-secondary">Request a new insurance quote</p>
                      </div>
                    </div>
                  </div>
                </Link>
                <Link href="/policies" className="block">
                  <div className="p-4 rounded-xl bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                        <Activity className="w-5 h-5 text-success" />
                      </div>
                      <div>
                        <p className="font-medium">{isDao ? 'All Policies' : 'My Policies'}</p>
                        <p className="text-xs text-text-secondary">{isDao ? 'Manage and settle policies' : 'View and manage your coverage'}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              </>
            ) : (
              <>
                <Link href="/lp" className="block">
                  <div className="p-4 rounded-xl bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-success" />
                      </div>
                      <div>
                        <p className="font-medium">Trade LP Tokens</p>
                        <p className="text-xs text-text-secondary">Buy or sell LP positions</p>
                      </div>
                    </div>
                  </div>
                </Link>
              </>
            )}
            <Link href="/markets" className="block">
              <div className="p-4 rounded-xl bg-background-tertiary/50 hover:bg-background-tertiary transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-prmx-magenta/20 flex items-center justify-center">
                    <Globe2 className="w-5 h-5 text-prmx-magenta" />
                  </div>
                  <div>
                    <p className="font-medium">Explore Markets</p>
                    <p className="text-xs text-text-secondary">Browse available insurance markets</p>
                  </div>
                </div>
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Markets Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Markets Overview</h3>
            <Link href="/markets" className="text-sm text-prmx-cyan hover:text-prmx-cyan-light flex items-center gap-1">
              Explore markets <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {marketsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-text-tertiary" />
            </div>
          ) : markets.length === 0 ? (
            <div className="text-center py-8">
              <Globe2 className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
              <p className="text-text-secondary">No markets available</p>
              {isDao && (
                <Link href="/markets">
                  <Button size="sm" className="mt-4">Create First Market</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {markets.slice(0, 4).map((market) => {
                const marketPolicies = policies.filter(p => p.marketId === market.id);
                const activePolicies = marketPolicies.filter(p => p.status === 'Active').length;
                
                return (
                  <Link key={market.id} href={`/markets/${market.id}`}>
                    <div className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary hover:border-prmx-cyan/30 transition-all cursor-pointer">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">{market.name}</h4>
                        <StatusBadge status={market.status} />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-secondary">Active Policies</span>
                          <span>{activePolicies}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-secondary">Strike</span>
                          <span>{market.strikeValue} mm</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-secondary">DAO Margin</span>
                          <span>{(market.riskParameters.daoMarginBp / 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
