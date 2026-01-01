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
import * as apiV3 from '@/lib/api-v3';
import { formatId } from '@/lib/api-v3';
import { formatUSDT, formatDate, formatDateTimeUTC, formatAddress, formatCoordinates, formatTimeRemaining, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Policy, Market, PolicyDefiInfo, V2Monitor, LpHolding } from '@/types';
import type { SettlementResult } from '@/lib/api';

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  // Policy ID is now an H128 hex string
  const policyId = String(params.id);
  
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
      // With hash-based IDs, try to load V1/V2 policy first
      const policies = await api.getPolicies();
      const found = policies.find(p => p.id === policyId);
      
      // If V1/V2 policy not found, check if V3 policy exists and redirect
      if (!found) {
        try {
          const v3Policy = await apiV3.getV3Policy(policyId);
          if (v3Policy) {
            // V3 policy exists - redirect to V3 page
            router.push(`/v3/policies/${policyId}`);
            return;
          }
        } catch (v3Err) {
          console.error('Failed to check V3 policy:', v3Err);
        }
      }
      
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
        // Note: prmxHoldings is shared between V1/V2 and V3 policy systems
        // Only filter when a V3 policy with the same ID exists (collision scenario)
        try {
          const holdings = await api.getLpHoldingsForPolicy(policyId);
          
          // Check if a V3 policy with the same ID exists (potential collision)
          let v3PolicyExists = false;
          try {
            const v3Policy = await apiV3.getV3Policy(policyId);
            v3PolicyExists = v3Policy !== null;
          } catch {
            // V3 policy doesn't exist or error checking - no collision
          }
          
          if (v3PolicyExists) {
            // V3 policy with same ID exists - need to filter carefully
            // Only show holdings that match the V1/V2 policy's expected total shares
            const holdingsTotal = holdings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0);
            const policyShares = Number(found.shares);
            
            if (holdingsTotal !== policyShares) {
              // Holdings don't match V1/V2 policy - likely showing V3 data
              // Filter to only show holdings from V1/V2 policy's LP holders list if available
              const policyLpHolders = found.capitalPool?.lpHolders || [];
              if (policyLpHolders.length > 0) {
                const filteredHoldings = holdings.filter(h => 
                  policyLpHolders.includes(h.holder)
                );
                setLpHoldings(filteredHoldings);
              } else {
                console.warn(`LP holdings collision for policy ${policyId}: V3 policy exists with same ID. holdings=${holdingsTotal}, v1v2Policy=${policyShares}`);
                setLpHoldings([]);
              }
            } else {
              // Holdings match V1/V2 policy shares - show them
              setLpHoldings(holdings);
            }
          } else {
            // No V3 collision - show all holdings for this policy
            setLpHoldings(holdings);
          }
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
      {(() => {
        // Format short policy ID for avatar
        const shortId = typeof policy.id === 'string' && policy.id.startsWith('0x') 
          ? policy.id.slice(2, 10) 
          : String(policy.id).slice(0, 8);
        const displayId = typeof policy.id === 'string' && policy.id.startsWith('0x')
          ? policy.id.slice(2, 14) + '...'
          : String(policy.id);
        
        return (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/policies">
                <Button variant="ghost" icon={<ChevronLeft className="w-5 h-5" />}>
                  Back
                </Button>
              </Link>
              
              {/* Subtle gradient avatar */}
              <div 
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-mono text-lg font-bold shadow-sm flex-shrink-0 bg-gradient-to-br from-gray-600 to-gray-700 dark:from-slate-600 dark:to-slate-700 border border-gray-500/30"
              >
                {shortId.slice(0, 4).toUpperCase()}
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded uppercase",
                    policy.policyVersion === 'V2' 
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" 
                      : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
                  )}>
                    {policy.policyVersion || 'V1'}
                  </span>
                  <StatusBadge status={policy.status} />
                  <span className="text-xs text-text-secondary flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {market?.name || `Market #${policy.marketId}`}
                  </span>
                </div>
                <h1 className="text-2xl font-bold font-mono text-text-primary">
                  {displayId}
                </h1>
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
        );
      })()}

      {/* Main Info Grid - Balanced 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
        {/* Policy Overview - Sleek design */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border-primary/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-prmx-cyan" />
                  </div>
                  <h2 className="text-base font-semibold">Policy Overview</h2>
                </div>
                <Link href={policy.policyVersion === 'V2' ? '/oracle-service' : `/oracle?marketId=${policy.marketId}`}>
                  <Button variant="secondary" size="sm" icon={policy.policyVersion === 'V2' ? <Activity className="w-4 h-4" /> : <Droplets className="w-4 h-4" />}>
                    {policy.policyVersion === 'V2' ? 'Oracle' : 'Rainfall'}
                  </Button>
                </Link>
              </div>
            </div>
            
            <div className="p-5 space-y-5">
              {/* Market Info */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-background-tertiary/50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-prmx-cyan" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{market?.name || `Market #${policy.marketId}`}</p>
                  {market && (
                    <p className="text-xs text-text-tertiary">
                      {formatCoordinates(market.centerLatitude, market.centerLongitude)}
                    </p>
                  )}
                </div>
              </div>
              
              {market && (
                <div className="flex gap-4 text-sm">
                  <div className="flex-1">
                    <p className="text-xs text-text-tertiary mb-0.5">Strike</p>
                    <p className="font-medium">{market.strikeValue} mm</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-text-tertiary mb-0.5">Payout/Share</p>
                    <p className="font-medium">{formatUSDT(market.payoutPerShare)}</p>
                  </div>
                </div>
              )}

              {/* Coverage Period */}
              <div className="pt-3 border-t border-border-primary/30">
                <div className="flex items-center gap-1.5 mb-2">
                  <Calendar className="w-3.5 h-3.5 text-text-tertiary" />
                  <p className="text-xs text-text-tertiary">Coverage Period</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-center px-3 py-2 rounded-lg bg-background-tertiary/50 flex-1">
                    <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Start</p>
                    <p className="font-semibold text-sm mt-0.5">{formatDateTimeUTC(policy.coverageStart)}</p>
                  </div>
                  <span className="text-text-tertiary text-sm">→</span>
                  <div className="text-center px-3 py-2 rounded-lg bg-background-tertiary/50 flex-1">
                    <p className="text-[10px] text-text-tertiary uppercase tracking-wide">End</p>
                    <p className="font-semibold text-sm mt-0.5">{formatDateTimeUTC(policy.coverageEnd)}</p>
                  </div>
                </div>
              </div>

              {/* Time Remaining */}
              {isActive && (
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    isExpired ? "bg-amber-500" : "bg-prmx-cyan animate-pulse"
                  )} />
                  <span className={cn(
                    "text-sm font-medium",
                    isExpired ? "text-amber-500" : "text-prmx-cyan"
                  )}>
                    {isExpired ? 'Awaiting Settlement' : formatTimeRemaining(policy.coverageEnd)}
                  </span>
                </div>
              )}

              {/* Holder Info */}
              <div className="pt-3 border-t border-border-primary/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-text-tertiary" />
                    <p className="text-xs text-text-tertiary">Holder</p>
                  </div>
                  <p className="font-mono text-xs text-text-secondary">{formatAddress(policy.holder)}</p>
                </div>
              </div>

              {/* Created At */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-text-tertiary" />
                  <p className="text-xs text-text-tertiary">Created</p>
                </div>
                <p className="text-xs text-text-secondary">{formatDateTimeUTC(policy.createdAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

          {/* Pool Account Info - Sleek design */}
          {poolInfo && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-prmx-purple" />
                    </div>
                    <h2 className="text-base font-semibold">Locked Funds</h2>
                  </div>
                </div>
                
                {/* Balance highlight */}
                <div className="px-5 py-4 bg-gradient-to-r from-prmx-purple/5 to-transparent">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-tertiary">Pool Balance</span>
                    <span className="text-2xl font-bold text-prmx-purple">{formatUSDT(poolInfo.balance)}</span>
                  </div>
                </div>
                
                {/* Pool Address */}
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">Pool Address</span>
                    <button
                      onClick={handleCopyAddress}
                      className="flex items-center gap-1.5 group"
                      title="Copy address"
                    >
                      <code className="text-xs font-mono text-text-secondary group-hover:text-prmx-cyan transition-colors">
                        {formatAddress(poolInfo.address)}
                      </code>
                      {copied ? (
                        <Check className="w-3 h-3 text-success" />
                      ) : (
                        <Copy className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Footer note */}
                <div className="px-5 py-3 bg-background-tertiary/30 border-t border-border-primary/30">
                  <p className="text-[11px] text-text-tertiary">
                    Locked until settlement
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* LP Token Holders - Sleek design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      policy.status === 'Settled' ? "bg-emerald-500/10" : "bg-prmx-cyan/10"
                    )}>
                      {policy.status === 'Settled' ? (
                        <Wallet className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Users className="w-4 h-4 text-prmx-cyan" />
                      )}
                    </div>
                    <h2 className="text-base font-semibold">
                      {policy.status === 'Settled' ? 'Settlement Payouts' : 'LP Token Holders'}
                    </h2>
                  </div>
                  {!settlementResult && lpHoldings.length > 0 && (
                    <span className="text-xs text-text-tertiary">
                      {lpHoldings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0).toLocaleString()} shares
                    </span>
                  )}
                </div>
              </div>
              
              <div className="p-5">
                {policy.status === 'Settled' && settlementResult ? (
                  <div className="space-y-4">
                    {settlementResult.eventOccurred ? (
                      <>
                        {/* Policyholder Payout */}
                        <div className="px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-500/5 to-transparent">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-text-tertiary">Holder Payout</p>
                              <p className="text-sm text-text-secondary mt-0.5">
                                {api.getAccountByAddress(policy.holder)?.name || formatAddress(policy.holder)}
                              </p>
                            </div>
                            <span className="text-xl font-bold text-emerald-500">
                              {formatUSDT(settlementResult.payoutToHolder)}
                            </span>
                          </div>
                        </div>
                        
                        {/* LP Loss */}
                        <div className="flex items-center justify-between text-sm pt-3 border-t border-border-primary/30">
                          <div className="flex items-center gap-2">
                            <XCircle className="w-4 h-4 text-red-400" />
                            <span className="text-text-tertiary">LP Return</span>
                          </div>
                          <span className="font-medium text-red-400">$0.00</span>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* LP Return */}
                        <div className="px-4 py-3 rounded-lg bg-gradient-to-r from-prmx-cyan/5 to-transparent">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-tertiary">Returned to LPs</span>
                            <span className="text-xl font-bold text-prmx-cyan">
                              {formatUSDT(settlementResult.returnedToLps)}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-tertiary">Per Share</span>
                          <span className="font-medium text-emerald-500">
                            {policy.capitalPool.totalShares > 0 
                              ? `$${(Number(settlementResult.returnedToLps) / 1_000_000 / policy.capitalPool.totalShares).toFixed(4)}`
                              : 'N/A'
                            }
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between text-sm pt-3 border-t border-border-primary/30">
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-text-tertiary" />
                            <span className="text-text-tertiary">Holder received</span>
                          </div>
                          <span className="font-medium">$0.00</span>
                        </div>
                      </>
                    )}
                    
                    {/* Footer note */}
                    <p className="text-[11px] text-text-tertiary flex items-center gap-1.5 pt-3 border-t border-border-primary/30">
                      <Info className="w-3 h-3" />
                      LP tokens burned upon settlement
                    </p>
                  </div>
                ) : lpHoldings.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-8 h-8 mx-auto mb-2 text-text-tertiary opacity-50" />
                    <p className="text-sm text-text-secondary">No LP tokens yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Holders List */}
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {lpHoldings.map((holding, idx) => {
                        const totalShares = lpHoldings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0);
                        const holderTotal = Number(holding.shares) + Number(holding.lockedShares);
                        const ownership = totalShares > 0 ? (holderTotal / totalShares) * 100 : 0;
                        const accountInfo = api.getAccountByAddress(holding.holder);
                        
                        return (
                          <div 
                            key={holding.holder}
                            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-background-tertiary/30 transition-colors group"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className={cn(
                                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                                idx === 0 ? "bg-prmx-cyan/20 text-prmx-cyan" : "bg-background-tertiary text-text-tertiary"
                              )}>
                                {idx + 1}
                              </span>
                              <div>
                                <span className="text-sm font-medium">
                                  {accountInfo?.name || formatAddress(holding.holder)}
                                </span>
                                {Number(holding.lockedShares) > 0 && (
                                  <span className="ml-2 text-[10px] text-amber-500">
                                    <Lock className="w-2.5 h-2.5 inline" /> {Number(holding.lockedShares)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1 bg-background-tertiary rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-prmx-cyan rounded-full"
                                  style={{ width: `${ownership}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium w-10 text-right">{ownership.toFixed(1)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Ownership Distribution Bar */}
                    <div className="pt-3 border-t border-border-primary/30">
                      <div className="h-1.5 rounded-full bg-background-tertiary overflow-hidden flex">
                        {lpHoldings.map((holding, idx) => {
                          const totalShares = lpHoldings.reduce((sum, h) => sum + Number(h.shares) + Number(h.lockedShares), 0);
                          const holderTotal = Number(holding.shares) + Number(holding.lockedShares);
                          const width = totalShares > 0 ? (holderTotal / totalShares) * 100 : 0;
                          const colors = ['bg-prmx-cyan', 'bg-prmx-purple', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'];
                          return (
                            <div 
                              key={holding.holder}
                              className={cn(colors[idx % colors.length], "h-full")}
                              style={{ width: `${width}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Financial Summary - Sleek design */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border-primary/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h2 className="text-base font-semibold">Financial Summary</h2>
                </div>
              </div>
              
              {/* Max Payout highlight */}
              <div className="px-5 py-4 bg-gradient-to-r from-emerald-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">Max Payout</span>
                  <span className="text-2xl font-bold text-emerald-500">{formatUSDT(policy.maxPayout)}</span>
                </div>
              </div>
              
              {/* Details */}
              <div className="px-5 py-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Shares</span>
                  <span className="text-sm font-medium">{Number(policy.shares)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Premium Paid</span>
                  <span className="text-sm font-medium text-prmx-cyan">{formatUSDT(policy.premiumPaid)}</span>
                </div>
                <div className="h-px bg-border-primary/50 my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-tertiary">Capital Pool</span>
                  <span className="text-sm font-medium">{formatUSDT(policy.capitalPool.totalCapital)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* DeFi Allocation Card - Sleek design */}
          {defiInfo && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-violet-500" />
                      </div>
                      <h2 className="text-base font-semibold">DeFi Strategy</h2>
                    </div>
                    <span className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      defiInfo.isAllocatedToDefi 
                        ? "bg-emerald-500/10 text-emerald-500" 
                        : "bg-text-tertiary/10 text-text-tertiary"
                    )}>
                      {defiInfo.isAllocatedToDefi ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                
                <div className="px-5 py-4">
                  {/* Status indicator */}
                  {defiInfo.isAllocatedToDefi ? (
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs text-text-secondary">
                        Earning yield via Hydration Stableswap
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-text-tertiary mb-4">
                      Funds available for DeFi allocation
                    </p>
                  )}

                  {/* Position Details */}
                  {defiInfo.position && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">Principal</span>
                        <span className="text-sm font-semibold text-emerald-500">
                          {formatUSDT(defiInfo.position.principalUsdt)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-tertiary">LP Tokens</span>
                        <span className="text-sm font-medium">
                          {(Number(defiInfo.position.lpShares) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Footer note */}
                <div className="px-5 py-3 bg-background-tertiary/30 border-t border-border-primary/30">
                  <p className="text-[11px] text-text-tertiary">
                    DAO guarantees coverage of DeFi losses
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* V2 Oracle Details - Sleek design */}
          {policy.policyVersion === 'V2' && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-prmx-purple" />
                      </div>
                      <h2 className="text-base font-semibold">V2 Oracle</h2>
                    </div>
                    {(() => {
                      const liveState = v2Monitor?.state;
                      const displayStatus = liveState 
                        ? (liveState === 'triggered' ? 'Triggered' :
                           liveState === 'matured' ? 'Matured' :
                           liveState === 'reported' ? 'Reported' :
                           liveState === 'monitoring' ? 'Monitoring' : liveState)
                        : (policy.oracleStatusV2 || 'Pending');
                      
                      return (
                        <span className={cn(
                          "text-xs font-medium px-2 py-1 rounded-full",
                          displayStatus === 'Monitoring' ? "bg-prmx-cyan/10 text-prmx-cyan" :
                          displayStatus === 'Triggered' ? "bg-amber-500/10 text-amber-500" :
                          displayStatus === 'Reported' || displayStatus === 'Settled' ? "bg-emerald-500/10 text-emerald-500" :
                          "bg-text-tertiary/10 text-text-tertiary"
                        )}>
                          {displayStatus}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                
                <div className="px-5 py-4 space-y-4">
                  {/* Event Type & Early Trigger */}
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <p className="text-xs text-text-tertiary mb-0.5">Event Type</p>
                      <p className="text-sm font-medium">
                        {policy.eventType === 'CumulativeRainfallWindow' 
                          ? 'Cumulative' 
                          : '24h Rolling'}
                      </p>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-text-tertiary mb-0.5">Early Trigger</p>
                      <p className="text-sm font-medium">
                        {policy.earlyTrigger ? (
                          <span className="text-emerald-500 flex items-center gap-1">
                            <Zap className="w-3 h-3" /> On
                          </span>
                        ) : 'Off'}
                      </p>
                    </div>
                    {policy.strikeMm && (
                      <div className="flex-1">
                        <p className="text-xs text-text-tertiary mb-0.5">Strike</p>
                        <p className="text-sm font-semibold text-prmx-cyan">{policy.strikeMm / 10} mm</p>
                      </div>
                    )}
                  </div>

                  {/* Live Monitor Data */}
                  {v2Monitor && (
                    <div className="pt-3 border-t border-border-primary/30 space-y-3">
                      {/* Progress bar */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-text-tertiary">Progress</span>
                          <span className="text-xs font-medium">
                            {(v2Monitor.cumulative_mm / 10).toFixed(1)} / {(v2Monitor.strike_mm / 10).toFixed(1)} mm
                          </span>
                        </div>
                        <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all",
                              v2Monitor.cumulative_mm >= v2Monitor.strike_mm 
                                ? 'bg-emerald-500' 
                                : 'bg-prmx-cyan'
                            )}
                            style={{ 
                              width: `${Math.min(100, (v2Monitor.cumulative_mm / v2Monitor.strike_mm) * 100)}%` 
                            }}
                          />
                        </div>
                      </div>

                      {/* State and Last Fetch */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2 h-2 rounded-full",
                            v2Monitor.state === 'monitoring' ? "bg-prmx-cyan animate-pulse" :
                            v2Monitor.state === 'triggered' ? "bg-amber-500" :
                            "bg-text-tertiary"
                          )} />
                          <span className="text-xs text-text-secondary capitalize">{v2Monitor.state}</span>
                        </div>
                        <span className="text-xs text-text-tertiary">
                          {v2Monitor.last_fetch_at > 0 
                            ? `Updated ${new Date(v2Monitor.last_fetch_at * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                            : 'No data yet'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Link to Oracle Service */}
                  <Link href="/oracle-service">
                    <Button variant="secondary" size="sm" className="w-full" icon={<Activity className="w-4 h-4" />}>
                      View All Monitors
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Settlement Actions - Sleek design */}
          {canSettle && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-amber-500" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold">Settlement</h2>
                      <p className="text-xs text-text-tertiary">Settle this expired policy</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-5 space-y-3">
                  <Button
                    onClick={() => handleSettle(true)}
                    loading={settling}
                    className="w-full bg-emerald-500 hover:bg-emerald-600"
                    icon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Event Occurred
                  </Button>
                  <Button
                    onClick={() => handleSettle(false)}
                    loading={settling}
                    variant="secondary"
                    className="w-full"
                    icon={<XCircle className="w-4 h-4" />}
                  >
                    No Event
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Settlement Result Card - Sleek design */}
          {policy.status === 'Settled' && (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border-primary/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        settlementResult?.eventOccurred ? "bg-emerald-500/10" : "bg-prmx-cyan/10"
                      )}>
                        <CheckCircle2 className={cn(
                          "w-4 h-4",
                          settlementResult?.eventOccurred ? "text-emerald-500" : "text-prmx-cyan"
                        )} />
                      </div>
                      <h2 className="text-base font-semibold">Settlement Result</h2>
                    </div>
                    <span className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      settlementResult?.eventOccurred ? "bg-emerald-500/10 text-emerald-500" : "bg-prmx-cyan/10 text-prmx-cyan"
                    )}>
                      {settlementResult?.eventOccurred ? 'Event Triggered' : 'No Event'}
                    </span>
                  </div>
                </div>
                
                {settlementResult ? (
                  <div className="p-5 space-y-4">
                    {/* Event Status */}
                    <div className="flex items-center gap-3">
                      {settlementResult.eventOccurred ? (
                        <CloudRain className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-prmx-cyan" />
                      )}
                      <p className="text-sm text-text-secondary">
                        {settlementResult.eventOccurred 
                          ? 'Rainfall exceeded strike threshold' 
                          : 'Rainfall stayed below threshold'}
                      </p>
                    </div>

                    {/* DeFi Position Unwound */}
                    {defiInfo && defiInfo.investmentStatus === 'Settled' && defiInfo.position && (
                      <div className="flex items-center justify-between text-sm pt-3 border-t border-border-primary/30">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-prmx-purple" />
                          <span className="text-text-tertiary">DeFi Position</span>
                        </div>
                        <span className="font-medium">{formatUSDT(defiInfo.position.principalUsdt)} unwound</span>
                      </div>
                    )}

                    {/* Financial Outcome */}
                    {settlementResult.eventOccurred ? (
                      <div className="pt-3 border-t border-border-primary/30">
                        <div className="px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-500/5 to-transparent">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-tertiary">Holder Payout</span>
                            <span className="text-xl font-bold text-emerald-500">
                              {formatUSDT(settlementResult.payoutToHolder)}
                            </span>
                          </div>
                        </div>
                        
                        {settlementResult.payoutToHolder < policy.maxPayout && (
                          <div className="flex items-center gap-2 mt-2 text-xs text-amber-500">
                            <XCircle className="w-3 h-3" />
                            <span>Partial payout due to DeFi losses</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="pt-3 border-t border-border-primary/30">
                        <div className="px-4 py-3 rounded-lg bg-gradient-to-r from-prmx-cyan/5 to-transparent">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-tertiary">Returned to LPs</span>
                            <span className="text-xl font-bold text-prmx-cyan">
                              {formatUSDT(settlementResult.returnedToLps)}
                            </span>
                          </div>
                        </div>
                        
                        {defiInfo?.position && settlementResult.returnedToLps < defiInfo.position.principalUsdt && (
                          <div className="flex items-center gap-2 mt-2 text-xs text-amber-500">
                            <XCircle className="w-3 h-3" />
                            <span>LP loss absorbed by DAO</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Settlement Time */}
                    <div className="flex items-center justify-between text-xs text-text-tertiary pt-3 border-t border-border-primary/30">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        <span>Settled</span>
                      </div>
                      <span>{formatDateTimeUTC(settlementResult.settledAt)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                    <p className="text-sm text-text-secondary">Settled</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Capital Pool Details - Sleek design */}
      {policy.capitalPool.lpHolders && policy.capitalPool.lpHolders.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border-primary/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-prmx-purple/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-prmx-purple" />
                  </div>
                  <h2 className="text-base font-semibold">LP Capital Pool</h2>
                </div>
                <span className="text-xs text-text-tertiary">
                  {policy.capitalPool.lpHolders.length} provider{policy.capitalPool.lpHolders.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            
            <div className="p-5">
              <div className="space-y-2">
                {policy.capitalPool.lpHolders.map((holder: string, index: number) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-background-tertiary/30 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-tertiary w-4">{index + 1}</span>
                      <code className="font-mono text-xs text-text-secondary">{formatAddress(holder)}</code>
                    </div>
                    <Copy className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
