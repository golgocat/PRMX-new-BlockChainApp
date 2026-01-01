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
  DollarSign,
  Zap,
  ChevronRight,
  MapPin
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatUSDT, formatTimeRemaining, formatAddress } from '@/lib/utils';
import { useWalletStore, useFormattedBalance, useIsDao } from '@/stores/walletStore';
import { useMarkets, usePolicies, useLpOrders, useDashboardStats } from '@/hooks/useChainData';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';
import type { DaoSolvencyInfo } from '@/types';

// Stat card component with subtle styling
function AnimatedStatCard({ 
  title, 
  value, 
  icon: Icon, 
  accentColor = 'cyan',
  subtitle,
  onClick,
}: { 
  title: string;
  value: string | number;
  icon: React.ElementType;
  accentColor?: 'cyan' | 'emerald' | 'purple' | 'amber';
  subtitle?: string;
  onClick?: () => void;
}) {
  const accentClasses = {
    cyan: 'border-prmx-cyan/20 dark:border-prmx-cyan/20',
    emerald: 'border-emerald-500/20 dark:border-emerald-500/20',
    purple: 'border-prmx-purple/20 dark:border-prmx-purple/20',
    amber: 'border-amber-500/20 dark:border-amber-500/20',
  };
  
  return (
    <div 
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl p-5 transition-all duration-200',
        'bg-white dark:bg-background-secondary border',
        'hover:border-prmx-cyan/40 hover:shadow-md dark:hover:shadow-none',
        onClick && 'cursor-pointer',
        accentClasses[accentColor]
      )}
    >
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-background-tertiary flex items-center justify-center">
            <Icon className="w-5 h-5 text-prmx-cyan" />
          </div>
          {onClick && (
            <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-prmx-cyan group-hover:translate-x-1 transition-all" />
          )}
        </div>
        <p className="text-text-secondary text-sm font-medium mb-1">{title}</p>
        <p className="text-text-primary text-2xl font-bold tracking-tight">{value}</p>
        {subtitle && (
          <p className="text-text-tertiary text-xs mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// Quick action button component
function QuickActionCard({
  href,
  icon: Icon,
  title,
  description,
  iconBg,
  iconColor,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className="p-4 rounded-xl bg-white dark:bg-background-secondary/50 border border-gray-200 dark:border-border-secondary hover:border-prmx-cyan/30 hover:bg-gray-50 dark:hover:bg-background-secondary hover:shadow-sm dark:hover:shadow-none transition-all duration-200">
        <div className="flex items-center gap-4">
          <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110', iconBg)}>
            <Icon className={cn('w-6 h-6', iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold group-hover:text-prmx-cyan transition-colors">{title}</p>
            <p className="text-sm text-text-tertiary truncate">{description}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-prmx-cyan group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </Link>
  );
}

// Policy card component (replaces table row)
function PolicyCard({
  policy,
  marketName,
}: {
  policy: {
    id: string;
    label?: string;
    marketId: number;
    holder: string;
    shares: bigint;
    coverageEnd: number;
    status: string;
  };
  marketName: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = policy.coverageEnd < now;
  const status = policy.status === 'Active' && isExpired ? 'Expired' : policy.status;
  const isActive = status === 'Active';
  const displayId = policy.label || `${policy.id.slice(0, 10)}...`;

  return (
    <Link href={`/policies/${policy.id}`}>
      <div className={cn(
        'group p-4 rounded-xl border transition-all duration-200 cursor-pointer',
        'hover:shadow-lg hover:shadow-prmx-cyan/5',
        isActive 
          ? 'bg-gradient-to-r from-success/5 to-transparent border-success/20 hover:border-success/40' 
          : 'bg-background-secondary/30 border-border-secondary hover:border-prmx-cyan/30'
      )}>
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
            isActive ? 'bg-success/10 dark:bg-success/20' : 'bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50'
          )}>
            {isActive ? (
              <Shield className="w-6 h-6 text-success" />
            ) : (
              <Globe2 className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            )}
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold truncate">{marketName}</span>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-4 text-sm text-text-secondary">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {displayId}
              </span>
              <span>{policy.shares.toString()} shares</span>
            </div>
          </div>
          
          {/* Right side */}
          <div className="text-right flex-shrink-0">
            <div className="flex items-center gap-1.5 text-text-secondary mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-sm">{formatTimeRemaining(policy.coverageEnd)}</span>
            </div>
            <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-prmx-cyan group-hover:translate-x-1 transition-all ml-auto" />
          </div>
        </div>
      </div>
    </Link>
  );
}

// Market mini card
function MarketMiniCard({
  market,
  activePolicies,
}: {
  market: {
    id: number;
    name: string;
    status: string;
    strikeValue: number;
    riskParameters: { daoMarginBp: number };
  };
  activePolicies: number;
}) {
  return (
    <Link href={`/markets/${market.id}`}>
      <div className="group p-4 rounded-xl bg-white dark:bg-background-secondary/80 border border-gray-200 dark:border-border-secondary hover:border-prmx-cyan/30 transition-all duration-200 cursor-pointer hover:shadow-lg dark:hover:shadow-prmx-cyan/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-prmx-cyan/30 flex items-center justify-center">
              <Globe2 className="w-4 h-4 text-prmx-cyan" />
            </div>
            <h4 className="font-semibold group-hover:text-prmx-cyan transition-colors">{market.name}</h4>
          </div>
          <StatusBadge status={market.status} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-background-primary/50">
            <p className="text-lg font-bold text-prmx-cyan">{activePolicies}</p>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Policies</p>
          </div>
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-background-primary/50">
            <p className="text-lg font-bold">{market.strikeValue}</p>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wide">mm</p>
          </div>
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-background-primary/50">
            <p className="text-lg font-bold text-prmx-purple-light">{(market.riskParameters.daoMarginBp / 100).toFixed(0)}%</p>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Margin</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

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

  // Get recent policies (last 5, sorted by creation time)
  const recentPolicies = [...policies]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  // Get market name by ID
  const getMarketName = (marketId: number) => {
    const market = markets.find(m => m.id === marketId);
    return market?.name || `Market #${marketId}`;
  };

  const isLoading = marketsLoading || policiesLoading || statsLoading;

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-8 border border-gray-200 dark:border-border-secondary">
        {/* Subtle background accent */}
        <div className="absolute inset-0 opacity-30 dark:opacity-50">
          <div className="absolute top-0 right-0 w-96 h-96 bg-prmx-cyan/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-prmx-purple/10 rounded-full blur-3xl" />
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {isConnected && selectedAccount && (
                  <Badge variant="cyan">
                    {selectedAccount.role}
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-text-primary mb-2">
                {isConnected && selectedAccount ? (
                  <>Welcome back, <span className="text-prmx-cyan">{selectedAccount.name}</span></>
                ) : (
                  'PRMX Dashboard'
                )}
              </h1>
              <p className="text-text-secondary max-w-md">
                {isDao 
                  ? 'Manage markets, monitor protocol health, and oversee platform operations'
                  : selectedAccount?.role === 'Customer'
                  ? 'Get parametric insurance coverage for weather-related risks'
                  : 'Provide liquidity and earn returns on insurance markets'}
              </p>
            </div>
            <div className="hidden md:flex items-center gap-3">
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
          
          {/* Balance Card */}
          {isConnected && selectedAccount && (
            <div className="inline-flex items-center gap-4 bg-white/90 dark:bg-white/5 backdrop-blur-sm rounded-xl px-5 py-3 border border-gray-200/50 dark:border-white/10 shadow-sm dark:shadow-none">
              <div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-prmx-cyan" />
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Available Balance</p>
                <p className="text-gray-900 dark:text-white text-xl font-bold">{usdtFormatted}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AnimatedStatCard
          title="Active Markets"
          value={isLoading ? '...' : stats.totalMarkets}
          icon={Globe2}
          accentColor="cyan"
          onClick={() => window.location.href = '/markets'}
        />
        <AnimatedStatCard
          title="Total Policies"
          value={isLoading ? '...' : stats.totalPolicies}
          icon={Shield}
          accentColor="cyan"
          subtitle={`${stats.activePolicies} active`}
          onClick={() => window.location.href = '/policies'}
        />
        <AnimatedStatCard
          title={isDao ? 'Platform LP Orders' : 'My LP Holdings'}
          value={isLoading ? '...' : isDao ? stats.totalLpOrders : stats.myLpHoldings}
          icon={Wallet}
          accentColor="emerald"
          onClick={() => window.location.href = '/lp'}
        />
        <AnimatedStatCard
          title="Current Block"
          value={`#${currentBlock}`}
          icon={Activity}
          accentColor="purple"
          subtitle={isChainConnected ? '● Synced' : '○ Disconnected'}
        />
      </div>

      {/* DAO DeFi Strategy Dashboard */}
      {isDao && solvencyInfo && (
        <Card className="border-gray-200 dark:border-slate-600/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-gray-50/50 dark:from-slate-800/50 to-transparent" />
          <CardHeader className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-prmx-cyan" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">DeFi Strategy Dashboard</h2>
                  <p className="text-sm text-text-secondary">Protocol solvency & yield strategy</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge 
                  variant={solvencyInfo.isSolvent ? 'success' : 'warning'}
                  className="px-3 py-1"
                >
                  {solvencyInfo.isSolvent ? (
                    <><CheckCircle2 className="w-4 h-4 mr-1" /> Solvent</>
                  ) : (
                    <><AlertTriangle className="w-4 h-4 mr-1" /> At Risk</>
                  )}
                </Badge>
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
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="p-4 rounded-xl bg-success/10 border border-success/20">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-success" />
                  <span className="text-sm text-text-secondary">DAO Balance</span>
                </div>
                <p className="text-xl font-bold text-success">
                  {formatUSDT(solvencyInfo.daoBalance)}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-prmx-purple/10 border border-prmx-purple/20">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-prmx-purple-light" />
                  <span className="text-sm text-text-secondary">In DeFi</span>
                </div>
                <p className="text-xl font-bold text-prmx-purple-light">
                  {formatUSDT(solvencyInfo.totalAllocatedCapital)}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-prmx-cyan/10 border border-prmx-cyan/20">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-prmx-cyan" />
                  <span className="text-sm text-text-secondary">Positions</span>
                </div>
                <p className="text-xl font-bold">{solvencyInfo.activePositionsCount}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-warning" />
                  <span className="text-sm text-text-secondary">Allocation</span>
                </div>
                <p className="text-xl font-bold">
                  {(solvencyInfo.allocationPercentagePpm / 10000).toFixed(0)}%
                </p>
              </div>
            </div>
            
            {/* Coverage Progress */}
            <div className="p-4 rounded-xl bg-background-tertiary/30 border border-border-secondary">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">Coverage Ratio</span>
                <span className={cn(
                  'text-lg font-bold',
                  solvencyInfo.isSolvent ? 'text-success' : 'text-warning'
                )}>
                  {solvencyInfo.totalAllocatedCapital > BigInt(0)
                    ? `${((Number(solvencyInfo.daoBalance) / Number(solvencyInfo.totalAllocatedCapital)) * 100).toFixed(1)}%`
                    : 'N/A'
                  }
                </span>
              </div>
              <div className="w-full h-3 bg-background-secondary rounded-full overflow-hidden">
                <div 
                  className={cn(
                    'h-full transition-all rounded-full',
                    solvencyInfo.isSolvent 
                      ? 'bg-gradient-to-r from-success to-emerald-400' 
                      : 'bg-gradient-to-r from-warning to-orange-400'
                  )}
                  style={{ 
                    width: solvencyInfo.totalAllocatedCapital > BigInt(0)
                      ? `${Math.min(100, (Number(solvencyInfo.daoBalance) / Number(solvencyInfo.totalAllocatedCapital)) * 100)}%`
                      : '0%'
                  }}
                />
              </div>
            </div>
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
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-prmx-cyan/30 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-prmx-cyan" />
                  </div>
                  <div>
                    <h3 className="font-bold">Recent Policies</h3>
                    <p className="text-sm text-text-tertiary">{stats.activePolicies} active</p>
                  </div>
                </div>
                <Link href="/policies" className="text-sm text-prmx-cyan hover:text-prmx-cyan-light flex items-center gap-1 group">
                  View all <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {policiesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-prmx-cyan" />
                </div>
              ) : recentPolicies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="w-14 h-14 mb-5 rounded-xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50 flex items-center justify-center">
                    <Shield className="w-7 h-7 text-gray-400 dark:text-slate-400" />
                  </div>
                  <p className="font-semibold text-text-primary mb-1">No policies yet</p>
                  <p className="text-sm text-text-tertiary text-center max-w-xs mb-5">
                    {isDao ? "No policies have been created yet" : "Get started by purchasing coverage for your first policy"}
                  </p>
                  {!isDao && (
                    <Link href="/policies/new">
                      <Button size="sm" icon={<Shield className="w-4 h-4" />}>Get Coverage</Button>
                    </Link>
                  )}
                </div>
              ) : (
                recentPolicies.map((policy) => (
                  <PolicyCard
                    key={policy.id}
                    policy={policy}
                    marketName={getMarketName(policy.marketId)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50 flex items-center justify-center">
                <Zap className="w-5 h-5 text-prmx-cyan" />
              </div>
              <div>
                <h3 className="font-bold">Quick Actions</h3>
                <p className="text-sm text-text-tertiary">Common tasks</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isDao ? (
              <>
                <QuickActionCard
                  href="/markets"
                  icon={Plus}
                  title="Create Market"
                  description="Add new insurance market"
                  iconBg="bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50"
                  iconColor="text-prmx-cyan"
                />
                <QuickActionCard
                  href="/oracle"
                  icon={Droplets}
                  title="Oracle Data"
                  description="Monitor weather data feeds"
                  iconBg="bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50"
                  iconColor="text-sky-500 dark:text-sky-400"
                />
                <QuickActionCard
                  href="/policies"
                  icon={Shield}
                  title="Manage Policies"
                  description="View and settle policies"
                  iconBg="bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50"
                  iconColor="text-emerald-500 dark:text-emerald-400"
                />
              </>
            ) : selectedAccount?.role === 'Customer' ? (
              <>
                <QuickActionCard
                  href="/policies/new"
                  icon={Shield}
                  title="Get Coverage"
                  description="Request insurance quote"
                  iconBg="bg-prmx-cyan/10 border border-prmx-cyan/20"
                  iconColor="text-prmx-cyan"
                />
                <QuickActionCard
                  href="/policies"
                  icon={Activity}
                  title="My Policies"
                  description="View your coverage"
                  iconBg="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20"
                  iconColor="text-emerald-600 dark:text-emerald-400"
                />
                <QuickActionCard
                  href="/lp"
                  icon={Wallet}
                  title="LP Marketplace"
                  description="Trade LP tokens"
                  iconBg="bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20"
                  iconColor="text-violet-600 dark:text-violet-400"
                />
              </>
            ) : (
              <>
                <QuickActionCard
                  href="/lp"
                  icon={Wallet}
                  title="Trade LP Tokens"
                  description="Buy or sell positions"
                  iconBg="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20"
                  iconColor="text-emerald-600 dark:text-emerald-400"
                />
                <QuickActionCard
                  href="/policies"
                  icon={Activity}
                  title="Browse Policies"
                  description="Find investment opportunities"
                  iconBg="bg-prmx-cyan/10 border border-prmx-cyan/20"
                  iconColor="text-prmx-cyan"
                />
              </>
            )}
            <QuickActionCard
              href="/markets"
              icon={Globe2}
              title="Explore Markets"
              description="Browse insurance markets"
              iconBg="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20"
              iconColor="text-amber-600 dark:text-amber-400"
            />
          </CardContent>
        </Card>
      </div>

      {/* Markets Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-slate-600/50 flex items-center justify-center">
                <Globe2 className="w-5 h-5 text-prmx-cyan" />
              </div>
              <div>
                <h3 className="font-bold">Active Markets</h3>
                <p className="text-sm text-text-tertiary">{stats.totalMarkets} markets available</p>
              </div>
            </div>
            <Link href="/markets" className="text-sm text-prmx-cyan hover:text-prmx-cyan-light flex items-center gap-1 group">
              Explore all <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {marketsLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-prmx-cyan" />
            </div>
          ) : markets.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-background-tertiary border border-gray-200 dark:border-prmx-cyan/30 flex items-center justify-center">
                <Globe2 className="w-8 h-8 text-gray-400 dark:text-prmx-cyan" />
              </div>
              <p className="font-semibold mb-1">No markets available</p>
              <p className="text-sm text-text-tertiary mb-4">Markets will appear here once created</p>
              {isDao && (
                <Link href="/markets">
                  <Button size="sm">Create First Market</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {markets.slice(0, 4).map((market) => {
                const marketPolicies = policies.filter(p => p.marketId === market.id);
                const activePolicies = marketPolicies.filter(p => p.status === 'Active').length;
                
                return (
                  <MarketMiniCard
                    key={market.id}
                    market={market}
                    activePolicies={activePolicies}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
