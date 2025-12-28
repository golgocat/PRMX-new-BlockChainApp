'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Shield, 
  ChevronLeft, 
  MapPin, 
  Calendar, 
  Users,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  Droplets,
  CloudRain,
  Wallet,
  ArrowRight,
  Copy,
  Check,
  Lock,
  Activity,
  Zap,
  Info
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { useWalletStore, useIsDao } from '@/stores/walletStore';
import { useMarkets } from '@/hooks/useChainData';
import * as api from '@/lib/api';
import { formatUSDT, formatDate, formatDateTimeUTC, formatAddress, formatCoordinates, formatTimeRemaining, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Policy, Market, PolicyDefiInfo, V2Monitor, LpHolding } from '@/types';
import type { SettlementResult } from '@/lib/api';

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const policyId = Number(params.id);
  
  const { isConnected } = useWalletStore();
  const isDao = useIsDao();
  const { markets } = useMarkets();
  
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);
  const [poolInfo, setPoolInfo] = useState<{ address: string; balance: bigint } | null>(null);
  const [defiInfo, setDefiInfo] = useState<PolicyDefiInfo | null>(null);
  const [v2Monitor, setV2Monitor] = useState<V2Monitor | null>(null);
  const [lpHoldings, setLpHoldings] = useState<LpHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (poolInfo?.address) {
      await navigator.clipboard.writeText(poolInfo.address);
      setCopied(true);
      toast.success('Pool address copied!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Define loadPolicy with useCallback BEFORE useEffect
  const loadPolicy = useCallback(async (isInitialLoad = true) => {
    if (isInitialLoad) {
      setLoading(true);
    }
    try {
      const policies = await api.getPolicies();
      const found = policies.find(p => p.id === policyId);
      if (found) {
        setPolicy(found);
        // Load market info
        const marketInfo = markets.find(m => m.id === found.marketId);
        if (marketInfo) {
          setMarket(marketInfo);
        } else {
          const m = await api.getMarket(found.marketId);
          setMarket(m);
        }
        // Load pool info (address + balance)
        try {
          const pool = await api.getPolicyPoolInfo(policyId);
          setPoolInfo(pool);
        } catch (poolErr) {
          console.error('Failed to load pool info:', poolErr);
        }
        // Load DeFi allocation info
        try {
          const defi = await api.getPolicyDefiInfo(policyId);
          setDefiInfo(defi);
        } catch (defiErr) {
          console.error('Failed to load DeFi info:', defiErr);
        }
        // Load V2 monitor info if this is a V2 policy
        if (found.policyVersion === 'V2') {
          try {
            const monitor = await api.getV2MonitorByPolicy(policyId);
            setV2Monitor(monitor);
          } catch (v2Err) {
            console.error('Failed to load V2 monitor:', v2Err);
          }
        }
        // Load LP holdings for this policy
        try {
          const holdings = await api.getLpHoldingsForPolicy(policyId);
          setLpHoldings(holdings);
        } catch (lpErr) {
          console.error('Failed to load LP holdings:', lpErr);
        }
        // Load settlement result if policy is settled
        if (found.status === 'Settled') {
          const result = await api.getSettlementResult(policyId);
          setSettlementResult(result);
        }
      }
    } catch (err) {
      console.error('Failed to load policy:', err);
      toast.error('Failed to load policy details');
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, [policyId, markets]);

  // Auto-refresh effect - now loadPolicy is defined above
  useEffect(() => {
    if (isNaN(policyId) || policyId < 0) {
      router.push('/policies');
      return;
    }
    
    loadPolicy();
    
    // Auto-refresh every 10 seconds for real-time settlement updates
    // Use isInitialLoad=false to prevent scroll jumps and loading state
    const interval = setInterval(() => {
      loadPolicy(false);
    }, 10000);
    
    return () => clearInterval(interval);
  }, [policyId, loadPolicy, router]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPolicy(false);
    // Ensure animation is visible for at least 500ms
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleSettle = async (eventOccurred: boolean) => {
    const keypair = useWalletStore.getState().getKeypair();
    if (!keypair) {
      toast.error('Please connect wallet');
      return;
    }

    setSettling(true);
    try {
      await api.settlePolicy(keypair, policyId, eventOccurred);
      toast.success(`Policy settled ${eventOccurred ? '(event occurred - payout!)' : '(no event)'}`);
      await loadPolicy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to settle policy');
    } finally {
      setSettling(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const isExpired = policy && policy.coverageEnd <= now;
  const isActive = policy?.status === 'Active';
  const canSettle = isDao && isActive && isExpired;

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Policy Details</h1>
            <p className="text-text-secondary mt-1">Loading...</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <RefreshCw className="w-12 h-12 mx-auto mb-4 animate-spin text-prmx-cyan" />
            <p className="text-text-secondary">Loading policy details...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Policy Not Found</h1>
            <p className="text-text-secondary mt-1">The requested policy does not exist</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-text-tertiary" />
            <h3 className="text-lg font-semibold mb-2">Policy not found</h3>
            <p className="text-text-secondary mb-6">
              This policy may have been removed or never existed.
            </p>
            <Link href="/policies">
              <Button>Back to Policies</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/policies">
            <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">Policy {policy.label}</h1>
              <Badge 
                variant={policy.policyVersion === 'V2' ? 'cyan' : 'default'}
                className="text-sm"
              >
                {policy.policyVersion || 'V1'}
              </Badge>
              <StatusBadge status={policy.status} />
            </div>
            <p className="text-text-secondary mt-1">
              {market?.name || `Market #${policy.marketId}`} Coverage
            </p>
          </div>
        </div>
        <Button 
          variant="secondary" 
          onClick={handleRefresh}
          icon={<RefreshCw className={cn('w-4 h-4 transition-transform', isRefreshing && 'animate-spin')} />}
        >
          Refresh
        </Button>
      </div>

      {/* Main Info Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Policy Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-prmx-cyan" />
              Policy Overview
            </h2>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Market Info */}
            <div className="p-4 rounded-xl bg-background-tertiary/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-prmx-gradient flex items-center justify-center">
                    <MapPin className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{market?.name || `Market #${policy.marketId}`}</h3>
                    {market && (
                      <p className="text-sm text-text-secondary">
                        {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                      </p>
                    )}
                  </div>
                </div>
                <Link href={policy.policyVersion === 'V2' ? '/oracle-service' : `/oracle?marketId=${policy.marketId}`}>
                  <Button variant="secondary" size="sm" icon={policy.policyVersion === 'V2' ? <Activity className="w-4 h-4" /> : <Droplets className="w-4 h-4" />}>
                    {policy.policyVersion === 'V2' ? 'View V2 Oracle' : 'View Rainfall'}
                  </Button>
                </Link>
              </div>
              {market && (
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                  <div>
                    <span className="text-text-secondary">Strike Value</span>
                    <p className="font-medium">{market.strikeValue} mm (24h rolling)</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Payout per Share</span>
                    <p className="font-medium">{formatUSDT(market.payoutPerShare)}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Coverage Period */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-border-secondary">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-text-secondary" />
                  <span className="text-sm text-text-secondary">Coverage Start (UTC)</span>
                </div>
                <p className="font-semibold text-lg">{formatDateTimeUTC(policy.coverageStart)}</p>
              </div>
              <div className="p-4 rounded-xl border border-border-secondary">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-text-secondary" />
                  <span className="text-sm text-text-secondary">Coverage End (UTC)</span>
                </div>
                <p className="font-semibold text-lg">{formatDateTimeUTC(policy.coverageEnd)}</p>
              </div>
            </div>

            {/* Time Remaining */}
            {isActive && (
              <div className={`p-4 rounded-xl ${isExpired ? 'bg-warning/10 border border-warning/30' : 'bg-prmx-cyan/10 border border-prmx-cyan/30'}`}>
                <div className="flex items-center gap-2">
                  <Clock className={`w-5 h-5 ${isExpired ? 'text-warning' : 'text-prmx-cyan'}`} />
                  <span className="font-medium">
                    {isExpired ? 'Coverage Expired - Awaiting Settlement' : formatTimeRemaining(policy.coverageEnd)}
                  </span>
                </div>
              </div>
            )}

            {/* Holder Info */}
            <div className="p-4 rounded-xl border border-border-secondary">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-text-secondary" />
                <span className="text-sm text-text-secondary">Policy Holder</span>
              </div>
              <p className="font-mono text-sm">{policy.holder}</p>
            </div>

            {/* Created At */}
            <div className="p-4 rounded-xl border border-border-secondary">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-text-secondary" />
                <span className="text-sm text-text-secondary">Policy Created (UTC)</span>
              </div>
              <p className="font-semibold">{formatDateTimeUTC(policy.createdAt)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-success" />
                Financial Summary
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl bg-success/10 border border-success/30">
                <span className="text-sm text-text-secondary">Max Payout</span>
                <p className="text-2xl font-bold text-success">{formatUSDT(policy.maxPayout)}</p>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Shares</span>
                  <span className="font-medium">{Number(policy.shares)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Premium Paid</span>
                  <span className="font-medium">{formatUSDT(policy.premiumPaid)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Capital Pool</span>
                  <span className="font-medium">{formatUSDT(policy.capitalPool.totalCapital)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pool Account Info */}
          {poolInfo && (
            <Card className="border-prmx-purple/30">
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Lock className="w-5 h-5 text-prmx-purple" />
                  Locked Funds
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Pool Balance */}
                <div className="p-4 rounded-xl bg-prmx-purple/10 border border-prmx-purple/30">
                  <span className="text-sm text-text-secondary">Pool Balance</span>
                  <p className="text-2xl font-bold text-prmx-purple-light">
                    {formatUSDT(poolInfo.balance)}
                  </p>
                </div>
                
                {/* Pool Address */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Pool Address</span>
                    <button
                      onClick={handleCopyAddress}
                      className="flex items-center gap-1 text-xs text-prmx-cyan hover:text-prmx-cyan/80 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-3 rounded-lg bg-background-tertiary/50 border border-border-secondary">
                    <p className="font-mono text-xs break-all text-text-secondary">
                      {poolInfo.address}
                    </p>
                  </div>
                </div>
                
                <p className="text-xs text-text-tertiary">
                  Funds are locked in this derived account until policy settlement.
                </p>
              </CardContent>
            </Card>
          )}

          {/* DeFi Allocation Card */}
          {defiInfo && (
            <Card className={defiInfo.isAllocatedToDefi ? 'border-success/30' : 'border-border-secondary'}>
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-success" />
                  DeFi Yield Strategy
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Investment Status */}
                <div className={`p-4 rounded-xl ${
                  defiInfo.isAllocatedToDefi 
                    ? 'bg-success/10 border border-success/30' 
                    : 'bg-background-tertiary/50 border border-border-secondary'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">Status</span>
                    <Badge 
                      variant={defiInfo.isAllocatedToDefi ? 'success' : 'default'}
                      className="text-xs"
                    >
                      {defiInfo.investmentStatus === 'Invested' && '🟢 Allocated to DeFi'}
                      {defiInfo.investmentStatus === 'NotInvested' && '⚪ Not Allocated'}
                      {defiInfo.investmentStatus === 'Unwinding' && '🔄 Unwinding'}
                      {defiInfo.investmentStatus === 'Settled' && '✓ Settled'}
                      {defiInfo.investmentStatus === 'Failed' && '❌ Failed'}
                    </Badge>
                  </div>
                  {defiInfo.isAllocatedToDefi && (
                    <p className="text-xs text-text-secondary">
                      Locked funds are generating yield via Hydration Stableswap
                    </p>
                  )}
                </div>

                {/* Position Details (if allocated) */}
                {defiInfo.position && (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-text-secondary text-sm">Principal Allocated</span>
                      <span className="font-medium text-success">
                        {formatUSDT(defiInfo.position.principalUsdt)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary text-sm">LP Tokens</span>
                      <span className="font-medium">
                        {(Number(defiInfo.position.lpShares) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}

                {/* Info tooltip */}
                <div className="p-3 rounded-lg bg-prmx-cyan/5 border border-prmx-cyan/20">
                  <p className="text-xs text-text-secondary">
                    💡 Policy funds may be allocated to DeFi strategies to generate yield. 
                    The DAO guarantees coverage of potential losses.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* LP Token Holders / Settlement Payouts */}
          <Card className={policy.status === 'Settled' ? 'border-success/30' : 'border-prmx-cyan/30'}>
            <CardHeader className="pb-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {policy.status === 'Settled' ? (
                  <>
                    <Wallet className="w-5 h-5 text-success" />
                    Settlement Payouts
                  </>
                ) : (
                  <>
                    <Users className="w-5 h-5 text-prmx-cyan" />
                    LP Token Holders
                  </>
                )}
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              {policy.status === 'Settled' && settlementResult ? (
                // Show settlement payout breakdown
                <div className="space-y-4">
                  {settlementResult.eventOccurred ? (
                    // Event triggered - policyholder got paid
                    <>
                      <div className="p-4 rounded-xl bg-success/10 border border-success/30">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-success" />
                          </div>
                          <div>
                            <p className="font-semibold text-success">Policyholder Payout</p>
                            <p className="text-xs text-text-secondary">Rainfall exceeded strike threshold</p>
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-text-tertiary">Recipient</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="font-medium">{api.getAccountByAddress(policy.holder)?.name || 'Policyholder'}</span>
                                <span className="text-xs text-text-tertiary font-mono">{formatAddress(policy.holder)}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-text-tertiary">Payout</p>
                              <p className="text-xl font-bold text-success">{formatUSDT(settlementResult.payoutToHolder)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* LPs lost their capital */}
                      <div className="p-4 rounded-xl bg-error/5 border border-error/20">
                        <div className="flex items-center gap-2 mb-2">
                          <XCircle className="w-4 h-4 text-error" />
                          <p className="text-sm font-medium text-error">LP Capital Used for Payout</p>
                        </div>
                        <p className="text-xs text-text-secondary">
                          The LP capital pool was used to pay the policyholder. LPs received no return on this policy.
                        </p>
                        <div className="mt-3 p-2 rounded-lg bg-background-tertiary/50">
                          <div className="flex justify-between text-sm">
                            <span className="text-text-secondary">Total LP Shares</span>
                            <span className="font-medium">{policy.capitalPool.totalShares.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm mt-1">
                            <span className="text-text-secondary">Returned to LPs</span>
                            <span className="font-medium text-error">$0.00</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    // No event - LPs got their capital back
                    <>
                      <div className="p-4 rounded-xl bg-prmx-cyan/10 border border-prmx-cyan/30">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-prmx-cyan/20 flex items-center justify-center">
                            <Users className="w-5 h-5 text-prmx-cyan" />
                          </div>
                          <div>
                            <p className="font-semibold text-prmx-cyan">LP Capital Returned</p>
                            <p className="text-xs text-text-secondary">No rainfall event - LPs profit from premium</p>
                          </div>
                        </div>
                        
                        {/* Summary */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="p-3 rounded-lg bg-prmx-cyan/5 border border-prmx-cyan/20">
                            <p className="text-xs text-text-tertiary">Total Returned</p>
                            <p className="text-lg font-bold text-prmx-cyan">{formatUSDT(settlementResult.returnedToLps)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-background-tertiary/50 border border-border-secondary">
                            <p className="text-xs text-text-tertiary">Total Shares</p>
                            <p className="text-lg font-bold">{policy.capitalPool.totalShares.toLocaleString()}</p>
                          </div>
                        </div>
                        
                        {/* Per-share calculation */}
                        <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-text-tertiary">Return per Share</p>
                              <p className="text-sm text-text-secondary mt-1">
                                Each LP share received proportional payout
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold text-success">
                                {policy.capitalPool.totalShares > 0 
                                  ? `$${(Number(settlementResult.returnedToLps) / 1_000_000 / policy.capitalPool.totalShares).toFixed(4)}`
                                  : 'N/A'
                                }
                              </p>
                              <p className="text-xs text-text-tertiary">per share</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Policyholder got nothing */}
                      <div className="p-3 rounded-lg bg-background-tertiary/30 border border-border-secondary">
                        <div className="flex items-center gap-2 text-sm">
                          <Shield className="w-4 h-4 text-text-tertiary" />
                          <span className="text-text-secondary">Policyholder received:</span>
                          <span className="font-medium">$0.00</span>
                          <span className="text-text-tertiary">(no event occurred)</span>
                        </div>
                      </div>
                    </>
                  )}
                  
                  {/* Note about LP token burn */}
                  <div className="p-3 rounded-lg bg-background-tertiary/20 border border-border-secondary">
                    <p className="text-xs text-text-tertiary flex items-center gap-2">
                      <Info className="w-3 h-3" />
                      LP tokens were burned upon settlement. Payouts were distributed automatically.
                    </p>
                  </div>
                </div>
              ) : lpHoldings.length === 0 ? (
                <div className="text-center py-6">
                  <Users className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                  <p className="text-text-secondary text-sm">No LP tokens issued yet</p>
                  <p className="text-text-tertiary text-xs mt-1">LP tokens are minted when LPs buy shares</p>
                </div>
              ) : (
                <>
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl bg-prmx-cyan/10 border border-prmx-cyan/30">
                      <span className="text-xs text-text-secondary">Total Shares Issued</span>
                      <p className="text-lg font-bold text-prmx-cyan">
                        {lpHoldings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-background-tertiary/50 border border-border-secondary">
                      <span className="text-xs text-text-secondary">Number of Holders</span>
                      <p className="text-lg font-bold">
                        {lpHoldings.length}
                      </p>
                    </div>
                  </div>

                  {/* Holders List */}
                  <div className="space-y-2">
                    <p className="text-sm text-text-secondary font-medium">Holders</p>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {lpHoldings.map((holding, idx) => {
                        const totalShares = lpHoldings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0);
                        const holderTotal = Number(holding.shares) + Number(holding.lockedShares);
                        const ownership = totalShares > 0 ? (holderTotal / totalShares) * 100 : 0;
                        const accountInfo = api.getAccountByAddress(holding.holder);
                        
                        return (
                          <div 
                            key={holding.holder}
                            className={cn(
                              "p-3 rounded-xl border transition-all",
                              idx === 0 
                                ? "bg-prmx-cyan/10 border-prmx-cyan/30" 
                                : "bg-background-tertiary/30 border-border-secondary"
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <div className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                                  idx === 0 ? "bg-prmx-cyan text-black" : "bg-background-tertiary text-text-secondary"
                                )}>
                                  {idx + 1}
                                </div>
                                <span className="font-medium text-sm">
                                  {accountInfo?.name || formatAddress(holding.holder)}
                                </span>
                                {accountInfo && (
                                  <Badge variant="default" className="text-xs">
                                    {accountInfo.role}
                                  </Badge>
                                )}
                                {idx === 0 && (
                                  <Badge variant="cyan" className="text-xs">Top Holder</Badge>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-prmx-cyan">
                                {ownership.toFixed(1)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-text-tertiary ml-8">
                              <span className="font-mono">{formatAddress(holding.holder)}</span>
                              <span>{holderTotal.toLocaleString()} shares</span>
                            </div>
                            {Number(holding.lockedShares) > 0 && (
                              <div className="flex items-center gap-1 text-xs text-text-tertiary ml-8 mt-1">
                                <span className="text-success">{Number(holding.shares).toLocaleString()} free</span>
                                <span>•</span>
                                <span className="text-warning flex items-center gap-1">
                                  <Lock className="w-3 h-3" />
                                  {Number(holding.lockedShares).toLocaleString()} locked
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ownership Chart (simple bar) */}
                  <div className="space-y-2">
                    <p className="text-xs text-text-tertiary">Ownership Distribution</p>
                    <div className="h-3 rounded-full bg-background-tertiary/50 overflow-hidden flex">
                      {lpHoldings.map((holding, idx) => {
                        const totalShares = lpHoldings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0);
                        const holderTotal = Number(holding.shares) + Number(holding.lockedShares);
                        const width = totalShares > 0 ? (holderTotal / totalShares) * 100 : 0;
                        const colors = ['bg-prmx-cyan', 'bg-prmx-purple', 'bg-success', 'bg-warning', 'bg-error'];
                        return (
                          <div 
                            key={holding.holder}
                            className={cn(colors[idx % colors.length], "h-full")}
                            style={{ width: `${width}%` }}
                            title={`${api.getAccountByAddress(holding.holder)?.name || formatAddress(holding.holder)}: ${width.toFixed(1)}%`}
                          />
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* V2 Oracle Details (V2 policies only) */}
          {policy.policyVersion === 'V2' && (
            <Card className="border-prmx-purple/30">
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-prmx-purple" />
                  V2 Oracle Details
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Event Type */}
                <div className="p-4 rounded-xl bg-prmx-purple/10 border border-prmx-purple/30">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-text-secondary">Event Type</span>
                      <p className="font-medium text-prmx-purple-light">
                        {policy.eventType === 'CumulativeRainfallWindow' 
                          ? 'Cumulative Rainfall' 
                          : '24h Rolling'}
                      </p>
                    </div>
                    <div>
                      <span className="text-text-secondary">Early Trigger</span>
                      <p className="font-medium">
                        {policy.earlyTrigger ? (
                          <span className="text-success flex items-center gap-1">
                            <Zap className="w-3 h-3" /> Enabled
                          </span>
                        ) : 'Disabled'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Oracle Status - prioritize live monitor state when available */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Oracle Status</span>
                    {(() => {
                      // Use live monitor state if available, otherwise fall back to on-chain status
                      const liveState = v2Monitor?.state;
                      const displayStatus = liveState 
                        ? (liveState === 'triggered' ? 'Triggered' :
                           liveState === 'matured' ? 'Matured' :
                           liveState === 'reported' ? 'Reported' :
                           liveState === 'monitoring' ? 'Monitoring' : liveState)
                        : (policy.oracleStatusV2 || 'PendingMonitoring');
                      
                      const variant = 
                        displayStatus === 'Settled' || displayStatus === 'Reported' ? 'success' :
                        displayStatus === 'Triggered' || displayStatus === 'TriggeredReported' ? 'warning' :
                        displayStatus === 'Matured' || displayStatus === 'MaturedReported' ? 'default' :
                        displayStatus === 'Monitoring' ? 'cyan' :
                        'default';
                      
                      return (
                        <Badge variant={variant} className="text-xs">
                          {displayStatus}
                        </Badge>
                      );
                    })()}
                  </div>
                  {policy.strikeMm && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-secondary">Strike Threshold</span>
                      <span className="font-medium">{policy.strikeMm / 10} mm</span>
                    </div>
                  )}
                </div>

                {/* Live Monitor Data (from oracle service) */}
                {v2Monitor && (
                  <div className="p-4 rounded-xl bg-background-tertiary/50 border border-border-secondary">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-prmx-cyan" />
                      Live Monitoring
                    </h4>
                    
                    {/* Cumulative Progress */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-text-secondary">Cumulative Rainfall</span>
                        <span className="font-mono font-semibold">
                          {(v2Monitor.cumulative_mm / 10).toFixed(1)} / {(v2Monitor.strike_mm / 10).toFixed(1)} mm
                        </span>
                      </div>
                      <div className="h-2 bg-background-secondary rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all ${
                            v2Monitor.cumulative_mm >= v2Monitor.strike_mm 
                              ? 'bg-success' 
                              : v2Monitor.cumulative_mm >= v2Monitor.strike_mm * 0.75 
                                ? 'bg-warning' 
                                : 'bg-prmx-cyan'
                          }`}
                          style={{ 
                            width: `${Math.min(100, (v2Monitor.cumulative_mm / v2Monitor.strike_mm) * 100)}%` 
                          }}
                        />
                      </div>
                    </div>

                    {/* State and Last Fetch */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-text-tertiary">State</span>
                        <p className="font-medium capitalize">{v2Monitor.state}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Last Fetch</span>
                        <p className="font-medium">
                          {v2Monitor.last_fetch_at > 0 
                            ? new Date(v2Monitor.last_fetch_at * 1000).toLocaleTimeString()
                            : 'Never'}
                        </p>
                      </div>
                    </div>

                    {/* Report TX Hash if available */}
                    {v2Monitor.report_tx_hash && (
                      <div className="mt-3 pt-3 border-t border-border-secondary">
                        <span className="text-xs text-text-tertiary">Report TX</span>
                        <p className="font-mono text-xs truncate text-prmx-cyan">
                          {v2Monitor.report_tx_hash}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Link to Oracle Service page */}
                <Link href="/oracle-service">
                  <Button 
                    variant="secondary" 
                    className="w-full" 
                    icon={<Activity className="w-4 h-4" />}
                  >
                    View All V2 Monitors
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Settlement Actions (DAO only) */}
          {canSettle && (
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold">Settlement</h2>
                <p className="text-sm text-text-secondary">Settle this expired policy</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => handleSettle(true)}
                  loading={settling}
                  className="w-full bg-success hover:bg-success/90"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                >
                  Event Occurred (Pay Out)
                </Button>
                <Button
                  onClick={() => handleSettle(false)}
                  loading={settling}
                  variant="secondary"
                  className="w-full"
                  icon={<XCircle className="w-4 h-4" />}
                >
                  No Event (Return Capital)
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Settlement Result Card */}
          {policy.status === 'Settled' && (
            <Card className={settlementResult?.eventOccurred ? 'border-success/30' : 'border-prmx-cyan/30'}>
              <CardHeader className="pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  Settlement Result
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {settlementResult ? (
                  <>
                    {/* Event Status */}
                    <div className={`p-4 rounded-xl ${settlementResult.eventOccurred ? 'bg-success/10 border border-success/30' : 'bg-prmx-cyan/10 border border-prmx-cyan/30'}`}>
                      <div className="flex items-center gap-3 mb-2">
                        {settlementResult.eventOccurred ? (
                          <CloudRain className="w-6 h-6 text-success" />
                        ) : (
                          <CheckCircle2 className="w-6 h-6 text-prmx-cyan" />
                        )}
                        <div>
                          <p className="font-semibold">
                            {settlementResult.eventOccurred ? 'Event Occurred' : 'No Event'}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {settlementResult.eventOccurred 
                              ? 'Rainfall exceeded strike threshold' 
                              : 'Rainfall stayed below strike threshold'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* DeFi Position Unwound Indicator */}
                    {defiInfo && defiInfo.investmentStatus === 'Settled' && defiInfo.position && (
                      <div className="p-3 rounded-lg bg-prmx-purple/5 border border-prmx-purple/20">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-4 h-4 text-prmx-purple" />
                          <span className="text-sm font-medium">DeFi Position Unwound</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Principal Invested</span>
                            <span className="font-medium">{formatUSDT(defiInfo.position.principalUsdt)}</span>
                          </div>
                          <p className="text-xs text-text-tertiary mt-2">
                            Position was unwound from DeFi strategy at settlement
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Financial Outcome */}
                    <div className="space-y-3">
                      {settlementResult.eventOccurred ? (
                        <>
                        <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                          <div className="flex items-center gap-2 mb-1">
                            <Wallet className="w-4 h-4 text-success" />
                            <span className="text-sm text-text-secondary">Payout to Policyholder</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-xl font-bold text-success">
                              {formatUSDT(settlementResult.payoutToHolder)}
                            </p>
                            <ArrowRight className="w-4 h-4 text-text-tertiary" />
                            <span className="text-sm text-text-secondary truncate">
                              {formatAddress(policy.holder)}
                            </span>
                          </div>
                        </div>
                          
                          {/* Partial Payout Warning (when payout < maxPayout) */}
                          {settlementResult.payoutToHolder < policy.maxPayout && (
                            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                              <div className="flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-warning mt-0.5" />
                                <div>
                                  <p className="text-sm font-medium text-warning">Partial Payout</p>
                                  <p className="text-xs text-text-secondary mt-1">
                                    Payout was {formatUSDT(settlementResult.payoutToHolder)} instead of the full {formatUSDT(policy.maxPayout)} due to DeFi losses that exceeded DAO coverage capacity.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                        <div className="p-3 rounded-lg bg-prmx-cyan/5 border border-prmx-cyan/20">
                          <div className="flex items-center gap-2 mb-1">
                            <TrendingUp className="w-4 h-4 text-prmx-cyan" />
                            <span className="text-sm text-text-secondary">Returned to LPs</span>
                          </div>
                          <p className="text-xl font-bold text-prmx-cyan">
                            {formatUSDT(settlementResult.returnedToLps)}
                          </p>
                        </div>

                          {/* LP Loss Warning (when returned < expected pool balance) */}
                          {defiInfo?.position && settlementResult.returnedToLps < defiInfo.position.principalUsdt && (
                            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                              <div className="flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-warning mt-0.5" />
                                <div>
                                  <p className="text-sm font-medium text-warning">LP Loss Absorbed</p>
                                  <p className="text-xs text-text-secondary mt-1">
                                    LPs received {formatUSDT(settlementResult.returnedToLps)} instead of full principal due to DeFi losses. 
                                    The DAO covered what it could.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* DAO Contribution Note (show when DeFi was involved) */}
                    {defiInfo?.position && (
                      <div className="p-2 rounded-lg bg-prmx-cyan/5">
                        <p className="text-xs text-text-secondary text-center">
                          🛡️ DAO provided loss coverage for DeFi-allocated funds
                        </p>
                      </div>
                    )}

                    {/* Settlement Time */}
                    <div className="pt-2 border-t border-border-secondary">
                      <div className="flex items-center gap-2 text-xs text-text-tertiary">
                        <Clock className="w-3 h-3" />
                        Settled on {formatDateTimeUTC(settlementResult.settledAt)}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" />
                    <p className="text-sm text-text-secondary">
                      Policy has been settled
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Capital Pool Details */}
      {policy.capitalPool.lpHolders && policy.capitalPool.lpHolders.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-prmx-purple" />
              LP Capital Pool
            </h2>
            <p className="text-sm text-text-secondary">
              Liquidity providers backing this policy
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {policy.capitalPool.lpHolders.map((holder: string, index: number) => (
                <div key={index} className="p-3 rounded-lg bg-background-tertiary/50">
                  <p className="font-mono text-xs truncate">{formatAddress(holder)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
